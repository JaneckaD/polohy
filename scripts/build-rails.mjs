// Tratě, po kterých ve Zlínském kraji jezdí osobní vlaky (OpenStreetMap, relace route=train),
// do public/rails.json. Na mapě se kreslí jako koleje, dopravci se zatím nepřidávají.
//
// Výstup: { generated, lines: [[[lon, lat], …], …] }

import { writeFileSync } from 'node:fs';
import { buildRails } from './rails-lib.mjs';
import { overpass, previousDeploy } from './overpass.mjs';

// CZ-72 = Zlínský kraj. Koleje z tras osobních vlaků (relace route=train) a k tomu hlavní
// všechny ostatní tratě bez vleček a kolejišť (service), protože některé regionální tratě
// (např. Vlárská dráha nebo Luhačovice) relaci vlaku ani značku usage v OSM nemají.
// Průmyslové a čistě nákladní tratě vynecháme.
const QUERY = `
[out:json][timeout:180];
area["ISO3166-2"="CZ-72"]["boundary"="administrative"]->.kraj;
relation["type"="route"]["route"="train"](area.kraj)->.r;
(
  way(r.r)["railway"~"^(rail|narrow_gauge|light_rail)$"](area.kraj);
  way["railway"="rail"][!"service"]["usage"!~"^(industrial|military|test|freight)$"]["railway:traffic_mode"!="freight"]["passenger"!="no"](area.kraj);
);
out geom;
`;

const OUT = new URL('../public/rails.json', import.meta.url);

const data = await overpass(QUERY);
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
console.log(`Tratě s osobní dopravou: ${rails.ways} úseků → ${rails.lines.length} čar, ${points} bodů.`);

// Kontrola: stanice, kudy jezdí osobní vlaky, by měly ležet u některé z tratí.
const CHECK = {
  'Otrokovice': [49.2096, 17.5306],
  'Zlín střed': [49.2252, 17.6709],
  'Vizovice': [49.2196, 17.8530],
  'Kroměříž': [49.2966, 17.4040],
  'Uherské Hradiště': [49.0699, 17.4630],
  'Uherský Brod': [49.0294, 17.6459],
  'Luhačovice': [49.1036, 17.7550],
  'Bojkovice': [49.0390, 17.8070],
  'Vsetín': [49.3374, 17.9937],
  'Valašské Meziříčí': [49.4706, 17.9670],
};
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 110574, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));
const near = (pt) => {
  let best = Infinity;
  for (const line of rails.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = [line[i - 1][1], line[i - 1][0]];
      const b = [line[i][1], line[i][0]];
      for (let t = 0; t <= 1; t += 0.1) best = Math.min(best, metres(pt, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
    }
  }
  return Math.round(best);
};
console.log(`Kontrola tratí (vzdálenost stanice od koleje): ${Object.entries(CHECK).map(([n, p]) => `${n} ${near(p)} m`).join(', ')}`);
