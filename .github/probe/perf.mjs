// Dočasné měření: kde aplikace tráví čas (start, posun mapy, výběr vozu) – profil JS a dlouhé úlohy.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const LIVE = 'https://janeckad.github.io/polohy/';
const DIST = path.resolve('dist');
const mime = (f) => (f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream');

function top(profile, n = 25) {
  const self = new Map();
  const byId = new Map(profile.nodes.map((x) => [x.id, x]));
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const node = byId.get(id);
    const cf = node.callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  return [`total ${total.toFixed(0)} ms`, ...[...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`)].join('\n');
}

async function run(label, viewport, dpr, throttle, mobile) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', timezoneId: 'Europe/Prague', locale: 'cs-CZ' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.route(LIVE + '?debug', (r) => r.fulfill({ body: fs.readFileSync(path.join(DIST, 'index.html')), contentType: 'text/html' }));
  await p.route(LIVE + 'assets/**', (r) => {
    const f = path.join(DIST, new URL(r.request().url()).pathname.replace('/polohy/', ''));
    return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: mime(f) }) : r.continue();
  });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await p.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
    window.__frames = [];
    let last = performance.now();
    const loop = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  await p.goto(LIVE + '?debug', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(25000);
  let prof = (await cdp.send('Profiler.stop')).profile;
  const long = await p.evaluate(() => window.__long.splice(0));
  console.log(`\n##### ${label} (CPU ${throttle}x) START 25 s: vozů ${await p.evaluate(() => window.__dbg?.store.allVehicles().length)}, značek ${await p.evaluate(() => document.querySelectorAll('.maplibregl-marker').length)}`);
  console.log(`dlouhé úlohy: ${long.length}, součet ${long.reduce((a, b) => a + b, 0)} ms, největší ${long.sort((a, b) => b - a).slice(0, 10).join(', ')}`);
  console.log(top(prof));
  // Posun a oddálení mapy.
  const box = await p.locator('.maplibregl-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.evaluate(() => { window.__frames = []; window.__long = []; });
  await cdp.send('Profiler.start');
  for (let i = 0; i < 6; i++) {
    await p.mouse.move(cx, cy); await p.mouse.down();
    for (let k = 1; k <= 20; k++) await p.mouse.move(cx + (i % 2 ? -1 : 1) * k * 10, cy + (i % 3 - 1) * k * 4);
    await p.mouse.up(); await p.waitForTimeout(300);
  }
  await p.evaluate(() => window.__map.zoomTo(10, { duration: 0 }));
  await p.waitForTimeout(1500);
  for (let i = 0; i < 4; i++) {
    await p.mouse.move(cx, cy); await p.mouse.down();
    for (let k = 1; k <= 20; k++) await p.mouse.move(cx + (i % 2 ? -1 : 1) * k * 10, cy);
    await p.mouse.up(); await p.waitForTimeout(300);
  }
  prof = (await cdp.send('Profiler.stop')).profile;
  const f = (await p.evaluate(() => window.__frames.splice(0))).slice(1).sort((a, b) => a - b);
  const q = (x) => f[Math.min(f.length - 1, Math.floor(f.length * x))]?.toFixed(0);
  console.log(`\n##### ${label} POSUN: snímků ${f.length}, p50 ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${f.at(-1)?.toFixed(0)} ms, dlouhé úlohy ${(await p.evaluate(() => window.__long)).join(', ')}`);
  console.log(top(prof, 20));
  // Klid 20 s (obnovy dat, animace).
  await p.evaluate(() => { window.__frames = []; window.__long = []; });
  await cdp.send('Profiler.start');
  await p.waitForTimeout(20000);
  prof = (await cdp.send('Profiler.stop')).profile;
  console.log(`\n##### ${label} KLID 20 s: dlouhé úlohy ${(await p.evaluate(() => window.__long)).join(', ')}`);
  console.log(top(prof, 20));
  await b.close();
}
await run('PC 1440x900', { width: 1440, height: 900 }, 1, 2, false);
await run('mobil 390x844', { width: 390, height: 844 }, 3, 4, true);
