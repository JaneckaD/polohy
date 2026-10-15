import { preparePlanner } from '../../src/planner.js';
import { parseVdv } from '../../src/idsok.js';
import { krajOf } from '../../src/region.js';
import worker from '../../proxy/worker.js';
const show = async (label, url, opts) => { try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://sgis.jihlava-city.cz/' }, signal: AbortSignal.timeout(10000), ...opts }); const t = await r.text(); console.log(label, r.status, r.headers.get('content-type'), r.headers.get('access-control-allow-origin'), t.length, t.slice(0, 3500).replace(/\s+/g, ' ')); return t; } catch (e) { console.log(label, 'ERR', e.cause?.code ?? e.message); return ''; } };
const S = 'https://gis.jihlava-city.cz/server1/rest/services/verejnost/Ji_MHD_aktualni/MapServer';
await show('L47', `${S}/47?f=json`);
await show('Q47', `${S}/47/query?where=1%3D1&outFields=*&outSR=4326&returnGeometry=true&f=json`);
await show('Q50', `${S}/50/query?where=1%3D1&outFields=*&outSR=4326&returnGeometry=true&f=json`);
await show('Q53', `${S}/53/query?where=1%3D1&outFields=*&outSR=4326&returnGeometry=true&f=json&resultRecordCount=3`);
await show('API', 'https://dopravaapi.jihlava-city.cz/');
await show('APIsw', 'https://dopravaapi.jihlava-city.cz/swagger/index.html');
await show('APIsw2', 'https://dopravaapi.jihlava-city.cz/swagger/v1/swagger.json');
// Které MHD Vysočiny je v jízdních řádech a které z nich posílá mapa VDV.
const LIVE = 'https://janeckad.github.io/polohy/';
const P = preparePlanner(await (await fetch(LIVE + 'tt/planner.json')).json());
const region = await (await fetch(LIVE + 'region.json')).json();
const towns = {};
for (const t of P.trips) { if (t.pattern.c !== 'town') continue; const s = P.stops[t.pattern.s[0]]; if (krajOf(region, s.lon, s.lat) !== 'vys') continue; const k = `${t.pattern.o}|${t.pattern.r.slice(0, 3)}`; towns[k] = (towns[k] ?? 0) + 1; }
console.log('TOWNS', JSON.stringify(Object.entries(towns).sort((a, b) => b[1] - a[1])));
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
const ctx = { P, region, date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
const H = { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://mapavdv.kr-vysocina.cz/', 'User-Agent': 'Mozilla/5.0' };
const pts = await (await fetch('https://mapavdv.kr-vysocina.cz/Ajax/GetPoints', { headers: H })).json();
console.log('VDV prefixes in vys', JSON.stringify(Object.entries(pts.filter((p) => p.id > 0 && krajOf(region, p.lng, p.lat) === 'vys').reduce((m, p) => ((m[String(p.text).slice(0, 4)] = (m[String(p.text).slice(0, 4)] ?? 0) + 1), m), {})).sort()));
console.log('VDV short texts', JSON.stringify(pts.filter((p) => p.id > 0 && String(p.text).length < 6)));
let data;
for (let i = 0; i < 5; i++) { data = await (await worker.fetch(new Request('https://x/vdv'), {}, { waitUntil() {} })).json(); await new Promise((r) => setTimeout(r, 10500)); }
const vv = data.list.map((s) => parseVdv(s, ctx)).filter(Boolean);
console.log('VDV town', JSON.stringify(vv.filter((v) => v.city === 'town').map((v) => `${v.operatorName} ${v.licence} ${v.line} ${v.tripId != null}`)));
