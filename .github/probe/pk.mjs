// MHD Pardubice: jak mapa počítá hlavičku x-app-protocol.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/129';
const html = await (await fetch('https://online.dpmp.cz/', { headers: { 'User-Agent': UA } })).text();
const src = /<script[^>]+src="([^"]+\.js)"/.exec(html)[1];
const js = await (await fetch(new URL(src, 'https://online.dpmp.cz').href, { headers: { 'User-Agent': UA } })).text();
for (const kw of ['x-app-protocol', 'X-App-Protocol', 'app-protocol', 'appProtocol', 'sha256', 'SHA-256', 'crypto.subtle', 'digest(']) {
  let i = js.indexOf(kw), n = 0;
  while (i >= 0 && n < 4) { console.log(`[${kw}] ${js.slice(Math.max(0, i - 1200), i + 600)}\n`); i = js.indexOf(kw, i + 1); n++; }
}
console.log('hex64', [...new Set(js.match(/\b[0-9a-f]{64}\b/g) ?? [])]);
