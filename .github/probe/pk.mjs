// Pardubický kraj (5): jaké požadavky posílá online.dpmp.cz (MHD Pardubice) v prohlížeči.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const seen = [];
page.on('request', (r) => { if (!/\.(png|jpg|svg|css|woff2?)(\?|$)|tile\.openstreetmap|rsms\.me|google/.test(r.url())) seen.push(r); });
page.on('websocket', (ws) => { console.log('WS', ws.url()); ws.on('framereceived', (f) => console.log('WS frame', String(f.payload).slice(0, 600))); });
await page.goto('https://online.dpmp.cz/', { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.log('goto', e.message));
await page.waitForTimeout(15000);
console.log('URL now', page.url());
for (const r of seen) {
  const res = await r.response().catch(() => null);
  let body = '';
  try { body = res ? (await res.text()).slice(0, 1500) : ''; } catch {}
  console.log(`\n--- ${r.method()} ${r.url()} -> ${res?.status()}`);
  if (/mhdonline|dpmp/.test(r.url()) && !/assets/.test(r.url())) {
    console.log('REQ HEADERS', JSON.stringify(await r.allHeaders()));
    console.log(body);
  }
}
await browser.close();
