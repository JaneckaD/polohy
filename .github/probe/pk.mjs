// Hledání živých zdrojů pro Pardubický kraj.
const UA = 'mhd-zlin-live (github.com/JaneckaD/polohy)';
const box = { w: 15.3, s: 49.45, e: 16.95, n: 50.2, zoom: 13, showStops: false, mapFilterId: null };
async function tryFetch(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
    const t = await r.text();
    console.log(`\n=== ${url} -> ${r.status} ${r.url} len ${t.length}`);
    return t;
  } catch (e) { console.log(`\n=== ${url} -> ERR ${e.message}`); return ''; }
}
for (const sys of ['iredo', 'pardubice', 'pk', 'IREDO', 'hradec']) {
  const t = await tryFetch(`https://mpvnet.cz/${sys}/map/mapData`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz' }, body: JSON.stringify(box) });
  console.log(t.slice(0, 1500));
}
for (const u of ['https://mpvnet.cz/', 'https://mpvnet.cz/iredo/map', 'https://www.iredo.cz/', 'https://iredo.online/', 'https://mapa.iredo.cz/', 'https://www.dpmp.cz/', 'https://www.oredo.cz/']) {
  const t = await tryFetch(u);
  const links = [...new Set([...t.matchAll(/(?:href|src|url)\s*[=:(]\s*["']([^"']+)["']/gi)].map((m) => m[1]).filter((l) => /map|online|poloh|vozid|gtfs|api|data/i.test(l)))];
  console.log(links.slice(0, 60).join('\n'));
  console.log(t.replace(/\s+/g, ' ').match(/.{0,200}(mapa vozidel|online mapa|poloh[ay] vozidel|live).{0,200}/i)?.[0] ?? '');
}
