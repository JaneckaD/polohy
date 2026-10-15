// Hledání živých zdrojů pro kraj Vysočina.
import { pceProtocol } from '../../proxy/worker.js';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
async function get(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log(`\n=== ${opts.method ?? 'GET'} ${url} -> ${r.status} ${r.url} len ${t.length}`);
    return { t, url: r.url, ok: r.ok };
  } catch (e) { console.log(`\n=== ${url} -> ERR ${e.message}`); return { t: '', url, ok: false }; }
}
const box = JSON.stringify({ w: 14.9, s: 48.95, e: 16.45, n: 49.85, zoom: 13, showStops: false, mapFilterId: null });
for (const host of ['https://vdv.online', 'https://www.vdv.online', 'https://vysocina.online', 'https://mapa.verejnadopravavysociny.cz', 'https://www.verejnadopravavysociny.cz', 'https://jizdnirady.kr-vysocina.cz', 'https://vdv.idos.cz', 'https://idsvysocina.online']) {
  const r = await get(`${host}/map/mapData`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: box });
  console.log(r.t.slice(0, 600));
}
for (const u of ['https://www.verejnadopravavysociny.cz/', 'https://www.kr-vysocina.cz/doprava', 'https://www.dpmj.cz/', 'https://www.dpmj.cz/online', 'https://mhd.dpmj.cz/', 'https://online.dpmj.cz/', 'https://www.trebic.cz/mhd', 'https://www.cesky-krumlov.cz']) {
  const { t } = await get(u);
  const links = [...new Set([...t.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]).filter((l) => /map|online|poloh|vozid|live|spoj|gtfs|api|mhdonline/i.test(l)))];
  console.log(links.slice(0, 50).join('\n'));
}
for (const city of ['jihlava', 'dpmj', 'trebic', 'havlickuvbrod', 'zdar', 'pelhrimov', 'humpolec', 'brno', 'kromeriz']) {
  try {
    const r = await fetch(`https://api.mhdonline.cz/${city}`, { headers: { Accept: 'application/json', Origin: 'https://online.dpmp.cz', 'X-App-Protocol': await pceProtocol('your-public-protocol-seed'), 'User-Agent': UA } });
    console.log(`mhdonline ${city} ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) { console.log(city, e.message); }
}
for (const sub of ['jihlava', 'trebic', 'havlickuv-brod', 'zdar']) { const { t } = await get(`https://${sub}.mhdonline.cz/`); console.log(t.slice(0, 300)); }
