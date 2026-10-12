import { readGtfsFiles } from '../../scripts/gtfs-lib.mjs';
const bytes = new Uint8Array(await (await fetch('https://data.jr.ggu.cz/results/latest/JDF_merged_GTFS.zip')).arrayBuffer());
const agencies = new Map(); const routes = new Map(); const trips = new Map(); const stops = new Map(); const services = new Map(); const cdates = new Map();
readGtfsFiles(bytes, {
  'agency.txt': (r) => agencies.set(r.agency_id, r.agency_name),
  'routes.txt': (r) => { const a = r.agency_id; routes.set(r.route_id, r); },
  'stops.txt': (r) => stops.set(r.stop_id, r),
  'calendar.txt': (r) => services.set(r.service_id, r),
  'calendar_dates.txt': (r) => cdates.set(r.service_id, (cdates.get(r.service_id) ?? 0) + 1),
});
const want = [...routes.values()].filter((r) => r.route_type === '900' || /Olomouc/i.test(agencies.get(r.agency_id) ?? '') && r.route_type === '704');
const byAg = {}; for (const r of want) { const a = agencies.get(r.agency_id); byAg[a] = (byAg[a] ?? 0) + 1; }
console.log('900 + DPMO routes by agency', JSON.stringify(byAg));
console.log('sample 900', JSON.stringify(want.filter((r) => r.route_type === '900').slice(0, 5)));
const wantIds = new Set(want.map((r) => r.route_id));
readGtfsFiles(bytes, { 'trips.txt': (r) => wantIds.has(r.route_id) && trips.set(r.trip_id, r) });
console.log('trips', trips.size, JSON.stringify([...trips.values()].slice(0, 3)));
const svc = [...new Set([...trips.values()].map((t) => t.service_id))].slice(0, 5);
for (const s of svc) console.log('service', s, JSON.stringify(services.get(s)), 'dates', cdates.get(s));
let rows = 0; const sample = []; const tripsWithRows = new Set();
readGtfsFiles(bytes, { 'stop_times.txt': (r) => { if (trips.has(r.trip_id)) { rows++; tripsWithRows.add(r.trip_id); if (sample.length < 8) sample.push(r); } } });
console.log('stop_times rows', rows, 'trips with rows', tripsWithRows.size);
for (const r of sample) console.log(JSON.stringify(r), JSON.stringify(stops.get(r.stop_id)));
