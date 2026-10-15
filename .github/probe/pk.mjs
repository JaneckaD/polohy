// Pardubický kraj (3): API mapy IREDO (iredo.online/map/mapData) a mhdonline.cz (MHD Pardubice).
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
const js = await (await fetch('https://iredo.online/main.js', { headers: { 'User-Agent': UA } })).text();
for (const kw of ['/map/mapData', 'mapData', '/map/', 'tripDetail', 'apiUrl', 'environment']) {
  let i = js.indexOf(kw), n = 0;
  while (i >= 0 && n < 6) { console.log(`[${kw}] ${js.slice(Math.max(0, i - 400), i + 600).replace(/\s+/g, ' ')}\n`); i = js.indexOf(kw, i + 1); n++; }
}
const urls = new Set([...js.matchAll(/["'`](\/(?:map|api|stop|trip|vehicle|line)[a-zA-Z0-9_\-/]*)["'`]/g)].map((m) => m[1]));
console.log('PATHS', [...urls].join(' '));
const box = { w: 15.3, s: 49.45, e: 16.95, n: 50.2, zoom: 13, showStops: false, mapFilterId: null };
for (const [origin, body] of [['https://iredo.online', box], ['https://iredo.online', { ...box, zoom: 10 }]]) {
  try {
    const r = await fetch('https://iredo.online/map/mapData', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json; charset=utf-8', Origin: origin, Referer: origin + '/' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log(`\n=== mapData ${r.status} len ${t.length}\n${t.slice(0, 4000)}`);
  } catch (e) { console.log('ERR', e.message); }
}
const d = await (await fetch('https://online.dpmp.cz/assets/index-BJteUtzo.js', { headers: { 'User-Agent': UA } })).text();
for (const kw of ['api.mhdonline.cz', 'vehicles', 'positions', 'socket', 'firestore', 'onSnapshot']) {
  let i = d.indexOf(kw), n = 0;
  while (i >= 0 && n < 4) { console.log(`[DPMP ${kw}] ${d.slice(Math.max(0, i - 300), i + 500).replace(/\s+/g, ' ')}\n`); i = d.indexOf(kw, i + 1); n++; }
}
