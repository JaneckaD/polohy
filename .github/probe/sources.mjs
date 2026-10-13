// IDSOK: adresy API z archivované aplikace cestujok.cz/idspublic a archivované odpovědi API.
const UA = { 'User-Agent': 'polohy-probe (github.com/JaneckaD/polohy)' };
async function get(url, timeout = 60000) {
  try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 'ERR ' + (e.cause?.code ?? e.message), text: '' }; }
}
const cfg = await get('https://web.archive.org/web/2026id_/https://www.cestujok.cz/idspublic/config/config.js');
console.log('=== config.js\n' + cfg.text);
const app = (await get('https://web.archive.org/web/2026id_/https://www.cestujok.cz/idspublic/app.js')).text;
console.log('\n=== api templates');
for (const m of new Set([...app.matchAll(/services\.api\}([^`"']{0,120})/g)].map((x) => x[1]))) console.log('  ', m);
console.log('\n=== contexts');
const seen = new Set();
for (const re of [/vehicle/gi, /position/gi, /poloh/gi, /delay/gi, /signalr|websocket|hub/gi, /mapMode/g]) {
  let n = 0;
  for (const m of app.matchAll(re)) {
    const i = m.index; const key = Math.round(i / 400);
    if (seen.has(key)) continue; seen.add(key);
    console.log(`--- ${re} @${i}: ${app.slice(Math.max(0, i - 250), i + 350).replace(/\s+/g, ' ')}`);
    if (++n >= 8) break;
  }
}
for (const q of ['cestujok.cz/idspublicservices/*', 'www.cestujok.cz/idspublicservices/*']) {
  const r = await get(`http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(q)}&output=json&limit=300&collapse=urlkey&fl=timestamp,original,statuscode,mimetype`);
  console.log(`\n=== CDX ${q} -> ${r.status}`);
  try { for (const row of JSON.parse(r.text).slice(1)) console.log(row.join(' ')); } catch { console.log(r.text.slice(0, 300)); }
}
