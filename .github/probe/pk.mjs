// Kraj Vysočina: jaké požadavky posílá mapa VDV (mapavdv.kr-vysocina.cz) v prohlížeči.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const seen = [];
page.on('request', (r) => { if (!/\.(png|jpg|svg|css|woff2?|ico)(\?|$)|tile|google|fonts/.test(r.url())) seen.push(r); });
page.on('websocket', (ws) => { console.log('WS', ws.url()); ws.on('framereceived', (f) => console.log('WS frame', String(f.payload).slice(0, 800))); });
await page.goto('https://mapavdv.kr-vysocina.cz/', { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.log('goto', e.message));
await page.waitForTimeout(15000);
console.log('URL now', page.url(), 'title', await page.title());
for (const r of seen) {
  const res = await r.response().catch(() => null);
  let body = '';
  try { body = res ? (await res.text()).slice(0, 2500) : ''; } catch {}
  console.log(`\n--- ${r.method()} ${r.url()} -> ${res?.status()} ${res?.headers()['content-type'] ?? ''}`);
  if (r.method() !== 'GET' || /json|api|data|vehic|position|map/i.test(r.url()) && !/\.js(\?|$)/.test(r.url())) {
    console.log('REQ HEADERS', JSON.stringify(await r.allHeaders()));
    if (r.postData()) console.log('BODY', r.postData().slice(0, 500));
    console.log(body);
  }
}
await browser.close();
