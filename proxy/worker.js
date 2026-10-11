// Cloudflare Worker: malá proxy, přes kterou si aplikace na GitHub Pages čte data DSZO.
// DSZO neposílá CORS hlavičky, proto to prohlížeč přímo nedovolí.
// Proxy pouští jen tři veřejné adresy DSZO, nejde ji zneužít na nic jiného.
// /trains: polohy osobních vlaků od Správy železnic (mapa vlaků), zúžené na okolí Zlínského kraje.
// /mhd: polohy vozů MHD dalších měst kraje a regionálních autobusů vybraných dopravců z mapy IDZK (mpvnet.cz).

const UPSTREAM = 'https://www.dszo.cz';
const ALLOWED_PATHS = new Set(['/online/', '/online/tabs2.php', '/online/spoj.php']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Polohy všech osobních vlaků v ČR (souřadnice S-JTSK, EPSG:5514).
const TRAINS_URL = 'https://mapy.spravazeleznic.cz/serverside/request2.php?module=Layers%5COsVlaky&&action=load';
// Obdélník kolem Zlínského kraje v S-JTSK (s rezervou pár kilometrů), přesně ořízne aplikace.
const ZK_BOX = { minX: -570000, maxX: -457000, minY: -1206000, maxY: -1125000 };
const TRAIN_FIELDS = ['tt', 'tn', 'na', 'fn', 'ln', 'cna', 'nsn', 'nst', 'nsp', 'cp', 'cr', 'de', 'd', 'a'];

async function trains() {
  const upstream = await fetch(TRAINS_URL, {
    headers: { 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)', Referer: 'https://mapy.spravazeleznic.cz/vlaky' },
    cf: { cacheTtl: 15, cacheEverything: true },
  });
  if (!upstream.ok) return new Response('Upstream error', { status: 502, headers: CORS });
  const data = await upstream.json();
  const list = [];
  for (const f of data.result ?? []) {
    const [x, y] = f.geometry?.coordinates ?? [];
    if (!(x >= ZK_BOX.minX && x <= ZK_BOX.maxX && y >= ZK_BOX.minY && y <= ZK_BOX.maxY)) continue;
    const t = { x, y };
    for (const k of TRAIN_FIELDS) t[k] = f.properties?.[k];
    list.push(t);
  }
  return new Response(JSON.stringify({ trains: list }), {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

// Mapa IDZK: odpovídá jen s hlavičkou Origin své vlastní stránky.
const MPV_URL = 'https://mpvnet.cz/zlin/map/mapData';
const MPV_BODY = JSON.stringify({ w: 17.1, s: 48.86, e: 18.4, n: 49.54, zoom: 13, showStops: false, mapFilterId: null });
// Městské linky podle čísla licence: 775 = MHD Kroměříž, 946 = MHD Valašské Meziříčí.
const CITY_LICENCES = ['775', '946'];
// Regionální autobusy těchto dopravců (podle názvu dopravce na mapě IDZK).
const CARRIERS = /ČSAD BUS U|Z-Group|ARRIVA|Transdev|TQM/i;

async function cityBuses() {
  const upstream = await fetch(MPV_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz', 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' },
    body: MPV_BODY,
  });
  if (!upstream.ok) return new Response('Upstream error', { status: 502, headers: CORS });
  const data = await upstream.json();
  const vehicles = (data.transmitters ?? [])
    .filter((t) => CITY_LICENCES.some((l) => String(t.cn ?? '').startsWith(l)) || (t.cat === 2 && CARRIERS.test(t.cr ?? '')))
    // Z kódu stačí prvních 12 polí (linka, spoj, zastávky, cíl, nízkopodlažnost, SPZ), zbytek jsou nuly.
    .map(({ cn, x, y, ico, ds, tm, cr }) => ({ cn: String(cn ?? '').split('|').slice(0, 12).join('|'), x, y, ico, ds, tm, cr }));
  return new Response(JSON.stringify({ vehicles }), {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/trains') return trains();
    if (request.method === 'GET' && url.pathname === '/mhd') return cityBuses();
    if (request.method !== 'GET' || !ALLOWED_PATHS.has(url.pathname)) {
      return new Response('Not found', { status: 404, headers: CORS });
    }

    // spoj.php potřebuje parametry vozu, ostatní adresy žádné nemají.
    const query = url.pathname === '/online/spoj.php' ? url.search : '';
    const upstream = await fetch(UPSTREAM + url.pathname + query, {
      headers: { 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' },
      // Krátká cache, aby víc otevřených telefonů nezatěžovalo server DSZO.
      cf: { cacheTtl: 10, cacheEverything: true },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS,
        'Content-Type': upstream.headers.get('Content-Type') || 'text/html; charset=UTF-8',
        'Cache-Control': 'no-store',
      },
    });
  },
};
