import { chromium } from 'playwright';

const b = await chromium.launch();
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp, serviceWorkers: 'block', timezoneId: 'Europe/Prague', geolocation: { latitude: 49.195, longitude: 16.608 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(name, 'pageerror:', e.message));
  p.on('console', (m) => m.type() === 'error' && console.log(name, 'console:', m.text().slice(0, 200)));
  let msgs = 0;
  p.on('websocket', (ws) => { console.log(name, 'ws', ws.url()); ws.on('framereceived', () => msgs++); ws.on('close', () => console.log(name, 'ws closed')); });
  await p.goto('https://janeckad.github.io/polohy/?debug');
  for (const s of [10, 25, 45]) {
    await p.waitForTimeout(s === 10 ? 10000 : s === 25 ? 15000 : 20000);
    const st = await p.evaluate(() => ({ status: document.getElementById('status')?.textContent, markers: document.querySelectorAll('.vehicle').length, zoom: window.__map?.getZoom(), dots: window.__map?.getSource('vehicle-dots') ? window.__map.querySourceFeatures('vehicle-dots').length : -1 }));
    console.log(name, `${s}s`, 'frames', msgs, JSON.stringify(st));
  }
  await p.evaluate(() => window.__map.jumpTo({ center: [16.6126, 49.1915], zoom: 15 }));
  await p.waitForTimeout(3000);
  const types = await p.evaluate(() => [...document.querySelectorAll('.vehicle')].map((e) => `${e.dataset.type}:${e.textContent}`).join(' '));
  console.log(name, 'z15 markers', types.slice(0, 600));
  const t = await p.$('.vehicle[data-type=tram]') ?? await p.$('.vehicle[data-type=bus]');
  if (t) {
    await t.dispatchEvent('click');
    await p.waitForTimeout(4000);
    console.log(name, 'sheet', (await p.textContent('#sheet')).replace(/\s+/g, ' ').slice(0, 500));
  }
  // whole region: dots mode + fps of pan
  await p.evaluate(() => window.__map.jumpTo({ center: [16.9, 49.1], zoom: 8.5 }));
  await p.waitForTimeout(3000);
  console.log(name, 'z8.5', JSON.stringify(await p.evaluate(() => ({ markers: document.querySelectorAll('.vehicle').length, status: document.getElementById('status')?.textContent }))));
  // planner: search Brno tram
  await ctx.close();
}
await b.close();
