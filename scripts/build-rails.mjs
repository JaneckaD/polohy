// Všechny železniční tratě v oblasti aplikace (Zlínský a Jihomoravský kraj) z OpenStreetMap,
// do public/rails.json. Na mapě se kreslí jako koleje a po nich trasy vlaků.
//
// Výstup: { generated, lines: [[[lon, lat], …], …] }

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildRails } from './rails-lib.mjs';
import { overpass, previousDeploy } from './overpass.mjs';

// CZ-72 = Zlínský kraj, CZ-64 = Jihomoravský kraj. Koleje z tras osobních vlaků (relace route=train)
// a k tomu všechny ostatní tratě (i nákladní a úzkorozchodné), bez vleček, kolejišť a výhybek
// (service), aby mapa ve stanicích nebyla jen změť kolejí.
const QUERY = `
[out:json][timeout:300];
area["ISO3166-2"~"^CZ-(72|64)$"]["boundary"="administrative"]->.kraj;
relation["type"="route"]["route"="train"](area.kraj)->.r;
(
  way(r.r)["railway"~"^(rail|narrow_gauge|light_rail)$"](area.kraj);
  way["railway"~"^(rail|narrow_gauge)$"][!"service"](area.kraj);
);
out geom;
node["railway"~"^(station|halt)$"]["name"](area.kraj);
out;
`;

const OUT = new URL('../public/rails.json', import.meta.url);
const PBF_EXPORT = new URL('../railcache/rails.geojsonseq', import.meta.url);

/**
 * Koleje z exportu dat Geofabriku (scripts/rails-pbf.sh) ve tvaru odpovědi Overpass:
 * tratě bez vleček a kolejišť (service) jako cesty s geometrií, stanice a zastávky jako body.
 */
function fromPbfExport(text) {
  const elements = [];
  for (const row of text.split('\n')) {
    const json = row.replace(/^\x1e/, '').trim();
    if (!json) continue;
    const f = JSON.parse(json);
    const tags = f.properties ?? {};
    const id = Number(String(f.id ?? '').slice(1));
    if (f.geometry?.type === 'LineString' && /^(rail|narrow_gauge)$/.test(tags.railway) && !tags.service) {
      elements.push({ type: 'way', id, tags, geometry: f.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })) });
    } else if (f.geometry?.type === 'Point' && /^(station|halt)$/.test(tags.railway) && tags.name) {
      const [lon, lat] = f.geometry.coordinates;
      elements.push({ type: 'node', id, tags, lat, lon });
    }
  }
  return { elements };
}

// Nejdřív data Geofabriku (spolehlivé), jinak Overpass.
let data = null;
if (existsSync(PBF_EXPORT)) {
  data = fromPbfExport(readFileSync(PBF_EXPORT, 'utf8'));
  console.log(`Koleje z dat Geofabriku: ${data.elements.filter((e) => e.type === 'way').length} úseků.`);
  if (!data.elements.some((e) => e.type === 'way')) data = null;
}
data ??= await overpass(QUERY);
const rails = data && buildRails(data);
if (!rails?.lines.length) {
  const previous = await previousDeploy('rails.json');
  if (previous?.lines?.length) {
    console.warn(`Tratě se nepodařilo stáhnout, používám tratě z posledního nasazení (${previous.lines.length} čar).`);
    writeFileSync(OUT, JSON.stringify(previous));
  } else {
    console.warn('Tratě se nepodařilo stáhnout, ukládám prázdný soubor.');
    writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), lines: [] }));
  }
  process.exit(0);
}
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), lines: rails.lines }));
const points = rails.lines.reduce((n, l) => n + l.length, 0);
console.log(`Tratě v oblasti: ${rails.ways} úseků → ${rails.lines.length} čar, ${points} bodů.`);

// Kontrola: osobní stanice a zastávky z OSM by měly ležet u některé z nakreslených tratí.
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 110574, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));
const near = (pt) => {
  let best = Infinity;
  for (const line of rails.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = [line[i - 1][1], line[i - 1][0]];
      const b = [line[i][1], line[i][0]];
      const steps = Math.max(1, Math.ceil(metres(a, b) / 20));
      for (let t = 0; t <= steps; t++) best = Math.min(best, metres(pt, [a[0] + ((b[0] - a[0]) * t) / steps, a[1] + ((b[1] - a[1]) * t) / steps]));
    }
  }
  return Math.round(best);
};
const stations = data.elements.filter((e) => e.type === 'node' && e.tags?.name);
const far = stations.map((s) => [s.tags.name, near([s.lat, s.lon])]).filter(([, d]) => d > 100);
console.log(`Kontrola tratí: ${stations.length} stanic a zastávek, daleko od nakreslené koleje ${far.length}${far.length ? `: ${far.map(([n, d]) => `${n} ${d} m`).join(', ')}` : ''}`);
