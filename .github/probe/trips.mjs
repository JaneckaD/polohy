import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', timezoneId: 'Europe/Prague' });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:4173/?debug');
await p.waitForTimeout(45000);
// JMK vehicles without matched trip: why
const jmkStats = await p.evaluate(() => {
  const { store, jmk, planner } = window.__dbg;
  const P = planner();
  const out = { total: store.jmk.length, withCalls: store.jmk.filter((v) => v.calls).length, reasons: {}, samples: [] };
  const lines = new Set(P.trips.filter((t) => ['jmk', 'brno', 'jmkmhd'].includes(t.pattern.c)).map((t) => t.pattern.r));
  for (const [id, r] of jmk.raw) {
    const v = jmk.built.get(id);
    if (!v || v.calls) continue;
    const a = r.a;
    let reason = !lines.has(String(a.LineName)) ? 'line-not-in-gtfs' : P.nodes[a.LastStopID] == null ? 'last-node-unknown' : P.nodes[a.FinalStopID] == null ? 'final-node-unknown' : 'no-time-match';
    out.reasons[reason] = (out.reasons[reason] ?? 0) + 1;
    if (out.samples.length < 25 && reason !== 'line-not-in-gtfs') out.samples.push({ reason, line: a.LineName, vt: a.VType, last: a.LastStopID, lastName: P.stops[P.nodes[a.LastStopID]]?.name, fin: a.FinalStopID, finName: P.stops[P.nodes[a.FinalStopID]]?.name, delay: a.Delay, course: a.Course });
    else if (reason === 'line-not-in-gtfs') out.reasons['lines:' + a.LineName] = 1;
  }
  return out;
});
console.log('JMK', JSON.stringify(jmkStats, null, 1));
// For samples: inspect trips of that line passing both stops today
const detail = await p.evaluate((samples) => {
  const P = window.__dbg.planner();
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  const min = fmt[0] * 60 + fmt[1];
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(now);
  const di = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${P.startDate}T00:00:00Z`)) / 86400000);
  return samples.slice(0, 8).map((s) => {
    const trips = P.trips.filter((t) => t.pattern.r === String(s.line) && ['jmk', 'brno', 'jmkmhd'].includes(t.pattern.c));
    const today = trips.filter((t) => t.mask[di] === '1');
    const withLast = today.filter((t) => t.pattern.s.some((x) => P.stops[x].name === s.lastName));
    const withFinal = withLast.filter((t) => P.stops[t.pattern.s.at(-1)].name === s.finName);
    const near = withFinal.map((t) => { const k = t.pattern.s.findIndex((x) => P.stops[x].name === s.lastName); return t.times[k]; }).filter((x) => Math.abs(x - min) < 60).sort((a, b) => a - b);
    const finals = [...new Set(withLast.map((t) => P.stops[t.pattern.s.at(-1)].name))].slice(0, 6);
    return { ...s, now: min, trips: trips.length, today: today.length, withLast: withLast.length, withFinal: withFinal.length, nearTimes: near.slice(0, 10), finalsOfLine: finals };
  });
}, jmkStats.samples);
for (const d of detail) console.log('DETAIL', JSON.stringify(d));
// Other vehicles: select some per network and check sheet
const groups = await p.evaluate(() => {
  const all = window.__dbg.store.allVehicles().filter((v) => v.type !== 'train');
  const g = {};
  for (const v of all) (g[v.city ?? 'dszo'] ??= []).push(v.id);
  return Object.fromEntries(Object.entries(g).map(([k, ids]) => [k, ids.slice(0, 12)]));
});
for (const [k, ids] of Object.entries(groups)) {
  let empty = 0;
  const bad = [];
  for (const id of ids) {
    await p.evaluate((id) => { const v = window.__dbg.store.allVehicles().find((x) => x.id === id); if (v) window.__dbg.select(v); }, id);
    await p.waitForTimeout(1500);
    const txt = (await p.textContent('#sheet')).replace(/\s+/g, ' ');
    if (/nejsou k dispozici|Načítám/.test(txt)) { empty++; bad.push(await p.evaluate((id) => { const v = window.__dbg.store.allVehicles().find((x) => x.id === id); return v && { id: v.id, line: v.line, stop: v.stop, rawStop: v.rawStop, head: v.headsign, rawHead: v.rawHeadsign, tripNo: v.tripNo, delay: v.delay, est: v.estimated }; }, id)); }
  }
  console.log('GROUP', k, `${empty}/${ids.length} bez zastávek`, JSON.stringify(bad.slice(0, 5)));
}
await b.close();
