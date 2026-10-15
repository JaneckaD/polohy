// Hledání živých zdrojů pro Pardubický kraj (2): iredo.online a online.dpmp.cz.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log(`\n=== ${url} -> ${r.status} ${r.url} ${r.headers.get('content-type')} len ${t.length}`);
    return { t, url: r.url };
  } catch (e) { console.log(`\n=== ${url} -> ERR ${e.message}`); return { t: '', url }; }
}
for (const page of ['https://iredo.online/', 'https://online.dpmp.cz/', 'https://www.oredo.cz/']) {
  const { t, url } = await get(page);
  console.log(t.length < 8000 ? t : t.slice(0, 3000));
  const scripts = [...t.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => new URL(m[1], url).href);
  for (const s of scripts.slice(0, 8)) {
    const { t: js } = await get(s);
    const hits = new Set();
    for (const m of js.matchAll(/["'`]((?:https?:)?\/\/[^"'`\s]{4,200}|\/[a-zA-Z0-9_\-/.]*(?:api|data|vehicle|position|poloh|vozid|online|ws|hub|signalr|stream)[a-zA-Z0-9_\-/.?=&]*)["'`]/gi)) hits.add(m[1]);
    console.log([...hits].slice(0, 80).join('\n'));
    for (const kw of ['fetch(', 'WebSocket', 'signalR', 'EventSource', 'axios', 'XMLHttpRequest', '.get(', 'baseURL', 'apiUrl', 'API_URL']) {
      let i = js.indexOf(kw), n = 0;
      while (i >= 0 && n < 4) { console.log(`[${kw}] ${js.slice(Math.max(0, i - 150), i + 250).replace(/\s+/g, ' ')}`); i = js.indexOf(kw, i + 1); n++; }
    }
  }
}
