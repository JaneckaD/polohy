import { eventKey } from '../../scripts/area-buses.mjs';
// Spojenka v OK/MSK: odkud spoje jsou (vazby relations) a kolik z nich už je v celostátních datech.
import { readFileSync } from 'node:fs';
import { readGtfsFiles } from '../../scripts/gtfs-lib.mjs';
import { nationalTrips, allEvents, NATIONAL_GTFS_URL, SPOJENKA_GTFS_URL } from '../../scripts/area-buses.mjs';
import { krajOf, regionContains } from '../../src/region.js';
const region = JSON.parse(readFileSync('public/region.json', 'utf8'));
const dl = async (u) => new Uint8Array(await (await fetch(u, { headers: { 'User-Agent': 'polohy-probe (github.com/JaneckaD/polohy)' } })).arrayBuffer());
const startDate = new Date().toISOString().slice(0, 10);
const [ggu, spoj] = await Promise.all([dl(NATIONAL_GTFS_URL), dl(SPOJENKA_GTFS_URL)]);
const G = nationalTrips(ggu, { startDate, days: 2, region, log: () => {} });
const known = allEvents(G);
console.log('GGU spojů', G.length, 'událostí', known.size);
const routes = new Map(); const agencies = new Map(); const stops = new Map();
readGtfsFiles(spoj, {
  'routes.txt': (r) => routes.set(r.route_id, r), 'agency.txt': (r) => agencies.set(r.agency_id, r.agency_name),
  'stops.txt': (r) => { const la = +r.stop_lat, lo = +r.stop_lon; const ins = la && regionContains(region, lo, la); stops.set(r.stop_id, { la, lo, k: ins ? krajOf(region, lo, la) : null }); },
});
const trips = new Map();
readGtfsFiles(spoj, { 'trips.txt': (r) => { const ro = routes.get(r.route_id); if (ro && ['0', '3', '11'].includes(ro.route_type)) trips.set(r.trip_id, r); } });
const per = new Map(); let cur = null, buf = [];
const flush = () => { if (cur) { const inK = buf.filter((x) => x.k === 'olk' || x.k === 'msk').length; if (inK >= 2 && inK * 2 >= buf.filter((x) => x.k).length) per.set(cur, buf); } buf = []; };
readGtfsFiles(spoj, { 'stop_times.txt': (r) => { if (r.trip_id !== cur) { flush(); cur = trips.has(r.trip_id) ? r.trip_id : null; } if (cur) { const s = stops.get(r.stop_id); const [h, m] = (r.departure_time || r.arrival_time).split(':').map(Number); buf.push({ ...s, t: h * 60 + m }); } } });
flush();

const stat = {}; const samples = {};
for (const [id, list] of per) {
  const tr = trips.get(id); const ro = routes.get(tr.route_id);
  const pre = [...new Set(String(tr.relations ?? '').split('|').filter(Boolean).map((x) => x.split(':')[0]))].sort().join('+') || '-';
  const ins = list.filter((x) => x.k);
  const dup = eventKey ? ins.filter((x) => known.has(eventKey(x.t % 1440, x.la, x.lo))).length >= ins.length * 0.6 : null;
  const k = `${ro.route_type} ${pre} ${dup ? 'DUP' : 'new'}`;
  stat[k] = (stat[k] ?? 0) + 1;
  (samples[k] ??= []).length < 4 && samples[k].push(`${ro.route_short_name}/${String(ro.route_long_name).slice(0, 50)}/${agencies.get(ro.agency_id)}/${tr.relations}`);
}
console.log('eventKey export', !!eventKey);
for (const [k, n] of Object.entries(stat).sort((a, b) => b[1] - a[1])) console.log(k, n, '|', samples[k].join(' || '));
