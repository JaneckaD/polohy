// Stáhne trasy linek MHD Zlín-Otrokovice z OpenStreetMap (Overpass API) a uloží je
// do public/routes.json. Spouští se při sestavení v GitHub Actions, DSZO trasy linek
// s polohou zastávek veřejně nedává.
//
// Výstup: { generated, routes: [{ ref, type, from, to, stops: [[name, lat, lon]], line: [[lon, lat]] }],
//           stops: { normalizovaný název: [lat, lon] } }

import { writeFileSync } from 'node:fs';
import { buildRoutes } from './routes-lib.mjs';
import { overpass, previousDeploy } from './overpass.mjs';

const BBOX = '49.10,17.38,49.33,17.85';
// Trasy se stahují i s geometrií (out geom), takže Overpass nemusí rekurzivně
// dohledávat všechny cesty a body. Regionální linky (3–6místná čísla) vynecháme už v dotazu.
const QUERY = `
[out:json][timeout:120];
relation["type"="route"]["route"~"^(bus|trolleybus)$"]["ref"~"^[0-9]{1,2}$"](${BBOX})->.r;
.r out geom;
node(r.r);
out body;
node["public_transport"~"^(platform|stop_position)$"]["name"](${BBOX});
out body;
node["highway"="bus_stop"]["name"](${BBOX});
out body;
`;

const OUT = new URL('../public/routes.json', import.meta.url);

const data = await overpass(QUERY);
if (!data) {
  const json = await previousDeploy('routes.json');
  const previous = json?.routes?.length ? json : null;
  if (previous) {
    console.warn(`Overpass nejde, používám trasy z posledního nasazení (${previous.routes.length} variant).`);
    writeFileSync(OUT, JSON.stringify(previous));
    process.exit(0);
  }
  // Bez tras aplikace funguje dál, jen po klepnutí na vůz neukáže trasu.
  console.warn('Trasy se nepodařilo stáhnout, ukládám prázdný soubor.');
  writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), routes: [], stops: {} }));
  process.exit(0);
}

const result = buildRoutes(data);
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), ...result }));

const refs = [...new Set(result.routes.map((r) => r.ref))].sort((a, b) => a - b);
console.log(`Uloženo ${result.routes.length} variant tras, ${Object.keys(result.stops).length} zastávek.`);
console.log(`Linky: ${refs.join(', ')}`);
