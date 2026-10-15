import { preparePlanner } from '../../src/planner.js';
const LIVE = 'https://janeckad.github.io/polohy/';
const P = preparePlanner(await (await fetch(LIVE + 'tt/planner.json')).json());
const by = {};
for (const t of P.trips) { if (!/Jihlava|Beranov|Hybrálec/.test(t.pattern.o ?? '')) continue; const k = `${t.pattern.o}|${t.pattern.r}|${t.pattern.y}`; (by[k] ??= { n: 0, ends: new Set(), no: t.no }).n++; by[k].ends.add(`${P.stops[t.pattern.s[0]].name} > ${P.stops[t.pattern.s.at(-1)].name}`); }
for (const [k, v] of Object.entries(by)) console.log(k, v.n, 'no', v.no, [...v.ends].slice(0, 4).join(' ; '));
console.log('trip keys', Object.keys(P.trips[0]), 'pattern keys', Object.keys(P.trips[0].pattern));
const r = await (await fetch('https://gis.jihlava-city.cz/server1/rest/services/verejnost/Ji_MHD_aktualni/MapServer/47/query?where=1%3D1&outFields=*&returnGeometry=false&f=json')).json();
for (const f of r.features) console.log('LIVE', JSON.stringify(f.attributes));
