const P = 'https://dszo-proxy.djanecka6.workers.dev';
async function get(u, opt = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(40000), ...opt });
    const text = await r.text();
    console.log('\n##', u, r.status, Date.now() - t0, 'ms', text.length, 'B', 'ray', r.headers.get('cf-ray'));
    return text;
  } catch (e) { console.log('\n##', u, 'ERR', e.message); return null; }
}
const ss = 'https://gis.brno.cz/geoevent/rest/services/Kordis_stream/StreamServer';
let t = await get(ss + '?f=json'); console.log(t?.slice(0, 3000));
t = await get('https://gis.brno.cz/geoevent/rest/services?f=json'); console.log(t?.slice(0, 2000));
t = await get(P + '/idsok'); console.log(t?.slice(0, 600));
t = await get('https://mpvnet.cz/odis/map/mapData', { headers: { Origin: 'https://mpvnet.cz', 'User-Agent': 'Mozilla/5.0' } });
try { const d = JSON.parse(t); const arr = Array.isArray(d) ? d : (d.data ?? d.vehicles ?? Object.values(d).find(Array.isArray)); console.log('keys', Object.keys(d).slice(0,10), 'n', arr?.length); const tr = arr.filter(x => x.cat === 1 || x.t === 'T'); console.log('trains', tr.length, JSON.stringify(tr.slice(0, 4))); } catch (e) { console.log('parse', e.message, t?.slice(0, 300)); }
t = await get(P + '/trains'); try { const d = JSON.parse(t); console.log('source', d.source, 'n', d.trains?.length, JSON.stringify(d.trains?.slice(0,2))); } catch { console.log(t?.slice(0,300)); }
t = await get('https://mapy.spravazeleznic.cz/serverside/request2.php?module=Layers%5COsVlaky&&action=load', { headers: { 'User-Agent': 'Mozilla/5.0' } });
try { const d = JSON.parse(t); const m = d.md ?? d; console.log('SZ keys', Object.keys(d).slice(0, 10), JSON.stringify(m).slice(0, 800)); } catch { console.log(t?.slice(0, 300)); }
