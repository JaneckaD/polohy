import { chromium } from 'playwright';
const b = await chromium.launch();
const page = await b.newPage();
const seen = [];
page.on('response', async (r) => {
  const u = r.url();
  const t = r.request().resourceType();
  if (!['xhr', 'fetch', 'websocket', 'script', 'document', 'eventsource'].includes(t)) return;
  let body = '';
  if (t !== 'script') try { body = (await r.text()).slice(0, 700); } catch {}
  seen.push(u);
  console.log('RESP', t, r.status(), r.request().method(), u, JSON.stringify(r.request().headers()).slice(0, 300), '\n   ', body.replace(/\s+/g, ' '));
});
page.on('websocket', (ws) => { console.log('WS', ws.url()); ws.on('framereceived', (f) => console.log('WSF', String(f.payload).slice(0, 500))); });
try { await page.goto('https://sgis.jihlava-city.cz/web/mhd/', { waitUntil: 'networkidle', timeout: 60000 }); } catch (e) { console.log('GOTO', e.message); }
await page.waitForTimeout(15000);
console.log('HTML', (await page.content()).slice(0, 3000));
for (const s of await page.$$eval('script[src]', (x) => x.map((e) => e.src))) {
  const js = await (await fetch(s)).text().catch(() => '');
  console.log('JS', s, js.length, [...js.matchAll(/.{0,100}(https?:\/\/[^"'`\s]+|\/api\/[^"'`\s]+|vehicle|poloh|position).{0,100}/gi)].map((m) => m[0]).slice(0, 25).join('\n     '));
}
await b.close();
