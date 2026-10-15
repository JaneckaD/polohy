// Ověření Kraje Vysočina na skutečných datech: proxy /vdv (lokálně) proti nasazeným jízdním řádům.
import { preparePlanner } from '../../src/planner.js';
import { parseVdv } from '../../src/idsok.js';
import worker from '../../proxy/worker.js';
const LIVE = 'https://janeckad.github.io/polohy/';
const P = preparePlanner(await (await fetch(LIVE + 'tt/planner.json')).json());
const region = await (await fetch(LIVE + 'region.json')).json();
console.log('region parts', Object.keys(region.properties.parts));
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
const ctx = { P, region, date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
const tally = (list, f) => JSON.stringify(Object.entries(list.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]));
const ctxw = { waitUntil() {} };
let data;
for (let i = 0; i < 8; i++) {
  const t0 = Date.now();
  const res = await worker.fetch(new Request('https://x.workers.dev/vdv'), {}, ctxw);
  data = await res.json();
  console.log('round', i, res.status, data.list.length, 'se spojem', data.list.filter((s) => s.serviceNumber).length, Date.now() - t0, 'ms');
  await new Promise((r) => setTimeout(r, 10500));
}
const vv = data.list.map((s) => parseVdv(s, ctx)).filter(Boolean);
console.log(`VDV: ${data.list.length} spojů, ${vv.length} vozů na Vysočině, se spojem ${vv.filter((v) => v.tripId != null).length}, číslo spoje ${vv.filter((v) => v.tripNo).length}`);
console.log('city/type', tally(vv, (v) => `${v.city}/${v.type}`), 'op', tally(vv, (v) => v.operatorName));
for (const v of vv.filter((v) => v.tripId == null).slice(0, 15)) { const s = data.list.find((x) => `vdv-${x.id}` === v.id); console.log('  bez spoje', JSON.stringify(s)); }
for (const v of vv.slice(0, 4)) console.log('  vzor', JSON.stringify({ line: v.line, type: v.type, next: v.next, headsign: v.headsign, op: v.operatorName, delay: v.delayText, tripNo: v.tripNo }));
const trains = await (await worker.fetch(new Request('https://x.workers.dev/trains'), {}, ctxw)).json();
console.log('trains', trains.source ?? 'sz', trains.trains.length, 'west of 15.5:', trains.trains.filter((t) => t.x < -650000 || t.lon < 15.5).length);
const vys = P.trips.filter((t) => { const s = P.stops[t.pattern.s[0]]; return s.lat && s.lon < 16 && s.lon > 15 && s.lat > 49 && s.lat < 49.7; });
console.log('jízdní řády kolem Jihlavy', vys.length, tally(vys, (t) => `${t.pattern.c}/${t.pattern.y ?? ''}`).slice(0, 300));
console.log('MHD Jihlava', tally(P.trips.filter((t) => /Jihlav/i.test(t.pattern.o ?? '')), (t) => `${t.pattern.o}/${t.pattern.y}`));
const flix = await (await worker.fetch(new Request('https://x.workers.dev/flix'), {}, ctxw)).json();
console.log('flix', flix.buses.length, flix.buses.map((b) => `${b.code} ${b.lat.toFixed(2)},${b.lon.toFixed(2)}`).join(' | '));
