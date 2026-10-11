// Service worker: aplikace jde nainstalovat na plochu a ukládá si data, aby se rychle otevřela.
// Aplikace je ale online: polohy vozů jdou vždy ze sítě a nic se z nich necachuje.
//  - soubory aplikace: nejdřív síť, při výpadku uložená verze (aby se aspoň otevřela s hláškou)
//  - jízdní řády, trasy, tratě a hranice kraje (tt/*, routes.json, rails.json, region.json): hned z uložených dat a na pozadí se obnoví
//  - mapové dlaždice a písma OpenFreeMap: z uložených dat, jinak ze sítě (omezený počet)
const VERSION = 'v7';
const APP = `mhd-app-${VERSION}`;
const DATA = `mhd-data-${VERSION}`;
const TILES = `mhd-tiles-${VERSION}`;
const MAX_TILES = 1500;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP).then((c) => c.addAll(['./', './manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([APP, DATA, TILES]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  try {
    // GitHub Pages posílá HTML s max-age=600: bez ověření by prohlížeč 10 minut vracel starou stránku
    // (se starými skripty) i po nasazení nové verze. Soubory v assets/ mají v názvu otisk, ty ověřovat netřeba.
    const fresh = new URL(request.url).pathname.includes('/assets/')
      ? request
      : request.mode === 'navigate'
        ? new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        : new Request(request, { cache: 'no-cache' });
    const res = await fetch(fresh);
    if (res.ok) (await caches.open(APP)).put(request, res.clone());
    return res;
  } catch {
    const hit = await caches.match(request);
    if (hit) return hit;
    throw new Error('offline');
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit ?? (await update) ?? Response.error();
}

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const cache = await caches.open(TILES);
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(key);
  } finally {
    trimming = false;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    cache.put(request, res.clone()).then(trimTiles);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (/\/(routes|rails|region)\.json$/.test(url.pathname) || url.pathname.includes('/tt/')) {
      event.respondWith(staleWhileRevalidate(request, DATA));
    } else {
      event.respondWith(networkFirst(request));
    }
    return;
  }

  // Dlaždice, styl, písma a ikony mapy. Data DSZO (proxy) jdou vždy přímo ze sítě.
  if (url.hostname === 'tiles.openfreemap.org') {
    // Popis dlaždic (/planet) ukazuje na aktuální verzi mapy, ten jen obnovujeme na pozadí.
    // Samotné dlaždice a písma mají verzi v adrese, takže se nemění.
    event.respondWith(url.pathname === '/planet' ? staleWhileRevalidate(request, DATA) : cacheFirst(request));
  }
});
