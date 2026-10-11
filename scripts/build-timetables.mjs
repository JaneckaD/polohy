// Stáhne jízdní řády DSZO (balík JDF z dszo.cz), uloží je pro aplikaci do public/tt/
// a pro každou linku a směr spočítá trasu po silnicích přes její zastávky (OSRM).
// Běží v GitHub Actions po scripts/build-routes.mjs, který připraví polohy zastávek z OpenStreetMap.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { readJdf, buildTimetables } from './jdf-lib.mjs';
import { locateStops, simplifyLine } from './routes-lib.mjs';

const UA = { 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' };
const ROUTES = new URL('../public/routes.json', import.meta.url);
const TT_DIR = new URL('../public/tt/', import.meta.url);
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Trasa po silnicích přes zadané body [lon, lat]. Dlouhé trasy dělíme na kusy.
async function osrmRoute(points) {
  const CHUNK = 40;
  let line = [];
  for (let i = 0; i < points.length - 1; i += CHUNK - 1) {
    const part = points.slice(i, i + CHUNK);
    const url = `${OSRM}${part.map((p) => p.join(',')).join(';')}?overview=full&geometries=geojson&continue_straight=true`;
    let json = null;
    for (let attempt = 0; attempt < 3 && !json; attempt++) {
      try {
        const res = await fetch(url, { headers: UA });
        if (res.ok) json = await res.json();
        else if (res.status === 429) await sleep(5000);
      } catch {
        await sleep(2000);
      }
    }
    if (json?.code !== 'Ok') return null;
    const coords = json.routes[0].geometry.coordinates;
    line = line.length ? line.concat(coords.slice(1)) : coords;
    await sleep(1100); // veřejný server OSRM: nejvýš ~1 dotaz za sekundu
  }
  return line;
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
      // Spojení: každá část má vlastní seznam názvů zastávek, linky převedeme na názvy.
      const lines = new Map();
      for (const part of parts) {
        for (const line of part.lines) {
          const withNames = {
            ...line,
            directions: line.directions.map((d) => ({
              ...d,
              stops: d.stops.map((i) => part.stopNames[i]),
              variants: d.variants.map((v) => ({ ...v, stops: v.stops.map((i) => part.stopNames[i]) })),
            })),
          };
          if (!lines.has(line.ref)) lines.set(line.ref, withNames);
        }
      }
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
  // Bez nových dat ponecháme jízdní řády z posledního nasazení.
  const index = await previousDeploy('tt/index.json');
  if (index?.lines?.length) {
    const lines = [];
    for (const l of index.lines) {
      const full = await previousDeploy(`tt/${l.ref}.json`);
      if (full) lines.push(full);
    }
    tt = { startDate: index.startDate, days: index.days, lines };
    console.warn(`Používám jízdní řády z posledního nasazení (${lines.length} linek).`);
  }
}

mkdirSync(TT_DIR, { recursive: true });
if (tt) {
  for (const line of tt.lines) {
    writeFileSync(new URL(`${line.ref}.json`, TT_DIR), JSON.stringify({ ...line, startDate: tt.startDate, days: tt.days }));
  }
  writeFileSync(
    new URL('index.json', TT_DIR),
    JSON.stringify({
      startDate: tt.startDate,
      days: tt.days,
      lines: tt.lines.map((l) => ({ ref: l.ref, type: l.type, directions: l.directions.map((d) => ({ id: d.id, headsign: d.headsign, from: d.stops[0] })) })),
    }),
  );
} else {
  writeFileSync(new URL('index.json', TT_DIR), JSON.stringify({ lines: [] }));
}

// --- 2. Trasy po silnicích podle zastávek ------------------------------------
const osm = existsSync(ROUTES) ? JSON.parse(readFileSync(ROUTES, 'utf8')) : { routes: [], stops: {} };
const previous = (await previousDeploy('routes.json'))?.routes ?? [];
const cache = new Map(previous.filter((r) => r.key && r.line?.length > 1).map((r) => [r.key, r.line]));

const routes = [];
let routed = 0, cached = 0, missing = 0;
for (const line of tt?.lines ?? []) {
  for (const dir of line.directions) {
    const total = dir.variants.reduce((s, v) => s + v.count, 0);
    // Varianty, kterými jezdí aspoň 10 % spojů směru (nejvýš 3).
    const variants = dir.variants.filter((v, i) => i === 0 || v.count >= total * 0.1).slice(0, 3);
    for (const v of variants) {
      const stops = locateStops(v.stops, osm.stops);
      const located = stops.filter((s) => s[1] != null);
      if (located.length < 2) { missing++; continue; }
      const points = located.map((s) => [s[2], s[1]]);
      const key = points.map((p) => p.join(',')).join(';');
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
writeFileSync(ROUTES, JSON.stringify({ generated: new Date().toISOString(), routes: [...routes, ...osmFallback], stops: osm.stops }));
console.log(`Trasy podle zastávek: ${routes.length} (nově spočítané ${routed}, z cache ${cached}), bez poloh zastávek ${missing}, z OSM navíc ${osmFallback.length}.`);
const unlocated = new Set();
for (const line of tt?.lines ?? []) for (const d of line.directions) for (const s of locateStops(d.stops, osm.stops)) if (s[1] == null) unlocated.add(s[0]);
if (unlocated.size) console.log(`Zastávky bez polohy v OSM (${unlocated.size}): ${[...unlocated].slice(0, 40).join('; ')}`);
