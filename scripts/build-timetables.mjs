// Stáhne jízdní řády DSZO (balík JDF z dszo.cz), uloží je pro aplikaci do public/tt/
// a pro každou linku a směr spočítá trasu po silnicích přes její zastávky (OSRM).
// Běží v GitHub Actions po scripts/build-routes.mjs, který připraví polohy zastávek z OpenStreetMap.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { readJdf, buildTimetables } from './jdf-lib.mjs';
import { buildFromGtfs } from './gtfs-lib.mjs';
import { buildPlannerData, buildPlannerFromTrips } from './planner-data.mjs';
import { locateStops, simplifyLine, stopCorrector, uTurns } from './routes-lib.mjs';
import { normalizeName } from '../src/names.js';

const UA = { 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' };
const ROUTES = new URL('../public/routes.json', import.meta.url);
const TT_DIR = new URL('../public/tt/', import.meta.url);
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Strojově čitelné jízdní řády: balík DSZO obsahuje jen PDF, proto GTFS Integrované dopravy Zlínského kraje
// (přebalené pro projekt Transitous) a záložně celostátní data CIS JŘ převedená do GTFS (data.jr.ggu.cz).
const GTFS_URLS = (process.env.GTFS_URLS ?? 'https://hoermalmeister.github.io/gtfs-rehost/idzk/id-zk-all.zip https://data.jr.ggu.cz/results/latest/JDF_merged_GTFS.zip')
  .split(/\s+/)
  .filter(Boolean);

function pragueToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date());
}

async function findZipUrl() {
  for (const page of ['https://www.dszo.cz/cestujici/jizdni-rady/', 'https://www.dszo.cz/']) {
    try {
      const html = await (await fetch(page, { headers: UA })).text();
      const links = [...html.matchAll(/["'(]([^"'()\s]*\/jr\/dszo_jr_[\d-]+\.zip[^"'()\s]*)/g)].map((m) => new URL(m[1], page).href);
      if (links.length) return links.sort().at(-1);
    } catch (err) {
      console.warn(`Stránka ${page} nejde načíst: ${err.message}`);
    }
  }
  return null;
}

async function previousDeploy(path) {
  if (!process.env.PAGES_URL) return null;
  try {
    const res = await fetch(new URL(path, process.env.PAGES_URL));
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Směr jízdy u každé zastávky (azimut od předchozí k další zastávce, ve stupních).
function travelBearings(points) {
  return points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const kx = Math.cos((a[1] * Math.PI) / 180);
    const deg = (Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI;
    return Math.round((deg + 360) % 360);
  });
}

async function osrmFetch(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return await res.json();
      if (res.status === 400) return await res.json().catch(() => null);
      if (res.status === 429) await sleep(5000);
    } catch {
      await sleep(2000);
    }
  }
  return null;
}

// Trasa po silnicích přes zadané body [lon, lat]. Dlouhé trasy dělíme na kusy.
// Každá zastávka se přichytí jen na silnici ve směru jízdy (bearings), jinak by se na silnici
// se dvěma pásy mohla chytit protisměru a trasa by se tam otáčela.
async function osrmRoute(points) {
  const CHUNK = 40;
  const bearings = travelBearings(points);
  let line = [];
  for (let i = 0; i < points.length - 1; i += CHUNK - 1) {
    const part = points.slice(i, i + CHUNK);
    const base = `${OSRM}${part.map((p) => p.join(',')).join(';')}?overview=full&geometries=geojson&continue_straight=true`;
    const withBearings = `${base}&bearings=${bearings.slice(i, i + CHUNK).map((b) => `${b},100`).join(';')}`;
    let json = await osrmFetch(withBearings);
    // Když se některá zastávka ve směru jízdy nechytí (třeba v zatáčce), zkusíme to bez směru.
    if (json?.code !== 'Ok') {
      await sleep(1100);
      json = await osrmFetch(base);
      bearingFallbacks++;
    }
    if (json?.code !== 'Ok') return null;
    const coords = json.routes[0].geometry.coordinates;
    line = line.length ? line.concat(coords.slice(1)) : coords;
    await sleep(1100); // veřejný server OSRM: nejvýš ~1 dotaz za sekundu
  }
  return line;
}
let bearingFallbacks = 0;

// Linky s indexy zastávek převede na názvy (každý zdroj má vlastní seznam názvů).
function withStopNames(part) {
  return part.lines.map((line) => ({
    ...line,
    directions: line.directions.map((d) => ({
      ...d,
      stops: d.stops.map((i) => part.stopNames[i]),
      variants: d.variants.map((v) => ({ ...v, stops: v.stops.map((i) => part.stopNames[i]) })),
    })),
  }));
}

// --- 1. Jízdní řády ------------------------------------------------------------
const zipUrl = await findZipUrl();
let tt = null;
if (zipUrl) {
  console.log(`Balík jízdních řádů: ${zipUrl}`);
  try {
    const bytes = new Uint8Array(await (await fetch(zipUrl, { headers: UA })).arrayBuffer());
    let files = unzipSync(bytes);
    // Některé balíky mají uvnitř další ZIP pro každou linku.
    const nested = Object.entries(files).filter(([n]) => n.toLowerCase().endsWith('.zip'));
    if (nested.length) {
      const merged = {};
      for (const [name, data] of nested) {
        for (const [inner, content] of Object.entries(unzipSync(data))) merged[`${name}/${inner}`] = content;
      }
      files = merged;
    }
    console.log(`Soubory v balíku: ${Object.keys(files).slice(0, 15).join(', ')}${Object.keys(files).length > 15 ? ' …' : ''}`);

    // Balík může obsahovat více adresářů (jeden na linku): každý zpracujeme zvlášť a spojíme.
    const groups = {};
    for (const [path, content] of Object.entries(files)) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      (groups[dir] ??= {})[path] = content;
    }
    const startDate = pragueToday();
    const parts = Object.values(groups)
      .map((g) => readJdf(g))
      .filter((j) => j['zasspoje.txt'])
      .map((j) => buildTimetables(j, { startDate }));
    if (parts.length) {
      const first = Object.values(groups).map((g) => readJdf(g)).find((j) => j['linky.txt']);
      console.log('Ukázka Linky.txt:', JSON.stringify(first?.['linky.txt']?.[0]));
      console.log('Ukázka Zastavky.txt:', JSON.stringify(first?.['zastavky.txt']?.slice(0, 2)));
      console.log('Ukázka Zasspoje.txt:', JSON.stringify(first?.['zasspoje.txt']?.[0]));
      const lines = new Map();
      for (const part of parts) for (const line of withStopNames(part)) if (!lines.has(line.ref)) lines.set(line.ref, line);
      tt = { startDate, days: parts[0].days, lines: [...lines.values()] };
      console.log(`Jízdní řády: ${tt.lines.length} linek (${tt.lines.map((l) => l.ref).join(', ')})`);
    }
  } catch (err) {
    console.warn(`Jízdní řády se nepodařilo zpracovat: ${err.stack}`);
  }
} else {
  console.warn('Odkaz na balík jízdních řádů na dszo.cz nenalezen.');
}

if (!tt) {
  for (const url of GTFS_URLS) {
    try {
      console.log(`Zkouším GTFS: ${url}`);
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      console.log(`GTFS staženo: ${(bytes.length / 1e6).toFixed(1)} MB`);
      const startDate = pragueToday();
      const part = buildFromGtfs(bytes, { startDate, log: (m) => console.log(m) });
      if (part.lines.length) {
        tt = { startDate, days: part.days, lines: withStopNames(part), rawTrips: part.rawTrips, source: url };
        break;
      }
      console.warn('V GTFS nejsou linky DSZO.');
    } catch (err) {
      console.warn(`GTFS ${url} se nepodařilo zpracovat: ${err.stack}`);
    }
  }
  if (tt) console.log(`Jízdní řády z GTFS: ${tt.lines.length} linek (${tt.lines.map((l) => l.ref).join(', ')})`);
}

// Polohy zastávek z jízdních řádů bývají o kus vedle: opravíme je podle OpenStreetMap.
const osm = existsSync(ROUTES) ? JSON.parse(readFileSync(ROUTES, 'utf8')) : { routes: [], stops: {} };
if (tt?.lines?.length && osm.platforms?.length) {
  const correct = stopCorrector(osm.platforms);
  // Sousední zastávky určují směr jízdy, a tedy stranu silnice.
  const along = (list, i) => [list[i - 1] ?? null, list[i + 1] ?? null];
  for (const line of tt.lines)
    for (const d of line.directions)
      for (const v of d.variants) {
        if (!v.coords) continue;
        const raw = v.coords;
        v.coords = raw.map((c, i) => (c ? correct(v.stops[i], c[0], c[1], ...along(raw, i)) : c));
      }
  for (const t of tt.rawTrips ?? []) {
    const raw = t.stops.map(([, lat, lon]) => [lat, lon]);
    t.stops = t.stops.map(([n, lat, lon], i) => [n, ...correct(n, lat, lon, ...along(raw, i))]);
  }
  const { checked, moved, sum, sided } = correct.stats;
  console.log(`Polohy zastávek podle OSM: opraveno ${moved} z ${checked} nástupišť (průměrně o ${moved ? Math.round(sum / moved) : 0} m), podle strany silnice ${sided}.`);
}

mkdirSync(TT_DIR, { recursive: true });
if (tt) {
  // Data pro vyhledávání spojení a seznam linek (filtr).
  const planner = tt.rawTrips ? buildPlannerFromTrips(tt) : buildPlannerData(tt);
  writeFileSync(new URL('planner.json', TT_DIR), JSON.stringify(planner));
  writeFileSync(new URL('index.json', TT_DIR), JSON.stringify({ startDate: tt.startDate, days: tt.days, lines: tt.lines.map((l) => ({ ref: l.ref, type: l.type })) }));
  console.log(`Vyhledávání spojení: ${planner.stops.length} zastávek, ${planner.patterns.length} variant, ${planner.trips.length} spojů.`);
} else {
  // Bez nových dat ponecháme data z posledního nasazení.
  const planner = await previousDeploy('tt/planner.json');
  const index = await previousDeploy('tt/index.json');
  if (planner?.trips?.length) {
    writeFileSync(new URL('planner.json', TT_DIR), JSON.stringify(planner));
    console.warn(`Používám jízdní řády z posledního nasazení (${planner.trips.length} spojů).`);
  }
  writeFileSync(new URL('index.json', TT_DIR), JSON.stringify(index?.lines ? index : { lines: [] }));
  tt = planner?.trips?.length ? { previous: true, lines: [] } : null;
}

// --- 2. Trasy po silnicích podle zastávek ------------------------------------
const previous = (await previousDeploy('routes.json'))?.routes ?? [];
const cache = new Map(previous.filter((r) => r.key && r.line?.length > 1).map((r) => [r.key, r.line]));

const routes = [];
if (tt?.previous) {
  // Jízdní řády z minula: ponecháme i jejich trasy.
  routes.push(...previous.filter((r) => r.dir));
}
let routed = 0, cached = 0, missing = 0, shaped = 0;
for (const line of tt?.previous ? [] : tt?.lines ?? []) {
  for (const dir of line.directions) {
    const total = dir.variants.reduce((s, v) => s + v.count, 0);
    // Varianty, kterými jezdí aspoň 10 % spojů směru (nejvýš 3).
    const variants = dir.variants.filter((v, i) => i === 0 || v.count >= total * 0.1).slice(0, 3);
    for (const v of variants) {
      // Polohy zastávek z GTFS, jinak dohledané podle názvu v OpenStreetMap.
      const stops = v.coords ? v.stops.map((name, i) => [name, v.coords[i]?.[0] ?? null, v.coords[i]?.[1] ?? null]) : locateStops(v.stops, osm.stops);
      const located = stops.filter((s) => s[1] != null);
      if (located.length < 2) { missing++; continue; }
      if (v.shape?.length > 1) {
        // Tvar trasy přímo z jízdních řádů: přesně tudy vůz jede.
        routes.push({ ref: line.ref, type: line.type, dir: dir.id, to: dir.headsign, stops: located, line: simplifyLine(v.shape) });
        shaped++;
        continue;
      }
      const points = located.map((s) => [s[2], s[1]]);
      // Verze v klíči: trasy spočítané dřív bez směru jízdy se přepočítají.
      const key = `b1|${points.map((p) => p.join(',')).join(';')}`;
      let geometry = cache.get(key);
      if (geometry) cached++;
      else {
        geometry = await osrmRoute(points);
        if (geometry) { geometry = simplifyLine(geometry); routed++; }
      }
      routes.push({ ref: line.ref, type: line.type, dir: dir.id, to: dir.headsign, stops: located, line: geometry ?? [], key });
    }
  }
}

// Linky, které v jízdních řádech chybí, necháme z OpenStreetMap.
const covered = new Set(routes.filter((r) => r.line.length > 1).map((r) => r.ref));
const osmFallback = osm.routes.filter((r) => !covered.has(r.ref));
// Slovník poloh zastávek (pro trasu podle jízdního řádu vozu): OSM doplněné o zastávky z jízdních řádů.
const stopDict = { ...osm.stops };
for (const r of routes) for (const [name, lat, lon] of r.stops) stopDict[normalizeName(name)] ??= [lat, lon];
writeFileSync(ROUTES, JSON.stringify({ generated: new Date().toISOString(), routes: [...routes, ...osmFallback], stops: stopDict, platforms: osm.platforms ?? [] }));
console.log(`Trasy podle zastávek: ${routes.length} (tvar z jízdních řádů ${shaped}, nově spočítané ${routed}, z cache ${cached}), bez poloh zastávek ${missing}, z OSM navíc ${osmFallback.length}.`);
// Kontrola: kolik tras se někde otáčí do protisměru (dřív a teď).
const turning = (list) => list.filter((r) => r.dir && uTurns(r.line).length);
const before = turning(previous);
const after = turning(routes);
console.log(`Trasy s otočkou do protisměru: předtím ${before.length} z ${previous.filter((r) => r.dir).length}, teď ${after.length} z ${routes.length} (bez směru jízdy počítáno ${bearingFallbacks}×).`);
const nearestStop = (r, [x, y]) => r.stops.reduce((best, s) => {
  const d = Math.hypot((s[1] - y) * 110574, (s[2] - x) * 72000);
  return d < best.d ? { d, name: s[0] } : best;
}, { d: Infinity, name: '?' });
for (const r of after.slice(0, 30)) {
  const at = uTurns(r.line).map((p) => { const n = nearestStop(r, p); return `${p[1]},${p[0]} (${n.name} ${Math.round(n.d)} m)`; });
  console.log(`  linka ${r.ref} → ${r.to}: ${at.join('; ')}`);
}
const unlocated = new Set();
for (const line of tt?.lines ?? []) for (const d of line.directions) for (const v of d.variants) if (!v.coords) for (const s of locateStops(v.stops, osm.stops)) if (s[1] == null) unlocated.add(s[0]);
if (unlocated.size) console.log(`Zastávky bez polohy v OSM (${unlocated.size}): ${[...unlocated].slice(0, 40).join('; ')}`);
