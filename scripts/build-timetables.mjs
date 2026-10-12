// Stáhne jízdní řády DSZO (balík JDF z dszo.cz), uloží je pro aplikaci do public/tt/
// a pro každou linku a směr spočítá trasu po silnicích přes její zastávky (OSRM).
// Běží v GitHub Actions po scripts/build-routes.mjs, který připraví polohy zastávek z OpenStreetMap.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { readJdf, buildTimetables } from './jdf-lib.mjs';
import { buildFromGtfs } from './gtfs-lib.mjs';
import { buildPlannerData, buildPlannerFromTrips } from './planner-data.mjs';
import { dszoMarks, applyMarks } from './dszo-notes.mjs';
import { locateStops, simplifyLine, stopCorrector, uTurns, removeDetours } from './routes-lib.mjs';
import { normalizeName } from '../src/names.js';
import { railTrips, RAIL_GTFS_URL } from './rail-gtfs.mjs';
import { cityTrips } from './city-gtfs.mjs';
import { kordisTrips, nationalTrips, knownEvents, KORDIS_GTFS_URL, NATIONAL_GTFS_URL } from './area-buses.mjs';
import { railEquipment, CZPTT_URL, timetableYear } from './rail-equip.mjs';
import { cityStopName, CITIES, CARRIERS } from '../src/cities.js';
import { RailNetwork } from '../src/railroute.js';
import { regionContains } from '../src/region.js';

const UA = { 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' };
const ROUTES = new URL('../public/routes.json', import.meta.url);
// Trasy regionálních autobusů (dopravci, jejichž vozy ukazujeme na mapě): zvlášť, aplikace je načte, až je potřebuje.
const BUS_ROUTES = new URL('../public/routes-bus.json', import.meta.url);
const TT_DIR = new URL('../public/tt/', import.meta.url);
// Vlastní OSRM (scripts/osrm-local.sh), jinak veřejný server s omezením na ~1 dotaz za sekundu.
const OSRM_BASE = process.env.OSRM_URL || 'https://router.project-osrm.org';
const LOCAL_OSRM = !!process.env.OSRM_URL;
const PUBLIC_OSRM = 'https://router.project-osrm.org';
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

/**
 * Trasa po silnicích přes zastávky [lon, lat]. Zastávka je jen bod, kolem kterého vůz projede:
 * přiřazení k silnici (map matching) vybere nejpravděpodobnější cestu do ~60 m od každé zastávky,
 * takže se trasa kvůli zastávce zakreslené na druhé straně silnice nemusí otáčet do protisměru.
 * Když přiřazení selže, trasa přímo přes zastávky. Dlouhé trasy po kusech.
 */
async function osrmRoute(points, base = OSRM_BASE) {
  const CHUNK = 40;
  const pause = base === PUBLIC_OSRM ? 1100 : 0; // veřejný server: nejvýš ~1 dotaz za sekundu
  let line = [];
  for (let i = 0; i < points.length - 1; i += CHUNK - 1) {
    const part = points.slice(i, i + CHUNK);
    const coords = part.map((p) => p.join(',')).join(';');
    const radiuses = part.map(() => 20).join(';');
    let json = await osrmFetch(`${base}/match/v1/driving/${coords}?overview=full&geometries=geojson&radiuses=${radiuses}&gaps=ignore&tidy=false`);
    let geometry = json?.code === 'Ok' && json.matchings?.length === 1 && json.tracepoints?.every(Boolean) ? json.matchings[0].geometry.coordinates : null;
    if (!geometry) {
      matchFallbacks++;
      if (pause) await sleep(pause);
      json = await osrmFetch(`${base}/route/v1/driving/${coords}?overview=full&geometries=geojson`);
      geometry = json?.code === 'Ok' ? json.routes[0].geometry.coordinates : null;
    }
    if (pause) await sleep(pause);
    if (!geometry) return base !== PUBLIC_OSRM ? osrmRoute(points, PUBLIC_OSRM) : null;
    line = line.length ? line.concat(geometry.slice(1)) : geometry;
  }
  return line;
}
let matchFallbacks = 0;

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
// PDF jízdní řády DSZO: jen kvůli písmenům u spojů (8d, 38g…).
let dszoPdf = null;
if (zipUrl) {
  console.log(`Balík jízdních řádů: ${zipUrl}`);
  try {
    const bytes = new Uint8Array(await (await fetch(zipUrl, { headers: UA })).arrayBuffer());
    let files = unzipSync(bytes);
    dszoPdf = files;
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
        tt = { startDate, days: part.days, lines: withStopNames(part), rawTrips: part.rawTrips, source: url, gtfs: bytes };
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
  for (const line of tt.lines)
    for (const d of line.directions)
      for (const v of d.variants) if (v.coords) v.coords = v.coords.map((c, i) => (c ? correct(v.stops[i], c[0], c[1]) : c));
  for (const t of tt.rawTrips ?? []) t.stops = t.stops.map(([n, lat, lon]) => [n, ...correct(n, lat, lon)]);
  const { checked, moved, sum, paired } = correct.stats;
  console.log(`Polohy zastávek podle OSM: opraveno ${moved} z ${checked} nástupišť (průměrně o ${moved ? Math.round(sum / moved) : 0} m), doprostřed mezi protější nástupiště ${paired}.`);
}

// MHD Kroměříže a Valašského Meziříčí (ze stejného GTFS IDZK, polohy zastávek bez opravy podle OSM).
if (tt?.gtfs) {
  try {
    tt.rawTrips.push(...cityTrips(tt.gtfs, { startDate: tt.startDate, days: tt.days, log: (m) => console.log(m) }));
  } catch (err) {
    console.warn(`MHD dalších měst se nepodařilo zpracovat: ${err.stack}`);
  }
  delete tt.gtfs;
}

// Ostatní autobusy oblasti: regionální linky IDS JMK (bez MHD měst) a regionální, dálkové a mezinárodní
// linky z celostátních jízdních řádů. Spoje, které už v datech jsou, se přeskočí.
if (tt?.rawTrips) {
  const region = JSON.parse(readFileSync(new URL('../public/region.json', import.meta.url), 'utf8'));
  const download = async (url) => {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  try {
    tt.rawTrips.push(...kordisTrips(await download(process.env.KORDIS_GTFS_URL ?? KORDIS_GTFS_URL), { startDate: tt.startDate, days: tt.days, log: (m) => console.log(m) }));
  } catch (err) {
    console.warn(`Jízdní řády IDS JMK se nepodařilo zpracovat: ${err.stack}`);
  }
  try {
    const bytes = await download(process.env.NATIONAL_GTFS_URL ?? NATIONAL_GTFS_URL);
    tt.rawTrips.push(...nationalTrips(bytes, { startDate: tt.startDate, days: tt.days, region, known: knownEvents(tt.rawTrips), log: (m) => console.log(m) }));
  } catch (err) {
    console.warn(`Celostátní jízdní řády autobusů se nepodařilo zpracovat: ${err.stack}`);
  }
}

// Vlaky přes kraj (až po opravě poloh zastávek: ta platí jen pro autobusová nástupiště).
if (tt?.rawTrips) {
  try {
    const url = process.env.RAIL_GTFS_URL ?? RAIL_GTFS_URL;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const region = JSON.parse(readFileSync(new URL('../public/region.json', import.meta.url), 'utf8'));
    const trains = railTrips(bytes, { startDate: tt.startDate, days: tt.days, region, log: (m) => console.log(m) });
    tt.rawTrips.push(...trains);
    // Kontrola: jde mezi sousedními stanicemi v kraji najít cestu po kolejích (kreslení trasy vlaku)?
    const railsFile = new URL('../public/rails.json', import.meta.url);
    if (existsSync(railsFile)) {
      const net = new RailNetwork(JSON.parse(readFileSync(railsFile, 'utf8')).lines);
      const pairs = new Map();
      for (const t of trains)
        for (let i = 1; i < t.stops.length; i++) {
          const [a, b] = [t.stops[i - 1], t.stops[i]];
          if (regionContains(region, a[2], a[1]) && regionContains(region, b[2], b[1])) pairs.set(`${a[0]} → ${b[0]}`, [a, b]);
        }
      const missing = [...pairs].filter(([, [a, b]]) => !net.path([a[1], a[2]], [b[1], b[2]])).map(([k]) => k);
      console.log(`Trasy vlaků po kolejích: ${pairs.size - missing.length} z ${pairs.size} úseků v kraji${missing.length ? `, chybí: ${missing.slice(0, 30).join('; ')}` : ''}.`);
    }
  } catch (err) {
    console.warn(`Jízdní řády vlaků se nepodařilo zpracovat: ${err.stack}`);
  }
}

mkdirSync(TT_DIR, { recursive: true });
if (tt) {
  // Data pro vyhledávání spojení a seznam linek (filtr).
  const planner = tt.rawTrips ? buildPlannerFromTrips(tt) : buildPlannerData(tt);
  if (dszoPdf) applyMarks(planner, dszoMarks(dszoPdf));
  // Výbava vlaků z celostátních jízdních řádů SŽ.
  const numbers = new Set(planner.patterns.filter((p) => p.y === 'v').map((p) => p.n));
  if (numbers.size) {
    try {
      const year = timetableYear();
      let res;
      for (const y of [year, year - 1, year + 1]) {
        res = await fetch(CZPTT_URL(y), { headers: UA });
        if (res.ok) break;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      planner.equip = railEquipment(new Uint8Array(await res.arrayBuffer()), numbers);
      console.log(`Výbava vlaků: ${Object.keys(planner.equip).length} z ${numbers.size} vlaků.`);
    } catch (err) {
      console.warn(`Výbavu vlaků se nepodařilo načíst: ${err.message}`);
    }
  }
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
const previousBus = (await previousDeploy('routes-bus.json'))?.routes ?? [];
const cache = new Map([...previous, ...previousBus].filter((r) => r.key && r.line?.length > 1).map((r) => [r.key, r.line]));

const routes = [];
if (tt?.previous) {
  // Jízdní řády z minula: ponecháme i jejich trasy.
  routes.push(...previous.filter((r) => r.dir));
}
let routed = 0, cached = 0, missing = 0, shaped = 0, detoursRemoved = 0;
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
      // Verze v klíči: trasy spočítané dřív jinak (přes zastávky napevno) se přepočítají.
      const key = `m1|${points.map((p) => p.join(',')).join(';')}`;
      let geometry = cache.get(key);
      if (geometry) cached++;
      else {
        geometry = await osrmRoute(points);
        if (geometry) { geometry = simplifyLine(geometry); routed++; }
      }
      // Kličky, kterými se vůz jen otáčí (zastávka chycená na špatné straně), z trasy vyřízneme.
      let cleaned = geometry ?? [];
      if (cleaned.length > 2) {
        const before = cleaned.length;
        cleaned = removeDetours(cleaned, located);
        if (cleaned.length !== before) detoursRemoved++;
      }
      routes.push({ ref: line.ref, type: line.type, dir: dir.id, to: dir.headsign, stops: located, line: cleaned, key });
    }
  }
}

// MHD dalších měst a regionální autobusy dopravců, jejichž vozy ukazujeme: trasa po silnicích pro varianty
// spojů (jako u DSZO), aby ji aplikace nemusela skládat po kouscích přes veřejný OSRM. Kratší varianty,
// které delší už pokrývají, přeskočíme. Nově počítané trasy mají časový limit, zbytek dopočítá další běh
// (hotové trasy se berou z minulého nasazení).
let cityRouted = 0;
const busRoutes = [];
if (!tt?.previous) {
  const routedNetwork = (c) => c in CITIES || !!CARRIERS[c]?.live;
  const deadline = Date.now() + (LOCAL_OSRM ? 120 : 25) * 60 * 1000;
  let postponed = 0;
  const variants = new Map();
  for (const t of tt?.rawTrips ?? []) {
    if (!t.city || !routedNetwork(t.city)) continue;
    const key = `${t.city}:${t.ref}|${t.stops.map((s) => s[0]).join('|')}`;
    if (!variants.has(key)) variants.set(key, t);
  }
  const coveredPairs = new Set();
  for (const t of [...variants.values()].sort((a, b) => b.stops.length - a.stops.length)) {
    const ref = `${t.city}:${t.ref}`;
    const pairs = t.stops.slice(1).map((s, i) => `${ref}|${t.stops[i][0]}|${s[0]}`);
    if (pairs.every((p) => coveredPairs.has(p))) continue;
    const located = t.stops.filter((s) => s[1] != null);
    if (located.length < 2) continue;
    const points = located.map((s) => [s[2], s[1]]);
    const key = `m1|${points.map((p) => p.join(',')).join(';')}`;
    let geometry = cache.get(key);
    if (geometry) cached++;
    else {
      if (Date.now() > deadline) { postponed++; continue; }
      geometry = await osrmRoute(points);
      if (!geometry) continue;
      geometry = simplifyLine(geometry);
      cityRouted++;
    }
    for (const p of pairs) coveredPairs.add(p);
    const line = geometry.length > 2 ? removeDetours(geometry, located) : geometry;
    const stops = located.map(([n, lat, lon]) => [cityStopName(t.city, n), lat, lon]);
    (t.city in CITIES ? routes : busRoutes).push({ ref, type: 'bus', city: t.city, dir: 'c', to: stops.at(-1)[0], stops, line, key });
  }
  console.log(`Trasy MHD dalších měst: ${routes.filter((r) => r.city).length} variant, regionálních autobusů: ${busRoutes.length} variant (nově spočítané ${cityRouted}, odloženo na příště ${postponed}).`);
} else {
  busRoutes.push(...previousBus);
}
writeFileSync(BUS_ROUTES, JSON.stringify({ generated: new Date().toISOString(), routes: busRoutes }));

// Linky, které v jízdních řádech chybí, necháme z OpenStreetMap.
const covered = new Set(routes.filter((r) => r.line.length > 1).map((r) => r.ref));
const osmFallback = osm.routes.filter((r) => !covered.has(r.ref));
// Slovník poloh zastávek (pro trasu podle jízdního řádu vozu): OSM doplněné o zastávky z jízdních řádů.
const stopDict = { ...osm.stops };
for (const r of routes) if (!r.city) for (const [name, lat, lon] of r.stops) stopDict[normalizeName(name)] ??= [lat, lon];
writeFileSync(ROUTES, JSON.stringify({ generated: new Date().toISOString(), routes: [...routes, ...osmFallback], stops: stopDict, platforms: osm.platforms ?? [] }));
console.log(`Trasy podle zastávek: ${routes.length} (tvar z jízdních řádů ${shaped}, nově spočítané ${routed}, z cache ${cached}), bez poloh zastávek ${missing}, z OSM navíc ${osmFallback.length}.`);
// Kontrola: kolik tras se někde otáčí do protisměru (dřív a teď).
const turning = (list) => list.filter((r) => r.dir && uTurns(r.line).length);
const before = turning(previous);
const after = turning(routes);
console.log(`Trasy s otočkou do protisměru: předtím ${before.length} z ${previous.filter((r) => r.dir).length}, teď ${after.length} z ${routes.length} (bez přiřazení k silnici počítáno ${matchFallbacks}×, ${LOCAL_OSRM ? 'vlastní OSRM' : 'veřejný OSRM'}, kličky odstraněny u ${detoursRemoved} tras).`);
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
