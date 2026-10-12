import { readGtfsFiles } from '../../scripts/gtfs-lib.mjs';
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36' };
const sec = (t) => console.log(`\n===== ${t} =====`);
async function get(url, opt = {}) {
  try {
    const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers ?? {}) }, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    return { status: r.status, text, headers: Object.fromEntries(r.headers) };
  } catch (e) { return { status: 'ERR ' + e.message, text: '' }; }
}
const show = async (url, n = 1500, opt) => { const r = await get(url, opt); console.log(`--- ${url} -> ${r.status} (${r.text.length} B)\n${r.text.slice(0, n)}`); return r; };

// 1) JMK stream fill rate
sec('JMK stream');
await new Promise((done) => {
  const ws = new WebSocket('wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe');
  const ids = new Set(); const t0 = Date.now(); let first = null; let msgs = 0;
  ws.onopen = () => console.log('open', Date.now() - t0, 'ms');
  ws.onmessage = (e) => { msgs++; if (!first) { first = e.data; console.log('first after', Date.now() - t0, 'ms:', String(e.data).slice(0, 600)); } try { const a = JSON.parse(e.data).attributes; if (a) ids.add(a.ID); } catch {} };
  ws.onerror = (e) => console.log('ws err', e.message);
  for (const s of [1, 2, 3, 5, 8, 12, 20, 30, 40]) setTimeout(() => { console.log(`${s}s vehicles=${ids.size} msgs=${msgs}`); if (s === 40) { ws.close(); done(); } }, s * 1000);
});

sec('gis.brno.cz REST');
await show('https://gis.brno.cz/ags4/rest/services/Kordis_stream/StreamServer?f=json', 4000);
await show('https://gis.brno.cz/ags1/rest/services?f=json', 3000);
await show('https://gis.brno.cz/ags1/rest/services/Hosted?f=json', 6000);
await show('https://gis.brno.cz/ags4/rest/services?f=json', 3000);
await show('https://www.arcgis.com/sharing/rest/content/items/e8aa121910df41bb9a28e4ca34a263c7?f=json', 3000);
await show('https://www.arcgis.com/sharing/rest/search?q=Kordis%20polohy&f=json&num=20', 6000);

// 3) ODIS mpvnet
sec('mpvnet ODIS');
const odisHtml = await show('https://mpvnet.cz/odis/map', 2500);
for (const m of odisHtml.text.matchAll(/(?:src|href)="([^"]+\.js[^"]*)"/g)) console.log('script', m[1]);
for (const path of ['odis', 'ok', 'olomouc', 'idsok', 'msk']) {
  const r = await get(`https://mpvnet.cz/${path}/map/mapData`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz' }, body: JSON.stringify({ w: 16.6, s: 49.2, e: 18.9, n: 50.5, zoom: 13, showStops: false, mapFilterId: null }) });
  console.log(`--- mpvnet ${path} mapData -> ${r.status} ${r.text.length} B`);
  try {
    const d = JSON.parse(r.text);
    console.log('keys', Object.keys(d));
    const tr = d.transmitters ?? [];
    console.log('transmitters', tr.length);
    if (tr[0]) console.log(JSON.stringify(tr.slice(0, 4)));
    const by = (f) => { const c = {}; for (const t of tr) { const k = f(t); c[k] = (c[k] ?? 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 40); };
    console.log('cat', JSON.stringify(by((t) => t.cat)));
    console.log('ico', JSON.stringify(by((t) => t.ico)));
    console.log('cr', JSON.stringify(by((t) => t.cr)));
    console.log('lic', JSON.stringify(by((t) => String(t.cn ?? '').split('|')[0].slice(0, 3))));
    console.log('cn samples', tr.slice(0, 12).map((t) => t.cn).join('\n'));
  } catch (e) { console.log(r.text.slice(0, 300)); }
}

// 4) IDSOK
sec('IDSOK cestujok');
for (const u of ['https://www.cestujok.cz/idspublic/', 'https://cestujok.cz/idspublic/', 'https://www.cestujok.cz/', 'https://idsok.cz/']) {
  const r = await show(u, 2500);
  for (const m of r.text.matchAll(/(?:src|href)="([^"]+\.(?:js|json)[^"]*)"/g)) {
    const src = new URL(m[1], u).href;
    console.log('script', src);
    if (/idspublic|main|app|chunk|map/i.test(src)) {
      const js = await get(src);
      const urls = new Set([...js.text.matchAll(/["'`]((?:https?:)?\/?[\w./-]*(?:api|Api|ashx|svc|json|vehicle|Vehicle|poloh|map)[\w./?=&-]*)["'`]/g)].map((x) => x[1]).filter((x) => x.length < 120));
      console.log('  urls in', src, [...urls].slice(0, 80).join(' | '));
    }
  }
}

// 5) national GTFS
sec('national GTFS');
const t0 = Date.now();
const res = await fetch('https://data.jr.ggu.cz/results/latest/JDF_merged_GTFS.zip', { headers: UA });
const bytes = new Uint8Array(await res.arrayBuffer());
console.log('size', bytes.length, 'ms', Date.now() - t0);
const agencies = new Map(); const routes = [];
const stopsIn = { olk: 0, msk: 0 };
readGtfsFiles(bytes, {
  'agency.txt': (r) => agencies.set(r.agency_id, r.agency_name),
  'routes.txt': (r) => routes.push(r),
  'stops.txt': (r) => { const la = +r.stop_lat, lo = +r.stop_lon; if (la > 49.5 && lo > 17.6) stopsIn.msk++; else if (la > 49.3 && lo > 16.7 && lo <= 17.6) stopsIn.olk++; },
});
console.log('stops approx', stopsIn);
const cnt = {}; for (const r of routes) cnt[r.route_type] = (cnt[r.route_type] ?? 0) + 1; console.log('route types', cnt);
console.log('route cols', Object.keys(routes[0]));
const mhd = routes.filter((r) => ['704', '800', '900', '715', '3', '0', '11'].includes(r.route_type));
const byAg = {}; for (const r of mhd) { const a = agencies.get(r.agency_id); (byAg[a] ??= []).push(`${r.route_type}:${r.route_short_name}/${r.route_long_name}`); }
for (const [a, list] of Object.entries(byAg)) if (/ostrav|olomouc|opav|havíř|karvin|frýdek|třin|těšín|přerov|prostěj|šumper|jesen|nový jičín|kopřiv|bruntál|krnov|hranic|zábřeh|orlov|bohum|frýdl|DPO|DPMO|MDPO|ČSAD|Arriva|TQM|3ČSAD|transdev|Vojtila|AUDIS|Veolia|BDS|Kolon/i.test(a) || list.length > 20) console.log(a, list.length, list.slice(0, 12).join(', '));
const reg = routes.filter((r) => r.route_type === '701').slice(0, 5);
console.log('701 samples', JSON.stringify(reg));
