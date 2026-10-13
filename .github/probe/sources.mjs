// IDSOK (cestujok.cz/idspublic) přes Wayback Machine: stránka, skripty a adresy API.
const UA = { 'User-Agent': 'polohy-probe (github.com/JaneckaD/polohy)' };
async function get(url, timeout = 30000) {
  try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 'ERR ' + (e.cause?.code ?? e.message), text: '' }; }
}
for (const q of ['cestujok.cz/idspublic*', 'www.cestujok.cz/idspublic*', 'cestujok.cz/*', 'www.cestujok.cz/*']) {
  const r = await get(`http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(q)}&output=json&limit=400&collapse=urlkey&fl=timestamp,original,statuscode,mimetype`, 60000);
  console.log(`\n=== CDX ${q} -> ${r.status} ${r.text.length} B`);
  let rows = []; try { rows = JSON.parse(r.text).slice(1); } catch { console.log(r.text.slice(0, 300)); }
  for (const row of rows) console.log(row.join(' '));
}
// Poslední snímek stránky mapy a její skripty
const page = await get('http://archive.org/wayback/available?url=cestujok.cz/idspublic/');
console.log('\navailable', page.text.slice(0, 400));
let snap = null; try { snap = JSON.parse(page.text).archived_snapshots?.closest?.url; } catch {}
for (const u of [snap, 'https://web.archive.org/web/2026id_/https://www.cestujok.cz/idspublic/', 'https://web.archive.org/web/2025id_/https://www.cestujok.cz/idspublic/'].filter(Boolean)) {
  const h = await get(u, 60000);
  console.log(`\n=== ${u} -> ${h.status} ${h.text.length} B\n${h.text.slice(0, 3000)}`);
  for (const m of new Set([...h.text.matchAll(/(?:src|href)="([^"]+\.js[^"]*)"/g)].map((x) => x[1]))) {
    const src = m.startsWith('http') ? m : new URL(m, 'https://web.archive.org' + (m.startsWith('/') ? '' : '/web/2026id_/https://www.cestujok.cz/idspublic/')).href;
    const js = await get(src, 60000);
    const urls = new Set([...js.text.matchAll(/["'`]((?:https?:)?\/?[\w./{}$-]*(?:api|Api|API|ashx|svc|json|vehicle|Vehicle|poloh|map|hub|signalr|ws)[\w./?=&{}$-]*)["'`]/g)].map((x) => x[1]).filter((x) => x.length < 140));
    console.log(`script ${src} -> ${js.status} ${js.text.length} B\n  ${[...urls].slice(0, 120).join(' | ')}`);
  }
}
