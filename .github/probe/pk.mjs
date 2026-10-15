import { pceProtocol } from '../../proxy/worker.js';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
const show = async (label, p) => { try { const r = await p; const t = await r.text(); console.log(label, r.status, r.headers.get('content-type'), t.length, t.slice(0, 1500).replace(/\s+/g, ' ')); return t; } catch (e) { console.log(label, 'ERR', e.cause?.code ?? e.message); return ''; } };
for (const site of ['https://jihlava.mhdonline.cz', 'http://jihlava.mhdonline.cz', 'https://trebic.mhdonline.cz', 'https://zdar.mhdonline.cz', 'https://havlickuvbrod.mhdonline.cz', 'https://pelhrimov.mhdonline.cz']) {
  const html = await show(`PAGE ${site}`, fetch(site + '/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }));
  const srcs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
  for (const s of srcs.slice(0, 6)) {
    try {
      const js = await (await fetch(new URL(s, site), { headers: { 'User-Agent': UA } })).text();
      const hits = [...js.matchAll(/.{0,120}(api\/|key|vehicles|buses|Protocol|15\*60).{0,160}/g)].map((m) => m[0]).slice(0, 12);
      console.log(' JS', s, js.length, '\n   ' + hits.join('\n   '));
    } catch (e) { console.log(' JS', s, 'ERR', e.message); }
  }
}
const seed = 'your-public-protocol-seed';
for (const city of ['jihlava', 'trebic']) for (const origin of [`https://${city}.mhdonline.cz`, 'https://online.dpmp.cz']) {
  await show(`API ${city} ${origin}`, fetch(`https://api.mhdonline.cz/${city}/vehicles`, { headers: { Accept: 'application/json', Origin: origin, Referer: origin + '/', 'X-App-Protocol': await pceProtocol(seed), 'User-Agent': UA } }));
}
await show('KMSTYLE', fetch('https://jihlava.mhdonline.cz/api/buses', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'User-Agent': UA }, body: '{}' }));
