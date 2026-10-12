import { preparePlanner } from '../../src/planner.js';
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/129 Safari/537.36' };
// 1) ODIS details
const r = await fetch('https://mpvnet.cz/odis/map/mapData', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz' }, body: JSON.stringify({ w: 16.6, s: 49.2, e: 18.9, n: 50.5, zoom: 13, showStops: false, mapFilterId: null }) });
const d = await r.json();
const tr = d.transmitters;
console.log('ODIS transmitters', tr.length, 'refreshInterval', d.refreshInterval, 'external', JSON.stringify(d.external)?.slice(0, 500));
const by = (f, list = tr) => { const c = {}; for (const t of list) { const k = f(t); c[k] = (c[k] ?? 0) + 1; } return JSON.stringify(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 40)); };
console.log('t', by((t) => t.t), 'c', by((t) => t.c), 'dm', by((t) => t.dm));
for (const cat of [0, 1, 2, 3]) console.log(`cat ${cat}: t=${by((t) => t.t, tr.filter((t) => t.cat === cat))} cr=${by((t) => t.cr, tr.filter((t) => t.cat === cat))}`);
for (const re of [/^DPO/, /MDPO/, /Havířov.*MHD|pr\. Havířov/, /České dráhy/]) {
  console.log('---', re);
  for (const t of tr.filter((t) => re.test(t.cr)).slice(0, 10)) console.log(JSON.stringify(t));
}
console.log('--- other fields keys', [...new Set(tr.flatMap((t) => Object.keys(t)))].join(','));
console.log('--- cn field count', by((t) => String(t.cn).split('|').length));
// mpvnet route detail for a vehicle? map.js endpoints
const js = await (await fetch('https://mpvnet.cz/js/map.js', { headers: UA })).text();
console.log('map.js endpoints', [...new Set([...js.matchAll(/["'`](\/?[\w/]*(?:map|Map)\/[\w]+)["'`]/g)].map((m) => m[1]))].join(' '));
const i = js.indexOf('cn'); console.log(js.length);
for (const m of js.matchAll(/split\("\|"\)/g)) console.log('split ctx', js.slice(Math.max(0, m.index - 300), m.index + 900).replace(/\s+/g, ' '));

// 2) planner timing
const t0 = performance.now();
const res = await fetch('https://janeckad.github.io/polohy/tt/planner.json');
const text = await res.text();
const t1 = performance.now();
const json = JSON.parse(text);
const t2 = performance.now();
const P = preparePlanner(json);
const t3 = performance.now();
console.log(`planner ${(text.length / 1e6).toFixed(1)} MB: fetch ${Math.round(t1 - t0)} ms, parse ${Math.round(t2 - t1)} ms, prepare ${Math.round(t3 - t2)} ms; trips ${P.trips.length}, stops ${P.stops.length}, patterns ${json.patterns.length}`);
const nets = {}; for (const p of json.patterns) nets[p.c ?? 'dszo'] = (nets[p.c ?? 'dszo'] ?? 0) + 1; console.log('patterns per net', JSON.stringify(nets));
