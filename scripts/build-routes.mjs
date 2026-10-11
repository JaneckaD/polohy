// Stáhne trasy linek MHD Zlín-Otrokovice z OpenStreetMap (Overpass API) a uloží je
// do public/routes.json. Spouští se při sestavení v GitHub Actions, DSZO trasy linek
// s polohou zastávek veřejně nedává.
//
// Výstup: { generated, routes: [{ ref, type, from, to, stops: [[name, lat, lon]], line: [[lon, lat]] }],
//           stops: { normalizovaný název: [lat, lon] } }

import { writeFileSync } from 'node:fs';
import { buildRoutes } from './routes-lib.mjs';

const BBOX = '49.10,17.38,49.33,17.85';
const QUERY = `
[out:json][timeout:180];
(
  relation["type"="route"]["route"~"^(bus|trolleybus)$"](${BBOX});
  node["public_transport"~"^(platform|stop_position)$"]["name"](${BBOX});
  node["highway"="bus_stop"]["name"](${BBOX});
)->.all;
.all out body;
.all >;
out body qt;
`;

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OUT = new URL('../public/routes.json', import.meta.url);

async function download() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)',
        },
        body: 'data=' + encodeURIComponent(QUERY),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`Overpass ${url} selhal: ${err.message}`);
    }
  }
  return null;
}

const data = await download();
if (!data) {
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
