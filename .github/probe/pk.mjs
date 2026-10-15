// Pardubický kraj (4): co posílá mapa IREDO a API mhdonline.cz.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
const post = async (body) => (await fetch('https://iredo.online/map/mapData', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const all = await post({ w: 14.5, s: 49.2, e: 17.5, n: 50.9, zoom: 13, showStops: false, mapFilterId: null });
const c = all.connections;
const tally = (f) => Object.entries(c.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
console.log('total', c.length, 'keys', Object.keys(all));
console.log('bbox lat', Math.min(...c.map((x) => x.lat)), Math.max(...c.map((x) => x.lat)), 'lon', Math.min(...c.map((x) => x.lon)), Math.max(...c.map((x) => x.lon)));
console.log('src/veh', JSON.stringify(tally((x) => `${x.sourceType}/${x.vehicleType}/${x.lineType}`)));
console.log('operators', JSON.stringify(tally((x) => x.operator)));
console.log('licence prefix', JSON.stringify(tally((x) => String(x.lineNumber ?? '').slice(0, 3))));
for (const x of c.filter((x) => x.lineType === 'A' || x.vehicleType !== 'A').slice(0, 25)) console.log(JSON.stringify(x));
const small = await post({ w: 15.7, s: 50.0, e: 15.85, n: 50.08, zoom: 13, showStops: false, mapFilterId: null });
console.log('small box', small.connections.length);
for (const city of ['pardubice', 'dpmp', 'Pardubice']) {
  try { const r = await fetch(`https://api.mhdonline.cz/${city}/vehicles`, { headers: { 'User-Agent': UA, Accept: 'application/json', Origin: 'https://online.dpmp.cz' } }); const t = await r.text(); console.log(`\nmhdonline ${city} ${r.status} len ${t.length}\n${t.slice(0, 2500)}`); } catch (e) { console.log(city, 'ERR', e.message); }
}
const d = await (await fetch('https://online.dpmp.cz/assets/index-BJteUtzo.js', { headers: { 'User-Agent': UA } })).text();
for (const kw of ['/vehicles`', 'tenant', 'cityId', 'operatorId', 'useParams', 'VITE_']) { let i = d.indexOf(kw), n = 0; while (i >= 0 && n < 3) { console.log(`[DPMP ${kw}] ${d.slice(Math.max(0, i - 300), i + 300).replace(/\s+/g, ' ')}\n`); i = d.indexOf(kw, i + 1); n++; } }
