// Ověření nového rozdělení OK/MSK: regionální linky a MHD z celostátních dat (polohy zastávek ze Spojenky),
// MHD dopravních podniků ze Spojenky; pak přiřazení živých vozů ODIS ke spojům.
import { readFileSync } from 'node:fs';
import { nationalTrips, spojenkaTrips, spojenkaStopCoords, NATIONAL_GTFS_URL, SPOJENKA_GTFS_URL } from '../../scripts/area-buses.mjs';
import { buildPlannerFromTrips, packTrips } from '../../scripts/planner-data.mjs';
import { preparePlanner } from '../../src/planner.js';
import { parseOdis } from '../../src/odis.js';
import { estimatedVehicles, setLiveTrips, setOdisUp } from '../../src/estimated.js';
import { krajOf } from '../../src/region.js';
const region = JSON.parse(readFileSync('public/region.json', 'utf8'));
const dl = async (u) => new Uint8Array(await (await fetch(u, { headers: { 'User-Agent': 'polohy-probe (github.com/JaneckaD/polohy)' } })).arrayBuffer());
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
const date = `${parts.year}-${parts.month}-${parts.day}`;
const min = Number(parts.hour) * 60 + Number(parts.minute);
const [ggu, spoj] = await Promise.all([dl(NATIONAL_GTFS_URL), dl(SPOJENKA_GTFS_URL)]);
const log = (m) => console.log(m.slice(0, 1500));
const coords = spojenkaStopCoords(spoj, region);
console.log('polohy Spojenky', coords.size);
const rawTrips = [
  ...nationalTrips(ggu, { startDate: date, days: 2, region, skipKraje: new Set(['olk', 'msk']), coords, log }),
  ...spojenkaTrips(spoj, { startDate: date, days: 2, region, log }),
];
const inK = (t) => t.stops.filter(([, la, lo]) => la != null && ['olk', 'msk'].includes(krajOf(region, lo, la))).length * 2 >= t.stops.length;
const ok = rawTrips.filter(inK);
console.log('OK/MSK spojů', ok.length, JSON.stringify(ok.reduce((c, t) => ((c[`${t.city}/${t.type}`] = (c[`${t.city}/${t.type}`] ?? 0) + 1), c), {})));
const nullStops = ok.reduce((a, t) => a + t.stops.filter(([, la]) => la == null).length, 0);
console.log('zastavení bez polohy', nullStops);
const built = buildPlannerFromTrips({ startDate: date, days: 2, rawTrips });
if (packTrips) packTrips(built);
const P = preparePlanner(JSON.parse(JSON.stringify(built)));
console.log('planner', P.trips.length, 'spojů', P.stops.length, 'zastávek');
const r = await fetch('https://mpvnet.cz/odis/map/mapData', { method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0 Chrome/129', 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz' }, body: JSON.stringify({ w: 16.8, s: 49.3, e: 18.95, n: 50.5, zoom: 13, showStops: false, mapFilterId: null }) });
const tr = (await r.json()).transmitters;
const vs = tr.map((x) => parseOdis(x, { P, region, date, min })).filter(Boolean);
const by = (f, list) => { const c = {}; for (const v of list) { const k = f(v); c[k] = (c[k] ?? 0) + 1; } return JSON.stringify(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 30)); };
console.log(`ODIS ${tr.length} → vozů ${vs.length}, se spojem ${vs.filter((v) => v.calls).length}`);
console.log('city/type', by((v) => `${v.city}/${v.type}/${v.calls ? 'spoj' : 'BEZ'}`, vs));
console.log('bez spoje podle dopravce', by((v) => v.operatorName, vs.filter((v) => !v.calls)));
for (const v of vs.filter((v) => !v.calls).slice(0, 20)) console.log('  bez spoje', v.licence, v.line, v.tripNo, v.operatorName, v.next, '→', v.headsign);
setLiveTrips(new Set(vs.filter((v) => v.tripId != null).map((v) => v.tripId)));
setOdisUp(vs.length > 20);
const est = estimatedVehicles(P, region, date, min);
console.log(`odhad: ${est.length} vozů`, by((v) => `${v.city}/${v.type}/${krajOf(region, v.lon, v.lat)}`, est));
const towns = {}; for (const t of P.trips) if (t.pattern.c === 'town') towns[t.pattern.o] = (towns[t.pattern.o] ?? 0) + 1; console.log('MHD měst', JSON.stringify(towns).slice(0, 1500));
// 1791827675
