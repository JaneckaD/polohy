// Dočasné A/B měření: co při posunu mapy stojí nejvíc (sklo, stíny značek, značky, vrstvy mapy).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const LIVE = 'https://janeckad.github.io/polohy/';
const DIST = path.resolve('dist');
const mime = (f) => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream';

const VARIANTS = [
  ['base', '', null],
  ['bez skla', '.glass{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}', null],
  ['bez stinu znacek', '.vehicle-dot{box-shadow:none!important}', null],
  ['bez znacek', '.maplibregl-marker{display:none!important}', null],
  ['bez koleji', '', /rail/i],
  ['bez srafy+kraju', '', /region|hatch|kraj|outside|mimo/i],
  ['bez popisku mapy', '', /label|place|name/i],
  ['base znovu', '', null],
];

async function run(label, viewport, dpr, throttle, mobile, wheel) {
  const b = await chromium.launch();
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
  });
  await p.goto(LIVE, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(18000);
  const box = await p.locator('.maplibregl-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (let i = 0; i < wheel; i++) { await p.mouse.move(cx, cy); await p.mouse.wheel(0, 300); await p.waitForTimeout(300); }
  await p.waitForTimeout(3000);
  const layers = await p.evaluate(() => window.__map.getStyle().layers.map((l) => l.id));
  console.log(`\n##### ${label} throttle ${throttle}x zoom ${await p.evaluate(() => window.__map.getZoom().toFixed(1))} markers ${await p.evaluate(() => document.querySelectorAll('.maplibregl-marker').length)}`);
  console.log('layers:', layers.join(', '));
  for (const [name, css, layerRe] of VARIANTS) {
    await p.evaluate(([css, re]) => {
      document.getElementById('__v')?.remove();
      const s = document.createElement('style'); s.id = '__v'; s.textContent = css; document.head.append(s);
      const m = window.__map;
      for (const l of m.getStyle().layers) m.setLayoutProperty(l.id, 'visibility', re && new RegExp(re, 'i').test(l.id) ? 'none' : (l.layout?.visibility === 'none' && window.__hidden?.has(l.id) ? 'visible' : (l.layout?.visibility ?? 'visible')));
      window.__hidden = new Set(re ? m.getStyle().layers.filter((l) => new RegExp(re, 'i').test(l.id)).map((l) => l.id) : []);
    }, [css, layerRe?.source ?? null]);
    await p.waitForTimeout(1200);
    await p.evaluate(() => { window.__frames = []; });
    for (let i = 0; i < 6; i++) {
      await p.mouse.move(cx, cy); await p.mouse.down();
      for (let k = 1; k <= 20; k++) await p.mouse.move(cx + (i % 2 ? -1 : 1) * k * 10, cy + (i % 3 - 1) * k * 4);
      await p.mouse.up(); await p.waitForTimeout(300);
    }
    const f = (await p.evaluate(() => window.__frames.splice(0))).slice(1).sort((a, b) => a - b);
    const q = (x) => f[Math.min(f.length - 1, Math.floor(f.length * x))]?.toFixed(0);
    const mean = f.reduce((a, b) => a + b, 0) / f.length;
    console.log(`${name.padEnd(18)} frames ${String(f.length).padStart(4)} mean ${mean.toFixed(1).padStart(6)} p50 ${q(0.5).padStart(4)} p90 ${q(0.9).padStart(4)} max ${f.at(-1).toFixed(0).padStart(4)}`);
  }
  await b.close();
}
await run('PC 1440x900 mesto', { width: 1440, height: 900 }, 1, 2, false, 0);
await run('PC 1440x900 kraj', { width: 1440, height: 900 }, 1, 2, false, 4);
await run('mobil 390x844 kraj', { width: 390, height: 844 }, 3, 4, true, 3);
