// Cloudflare Worker: malá proxy, přes kterou si aplikace na GitHub Pages čte data DSZO.
// DSZO neposílá CORS hlavičky, proto to prohlížeč přímo nedovolí.
// Proxy pouští jen tři veřejné adresy DSZO, nejde ji zneužít na nic jiného.
// /trains: polohy osobních vlaků od Správy železnic (mapa vlaků), zúžené na okolí oblasti (Zlínský a Jihomoravský kraj);
//          když mapa vlaků neodpoví, vlaky z map IDZK a IDS JMK, jinak poslední úspěšná odpověď.
// /mhd: polohy vozů MHD dalších měst kraje a regionálních autobusů vybraných dopravců z mapy IDZK (mpvnet.cz),
//       MHD Kroměříž z její vlastní mapy (kromeriz.mhdonline.cz), na mapě IDZK není.
// /flix: dálkové autobusy FlixBus, které zastavují v kraji (sledování spojů FlixBus), /flix/route jejich trasa.

const UPSTREAM = 'https://www.dszo.cz';
const ALLOWED_PATHS = new Set(['/online/', '/online/tabs2.php', '/online/spoj.php']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Polohy všech osobních vlaků v ČR (souřadnice S-JTSK, EPSG:5514).
const TRAINS_URL = 'https://mapy.spravazeleznic.cz/serverside/request2.php?module=Layers%5COsVlaky&&action=load';
// Obdélník kolem oblasti (Zlínský a Jihomoravský kraj) v S-JTSK (s rezervou pár kilometrů), přesně ořízne aplikace.
const ZK_BOX = { minX: -682000, maxX: -462000, minY: -1230000, maxY: -1109000 };
const TRAIN_FIELDS = ['tt', 'tn', 'na', 'fn', 'ln', 'cna', 'nsn', 'nst', 'nsp', 'cp', 'cr', 'de', 'd', 'a'];

// Mapa vlaků SŽ z Cloudflaru často neodpoví (z jiných sítí ano). Čekáme na ni proto jen chvíli
// a po výpadku ji dvě minuty nezkoušíme. Náhradou jsou vlaky z mapy IDZK (Zlínský kraj) a z mapy IDS JMK
// (Jihomoravský kraj, bez čísla vlaku, to aplikace dohledá v jízdním řádu podle linky, cíle a polohy),
// a když nejde ani jedna, poslední úspěšná odpověď z cache workeru.
const TRAINS_LAST = 'https://dszo-proxy.internal/trains-last';
let szFailedAt = 0;

async function fetchTrains() {
  if (Date.now() - szFailedAt < 120000) return null;
  try {
    const upstream = await fetch(TRAINS_URL, {
      headers: { 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)', Referer: 'https://mapy.spravazeleznic.cz/vlaky' },
      cf: { cacheTtl: 15, cacheEverything: true },
      signal: AbortSignal.timeout(6000),
    });
    if (upstream.ok) return await upstream.json();
  } catch {
    /* níže */
  }
  szFailedAt = Date.now();
  return null;
}

/** Vlaky z mapy IDZK ve stejných polích jako od SŽ, jen s polohou ve WGS84 (lat, lon). */
async function idzkTrains() {
  try {
    const res = await fetch(MPV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz', 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' },
      body: MPV_BODY,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.transmitters ?? [])
      .filter((t) => t.cat === 1 && Number.isFinite(t.x) && Number.isFinite(t.y))
      .map((t) => {
        // „Os 3912|S4|3912|Bezměrov|180|||||Kojetín|1|“: vlak, linka, číslo, poslední stanice, …, cílová stanice.
        const f = String(t.cn ?? '').split('|');
        const [tt = '', tn = ''] = String(t.n ?? f[0] ?? '').split(' ');
        const angle = /a_(\d+)\.png/.exec(t.ico ?? '');
        return { lat: t.x, lon: t.y, tt, tn: f[2] || tn, na: '', fn: '', ln: f[9] || '', cna: f[3] || '', d: t.cr ?? '', de: Number.isFinite(t.dm) ? t.dm : '', a: angle ? Number(angle[1]) : '' };
      });
  } catch {
    return null;
  }
}

// Mapa IDS JMK (mapa.idsjmk.cz): API chce přístupový klíč, který stránka mapy posílá v HTML
// (initializeApplication('…')). Klíč si pamatujeme a při odmítnutí si stáhneme nový.
const JMK = 'https://mapa.idsjmk.cz';
let jmkToken = null;

async function jmkFetchToken() {
  const res = await fetch(`${JMK}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (mhd-zlin-live)' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  return /initializeApplication\('([^']+)'/.exec(await res.text())?.[1] ?? null;
}

async function jmkVehicles() {
  for (let attempt = 0; attempt < 2; attempt++) {
    jmkToken ??= await jmkFetchToken();
    if (!jmkToken) return null;
    const res = await fetch(`${JMK}/api/vehicles`, {
      headers: { 'X-Access-Token': jmkToken, 'User-Agent': 'Mozilla/5.0 (mhd-zlin-live)', Referer: `${JMK}/` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      jmkToken = null;
      continue;
    }
    if (!res.ok) return null;
    return (await res.json()).Vehicles ?? [];
  }
  return null;
}

/** Vlaky z mapy IDS JMK (VType 5): linka (S3, R12…), cíl, zpoždění; druh vlaku podle linky. */
async function jmkTrains() {
  try {
    const list = await jmkVehicles();
    if (!list) return null;
    return list
      .filter((v) => v.VType === 5 && !v.IsInactive && Number.isFinite(v.Lat) && Number.isFinite(v.Lng))
      .map((v) => {
        const line = String(v.LineName ?? '').replace(/^x/, '');
        return {
          lat: v.Lat,
          lon: v.Lng,
          tt: /^R/.test(line) ? 'R' : 'Os',
          tn: '',
          line,
          na: '',
          fn: '',
          ln: v.FinalStopName ?? '',
          cna: '',
          d: '',
          de: Number.isFinite(v.Delay) ? v.Delay : '',
          a: Number.isFinite(v.Bearing) && v.Bearing >= 0 ? v.Bearing : '',
          src: 'jmk',
          vid: v.ID,
        };
      });
  } catch {
    return null;
  }
}

async function trains() {
  const cache = globalThis.caches?.default;
  const data = await fetchTrains();
  if (!data) {
    const [idzk, jmk] = await Promise.all([idzkTrains(), jmkTrains()]);
    if (idzk || jmk) {
      return new Response(JSON.stringify({ trains: [...(idzk ?? []), ...(jmk ?? [])], source: 'idzk', at: new Date().toISOString() }), {
        headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
      });
    }
    const last = await cache?.match(TRAINS_LAST);
    if (last) return new Response(last.body, { headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store', 'X-Stale': '1' } });
    return new Response('Upstream error', { status: 502, headers: CORS });
  }
  const list = [];
  for (const f of data.result ?? []) {
    const [x, y] = f.geometry?.coordinates ?? [];
    if (!(x >= ZK_BOX.minX && x <= ZK_BOX.maxX && y >= ZK_BOX.minY && y <= ZK_BOX.maxY)) continue;
    const t = { x, y };
    for (const k of TRAIN_FIELDS) t[k] = f.properties?.[k];
    list.push(t);
  }
  const body = JSON.stringify({ trains: list, at: new Date().toISOString() });
  if (cache) {
    await cache.put(TRAINS_LAST, new Response(body, { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'max-age=600' } })).catch(() => {});
  }
  return new Response(body, {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

// Mapa IDZK: odpovídá jen s hlavičkou Origin své vlastní stránky.
const MPV_URL = 'https://mpvnet.cz/zlin/map/mapData';
const MPV_BODY = JSON.stringify({ w: 15.5, s: 48.55, e: 18.7, n: 49.7, zoom: 13, showStops: false, mapFilterId: null });
// Městské linky podle čísla licence: 775 = MHD Kroměříž, 946 = Valašské Meziříčí, 805 = Uherské Hradiště, 945 = Vsetín.
const CITY_LICENCES = ['775', '946', '805', '945'];
// Regionální autobusy těchto dopravců (podle názvu dopravce na mapě IDZK).
const CARRIERS = /ČSAD BUS U|Z-Group|ARRIVA|Transdev|TQM/i;

// MHD Kroměříž (Kroměřížské technické služby): mapa na kromeriz.mhdonline.cz posílá klíč v těle
// a server chce tělo jako prostý text (s Content-Type JSON vrací chybu 500).
const KM_URL = 'https://kromeriz.mhdonline.cz/api/buses';
const KM_BODY = JSON.stringify({ key: '09658f18-0f8c-4909-a571-0bc6b4acfbec' });

async function kromerizBuses() {
  try {
    const res = await fetch(KM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' },
      body: KM_BODY,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.success ? (data.data ?? []) : [];
  } catch {
    return []; // výpadek Kroměříže nesmí shodit ostatní města
  }
}

async function cityBuses() {
  const [upstream, km] = await Promise.all([
    fetch(MPV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz', 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' },
      body: MPV_BODY,
    }),
    kromerizBuses(),
  ]);
  if (!upstream.ok) return new Response('Upstream error', { status: 502, headers: CORS });
  const data = await upstream.json();
  const vehicles = (data.transmitters ?? [])
    .filter((t) => CITY_LICENCES.some((l) => String(t.cn ?? '').startsWith(l)) || (t.cat === 2 && CARRIERS.test(t.cr ?? '')))
    // Z kódu stačí prvních 12 polí (linka, spoj, zastávky, cíl, nízkopodlažnost, SPZ), zbytek jsou nuly.
    .map(({ cn, x, y, ico, ds, tm, cr }) => ({ cn: String(cn ?? '').split('|').slice(0, 12).join('|'), x, y, ico, ds, tm, cr }));
  return new Response(JSON.stringify({ vehicles, km }), {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

// FlixBus: veřejné sledování spojů (flixbus.cz/track) se stejným klíčem jako jejich web.
const FLIX = 'https://global.api.flixbus.com/gis';
const FLIX_KEY = 'apiKey=7781b8fa-07cf-4ab7-8b62-1f3178523ba0';
// Zastávky FlixBusu v kraji: Zlín AN a Malenovice, Uherské Hradiště, Uherský Brod, Kroměříž AN a Milíčovo nám.
const FLIX_STATIONS = [
  'dcc3cb3d-9603-11e6-9066-549f350fcb0c',
  'dcc3d0c6-9603-11e6-9066-549f350fcb0c',
  'ef348d14-f2ed-4ea3-a8f4-0e39bb858ffb',
  'dc20e5be-2dfc-4894-9784-4dea7d942fbe',
  '28d94a3b-cfe4-4dc4-86a5-b3e484cc326c',
  '0dca7499-d85a-41f6-ab4b-7377f25f795f',
];
// Obdélník kolem oblasti (WGS84), přesně ořízne aplikace.
const ZK_WGS = { s: 48.55, n: 49.75, w: 15.5, e: 18.7 };
const FLIX_UUID = /^[0-9a-f-]{36}$/;

async function flixJson(url, ttl) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)', 'Accept-Language': 'cs' },
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`FlixBus ${res.status}`);
  return res.json();
}

/** Spoje FlixBusu, které jsou právě v kraji: zjistí je z odjezdů a příjezdů zastávek v kraji. */
async function flixBuses() {
  // Okno ±3 h kolem teď, zaokrouhlené na 5 minut, ať se seznamy spojů dají krátce cachovat.
  const step = 5 * 60e3;
  const t = Math.floor(Date.now() / step) * step;
  const iso = (ms) => new Date(ms).toISOString();
  const lists = await Promise.allSettled(
    FLIX_STATIONS.flatMap((st) =>
      ['departures', 'arrivals'].map((kind) => flixJson(`${FLIX}/v2/timetable/${st}/${kind}?from=${iso(t - 3 * 3600e3)}&to=${iso(t + 3 * 3600e3)}&${FLIX_KEY}`, 300)),
    ),
  );
  const ids = new Set();
  for (const l of lists) for (const r of l.value?.rides ?? []) if (FLIX_UUID.test(r.id ?? '')) ids.add(r.id);
  const rides = await Promise.allSettled([...ids].slice(0, 30).map((id) => flixJson(`${FLIX}/v3/ride/${id}?${FLIX_KEY}`, 15)));
  const buses = [];
  for (const r of rides) {
    const d = r.value;
    const c = d?.location?.coordinates;
    if (!c || d.status?.progress !== 'IN_PROGRESS') continue;
    if (!(c.latitude >= ZK_WGS.s && c.latitude <= ZK_WGS.n && c.longitude >= ZK_WGS.w && c.longitude <= ZK_WGS.e)) continue;
    buses.push({
      id: d.id,
      code: d.line?.code,
      name: d.line?.name,
      dir: d.line?.direction,
      no: d.line?.trip_number,
      brand: d.line?.brand?.name ?? 'FlixBus',
      lat: c.latitude,
      lon: c.longitude,
      at: d.location.updated_at,
      dev: d.status?.deviation?.deviation_seconds ?? null,
      next: d.status?.next_stop_sequence ?? null,
      arrived: d.status?.has_arrived_at_next_stop ?? null,
      calls: (d.calls ?? []).map((k) => ({
        seq: k.sequence,
        name: k.stop?.name,
        lat: k.stop?.location?.latitude,
        lon: k.stop?.location?.longitude,
        arr: k.arrival?.scheduled ?? null,
        dep: k.departure?.scheduled ?? null,
      })),
    });
  }
  return new Response(JSON.stringify({ buses }), {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

/** Trasa spoje FlixBusu po silnicích (úseky mezi zastávkami jako zakódované lomené čáry). */
async function flixRoute(id) {
  if (!FLIX_UUID.test(id ?? '')) return new Response('Bad id', { status: 400, headers: CORS });
  try {
    const data = await flixJson(`${FLIX}/v3/ride/${id}/route?${FLIX_KEY}`, 3600);
    return new Response(JSON.stringify({ segments: (data.segments ?? []).map((s) => ({ seq: s.segment_sequence, line: s.polyline })) }), {
      headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'max-age=3600' },
    });
  } catch {
    return new Response('Upstream error', { status: 502, headers: CORS });
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/trains') return trains();
    if (request.method === 'GET' && url.pathname === '/mhd') return cityBuses();
    if (request.method === 'GET' && url.pathname === '/flix') return flixBuses();
    if (request.method === 'GET' && url.pathname === '/flix/route') return flixRoute(url.searchParams.get('id'));
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
