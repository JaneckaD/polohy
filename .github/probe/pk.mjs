const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
const H = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://mapavdv.kr-vysocina.cz/' };
const base = 'https://mapavdv.kr-vysocina.cz';
const pts = await (await fetch(`${base}/Ajax/GetPoints`, { headers: H })).json();
const odd = pts.filter((x) => String(x.text).length < 6 && x.traction !== 'TRAIN');
console.log('odd', JSON.stringify(odd));
const dec = (t) => t.replace(/&#x([0-9A-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
for (const p of odd.slice(0, 4)) console.log('TT', p.text, dec(await (await fetch(`${base}/Ajax/GetTimetable?vehicleNumber=${p.id}&currentStopId=0`, { headers: H })).text()).slice(0, 900));
// časování: kolik trvá 20 detailů
let t0 = Date.now();
await Promise.all(pts.slice(0, 20).map((p) => fetch(`${base}/Ajax/GetTimetable?vehicleNumber=${p.id}&currentStopId=0`, { headers: H }).then((r) => r.text())));
console.log('20 details ms', Date.now() - t0);
const raw = await (await fetch(`${base}/Ajax/GetTimetable?vehicleNumber=${pts[0].id}&currentStopId=0`, { headers: H })).text();
console.log('RAW', raw.slice(0, 3500));
for (const u of ['https://www.dpmj.cz/', 'https://dpmj.cz/', 'https://online.dpmj.cz/', 'https://mapa.dpmj.cz/', 'https://jihlava.mhdonline.cz/', 'https://api.mhdonline.cz/jihlava/vehicles', 'https://api.mhdonline.cz/trebic/vehicles', 'https://www.mhd-jihlava.cz/', 'https://jihlava.dopravniinfo.cz/', 'https://mpvnet.cz/vysocina/map', 'https://mpvnet.cz/jihlava/map', 'https://www.icomtransport.cz/']) {
  try { const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000), redirect: 'follow' }); const t = await r.text(); console.log('URL', u, r.status, r.url, t.length, t.replace(/\s+/g, ' ').match(/[^ ]{0,80}(online|poloh|mapa|map)[^ ]{0,80}/gi)?.slice(0, 12).join(' || ')); } catch (e) { console.log('URL', u, 'ERR', e.cause?.code ?? e.message); }
}
