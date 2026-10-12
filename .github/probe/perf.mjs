// Dočasné měření plynulosti na živých datech (nasazený web, místní neminifikovaný build).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const LIVE = 'https://janeckad.github.io/polohy/';
const DIST = path.resolve('dist');
const mime = (f) => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream';

async function run(label, viewport, dpr, throttle, mobile) {
  const b = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', timezoneId: 'Europe/Prague', locale: 'cs-CZ' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.route(LIVE, (r) => r.fulfill({ body: fs.readFileSync(path.join(DIST, 'index.html')), contentType: 'text/html' }));
  await p.route(LIVE + 'assets/**', (r) => {
    const f = path.join(DIST, new URL(r.request().url()).pathname.replace('/polohy/', ''));
    return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: mime(f) }) : r.continue();
  });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await p.addInitScript(() => {
    window.__frames = [];
    let last = performance.now();
    const loop = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await p.goto(LIVE, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(20000);
  const info = await p.evaluate(() => ({ markers: document.querySelectorAll('.maplibregl-marker').length, nodes: document.getElementsByTagName('*').length, status: document.getElementById('status')?.textContent }));
  console.log(`\n##### ${label} (throttle ${throttle}x) load+20s`, JSON.stringify(info));
  const stats = async (name) => {
    const r = await p.evaluate(() => { const f = window.__frames.splice(0); const l = window.__long.splice(0); return { f, l }; });
    const f = r.f.slice(1); f.sort((a, b) => a - b);
    const q = (x) => f[Math.min(f.length - 1, Math.floor(f.length * x))]?.toFixed(1);
    console.log(`${name}: frames ${f.length} p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${f.at(-1)?.toFixed(0)} | >50ms ${f.filter((x) => x > 50).length} | longtasks ${r.l.length} sum ${r.l.reduce((a, b) => a + b, 0).toFixed(0)}ms max ${Math.max(0, ...r.l).toFixed(0)}`);
  };
  await stats('load');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  const phases = [];
  async function phase(name, fn) {
    await cdp.send('Profiler.start');
    await fn();
    const { profile } = await cdp.send('Profiler.stop');
    await stats(name);
    phases.push([name, profile]);
  }
  const box = await p.locator('.maplibregl-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await phase('idle 20s', () => p.waitForTimeout(20000));
  await phase('pan', async () => {
    for (let i = 0; i < 6; i++) {
      await p.mouse.move(cx, cy); await p.mouse.down();
      for (let k = 1; k <= 20; k++) await p.mouse.move(cx + (i % 2 ? -1 : 1) * k * 12, cy + k * 4);
      await p.mouse.up(); await p.waitForTimeout(400);
    }
  });
  await phase('zoom out + pan', async () => {
    for (let i = 0; i < 6; i++) { await p.mouse.move(cx, cy); await p.mouse.wheel(0, 300); await p.waitForTimeout(250); }
    await p.waitForTimeout(1500);
    for (let i = 0; i < 6; i++) {
      await p.mouse.move(cx, cy); await p.mouse.down();
      for (let k = 1; k <= 20; k++) await p.mouse.move(cx + (i % 2 ? -1 : 1) * k * 15, cy - k * 3);
      await p.mouse.up(); await p.waitForTimeout(400);
    }
  });
  await phase('zoomed out idle 15s', () => p.waitForTimeout(15000));
  const info2 = await p.evaluate(() => ({ markers: document.querySelectorAll('.maplibregl-marker').length, zoom: window.__map?.getZoom?.() }));
  console.log('after', JSON.stringify(info2));
  for (const [name, prof] of phases) {
    const self = new Map(); let total = 0;
    const dt = prof.timeDeltas; const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    prof.samples.forEach((id, i) => {
      const n = byId.get(id); const cf = n.callFrame;
      const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
      const d = dt[i] / 1000; total += d; self.set(key, (self.get(key) ?? 0) + d);
    });
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 28);
    console.log(`--- ${label} / ${name}: ${total.toFixed(0)} ms sampled`);
    for (const [k, v] of top) console.log(`  ${v.toFixed(0).padStart(6)} ms ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
    // inclusive time of app functions (src files)
    const incl = new Map();
    const parent = new Map(); for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const hits = new Map(); prof.samples.forEach((id, i) => hits.set(id, (hits.get(id) ?? 0) + dt[i] / 1000));
    for (const [id, d] of hits) {
      const seen = new Set();
      for (let cur = id; cur != null; cur = parent.get(cur)) {
        const cf = byId.get(cur).callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
        if (!/index-.*\.js|main|vehicles|filter/.test(cf.url) || seen.has(key)) continue;
        seen.add(key); incl.set(key, (incl.get(key) ?? 0) + d);
      }
    }
    console.log('  inclusive app (top 25):');
    for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v.toFixed(0).padStart(6)} ms  ${k}`);
  }
  await b.close();
  void t0;
}
await run('PC 1440x900', { width: 1440, height: 900 }, 1, 2, false);
await run('mobil 390x844', { width: 390, height: 844 }, 3, 4, true);
