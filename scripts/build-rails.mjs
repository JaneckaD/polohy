// Tratě, po kterých ve Zlínském kraji jezdí osobní vlaky (OpenStreetMap, relace route=train),
// do public/rails.json. Na mapě se kreslí jako koleje, dopravci se zatím nepřidávají.
//
// Výstup: { generated, lines: [[[lon, lat], …], …] }

import { writeFileSync } from 'node:fs';
import { buildRails } from './rails-lib.mjs';
import { overpass, previousDeploy } from './overpass.mjs';

// CZ-72 = Zlínský kraj. Koleje z tras osobních vlaků (relace route=train) a k tomu hlavní
// a vedlejší tratě bez vleček a kolejišť, protože některé regionální tratě (např. Vlárská dráha
// nebo Luhačovice) relaci vlaku v OSM nemají. Čistě nákladní tratě vynecháme.
const QUERY = `
[out:json][timeout:180];
area["ISO3166-2"="CZ-72"]["boundary"="administrative"]->.kraj;
relation["type"="route"]["route"="train"](area.kraj)->.r;
(
  way(r.r)["railway"~"^(rail|narrow_gauge|light_rail)$"](area.kraj);
  way["railway"="rail"]["usage"~"^(main|branch)$"][!"service"]["railway:traffic_mode"!="freight"]["passenger"!="no"](area.kraj);
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
