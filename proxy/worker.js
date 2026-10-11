// Cloudflare Worker: malá proxy, přes kterou si aplikace na GitHub Pages čte data DSZO.
// DSZO neposílá CORS hlavičky, proto to prohlížeč přímo nedovolí.
// Proxy pouští jen tři veřejné adresy DSZO, nejde ji zneužít na nic jiného.

const UPSTREAM = 'https://www.dszo.cz';
const ALLOWED_PATHS = new Set(['/online/', '/online/tabs2.php', '/online/spoj.php']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
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
