// Hledání živých poloh pro Olomoucký kraj + kontrola proxy /jmk.
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36' };
const sec = (t) => console.log(`\n===== ${t} =====`);
async function get(url, opt = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers ?? {}) }, signal: AbortSignal.timeout(opt.timeout ?? 20000) });
    const text = await r.text();
    return { status: r.status, text, ms: Date.now() - t0, headers: Object.fromEntries(r.headers) };
  } catch (e) { return { status: 'ERR ' + (e.cause?.code ?? e.message), text: '', ms: Date.now() - t0 }; }
}
const show = async (url, n = 800, opt) => { const r = await get(url, opt); console.log(`--- ${url} -> ${r.status} ${r.ms} ms (${r.text.length} B)\n${r.text.slice(0, n)}`); return r; };
const OK = { w: 16.65, s: 49.2, e: 17.95, n: 50.45, zoom: 13, showStops: false, mapFilterId: null };

sec('proxy');
for (const p of ['/jmk', '/mhd']) { const r = await get('https://dszo-proxy.djanecka6.workers.dev' + p, { timeout: 40000 }); let info = ''; try { const d = JSON.parse(r.text); info = JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]))).slice(0, 300); } catch { info = r.text.slice(0, 200); } console.log(p, r.status, r.ms, 'ms', info); }

sec('mpvnet systémy');
const root = await show('https://mpvnet.cz/', 3000);
for (const m of new Set([...root.text.matchAll(/href="\/?([a-z0-9-]+)\/?(?:map)?"/gi)].map((x) => x[1]))) console.log('link', m);
const sys = ['odis', 'zlin', 'olomouc', 'dpmo', 'idsok', 'ok', 'kidsok', 'prerov', 'prostejov', 'sumperk', 'jesenik', 'hranice', 'sternberk', 'litovel', 'unicov', 'zabreh', 'mohelnice', 'arriva', 'vojtila', 'jmk', 'pardubice', 'iredo', 'vysocina'];
for (const s of sys) {
  const r = await get(`https://mpvnet.cz/${s}/map/mapData`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz' }, body: JSON.stringify(OK) });
  let info = r.text.slice(0, 80).replace(/\s+/g, ' ');
  try { const tr = JSON.parse(r.text).transmitters ?? []; const c = {}; for (const t of tr) { const k = `${t.t}/${t.cat}/${t.cr}`; c[k] = (c[k] ?? 0) + 1; } info = `${tr.length} vozů ${JSON.stringify(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 25))}`; if (tr.find((t) => t.t === 'E')) console.log('  E sample', JSON.stringify(tr.filter((t) => t.t === 'E').slice(0, 3))); } catch {}
  console.log(`mpvnet ${s} -> ${r.status} ${info}`);
}

sec('mhdonline');
for (const town of ['kromeriz', 'olomouc', 'prostejov', 'prerov', 'sumperk', 'jesenik', 'hranice', 'zabreh', 'sternberk', 'litovel', 'unicov', 'mohelnice', 'uherskehradiste', 'vsetin', 'frydekmistek', 'opava', 'krnov', 'havirov', 'trinec', 'karvina', 'novyjicin', 'koprivnice']) {
  const r = await get(`https://${town}.mhdonline.cz/api/buses`, { timeout: 10000 });
  console.log(`${town}.mhdonline.cz -> ${r.status} ${r.text.slice(0, 160).replace(/\s+/g, ' ')}`);
}
await show('https://mhdonline.cz/', 1500);

sec('IDSOK / DPMO');
for (const u of ['https://www.cestujok.cz/idspublic/', 'http://www.cestujok.cz/', 'https://cestujok.cz/', 'https://www.idsok.cz/', 'https://www.kidsok.cz/', 'https://www.dpmo.cz/', 'https://www.dpmo.cz/informace-pro-cestujici/', 'https://mapa.dpmo.cz/', 'https://online.dpmo.cz/', 'https://www.arriva.cz/', 'https://www.vojtila.cz/']) await show(u, 300, { timeout: 15000 });
const d = await get('https://www.dpmo.cz/');
console.log('dpmo odkazy', [...new Set([...d.text.matchAll(/href="([^"]*(?:mapa|poloh|online|live|vozid|odjezd)[^"]*)"/gi)].map((x) => x[1]))].join(' | '));
