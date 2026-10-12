import { readGtfsFiles } from '../../scripts/gtfs-lib.mjs';
let t0 = Date.now();
const res = await fetch('https://www.spojenka.cz/jrdata/jizdnirady-gtfs.zip', { headers: { 'User-Agent': 'polohy-probe (github.com/JaneckaD/polohy)' } });
console.log('status', res.status, JSON.stringify(Object.fromEntries(res.headers)));
const bytes = new Uint8Array(await res.arrayBuffer());
console.log('size', bytes.length, 'ms', Date.now() - t0);
const files = {};
const agencies = new Map(); const routes = []; let stopsN = 0, stopsZero = 0; const box = { olk: [0, 0], msk: [0, 0] };
const sampleStops = [];
readGtfsFiles(bytes, {
  'agency.txt': (r) => agencies.set(r.agency_id, r.agency_name),
  'routes.txt': (r) => routes.push(r),
  'stops.txt': (r) => { stopsN++; const la = +r.stop_lat, lo = +r.stop_lon; if (!la) stopsZero++; if (/^Olomouc|^Ostrava/.test(r.stop_name) && sampleStops.length < 10) sampleStops.push(r); },
  'feed_info.txt': (r) => console.log('feed_info', JSON.stringify(r)),
});
console.log('stops', stopsN, 'without coords', stopsZero);
for (const s of sampleStops) console.log('stop', JSON.stringify(s));
const cnt = {}; for (const r of routes) cnt[r.route_type] = (cnt[r.route_type] ?? 0) + 1; console.log('route types', JSON.stringify(cnt));
console.log('route cols', Object.keys(routes[0]).join(','));
for (const re of [/Ostrava/i, /Olomouc/i, /Opava/i]) {
  const rs = routes.filter((r) => re.test(agencies.get(r.agency_id) ?? ''));
  const c = {}; for (const r of rs) c[r.route_type] = (c[r.route_type] ?? 0) + 1;
  console.log(re, rs.length, JSON.stringify(c), rs.filter((r) => r.route_type === '0' || r.route_type === '900' || r.route_type === '11' || r.route_type === '800').slice(0, 6).map((r) => `${r.route_type}:${r.route_short_name}/${r.route_long_name}/${r.route_id}`).join(' | '), rs.slice(0, 4).map((r) => `${r.route_type}:${r.route_short_name}/${r.route_id}`).join(' | '));
}
console.log('agencies sample', [...agencies.values()].filter((a) => /ostrav|olomouc|opav|odis|idsok/i.test(a)).join(' | '));
let trips = 0; const tripSample = [];
readGtfsFiles(bytes, { 'trips.txt': (r) => { trips++; if (tripSample.length < 3) tripSample.push(r); } });
console.log('trips', trips, JSON.stringify(tripSample));
