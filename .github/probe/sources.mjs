const P = 'https://dszo-proxy.djanecka6.workers.dev';
for (const p of ['/jmk', '/idsok', '/jmk']) {
  const t0 = Date.now();
  try {
    const r = await fetch(P + p, { signal: AbortSignal.timeout(45000) });
    const text = await r.text();
    console.log(p, r.status, Date.now() - t0, 'ms', text.length, 'B');
    try { const d = JSON.parse(text); console.log('  list', d.list?.length, 'age', Date.now() - d.at); console.log('  sample', JSON.stringify(d.list?.slice(0, 3)).slice(0, 2500)); } catch { console.log('  ', text.slice(0, 400)); }
  } catch (e) { console.log(p, 'ERR', e.message); }
}
