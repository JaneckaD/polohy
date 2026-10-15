// Cloudflare Worker: malá proxy, přes kterou si aplikace na GitHub Pages čte data DSZO.
// DSZO neposílá CORS hlavičky, proto to prohlížeč přímo nedovolí.
// Proxy pouští jen tři veřejné adresy DSZO, nejde ji zneužít na nic jiného.
// /trains: polohy osobních vlaků od Správy železnic (mapa vlaků), zúžené na okolí oblasti (Zlínský, Jihomoravský,
//          Olomoucký, Moravskoslezský, Pardubický kraj a Vysočina); když mapa vlaků neodpoví, vlaky z map IDZK, ODIS,
//          IDS JMK, IREDO, IDSOK a VDV,
//          jinak poslední úspěšná odpověď.
// /mhd: polohy vozů MHD dalších měst kraje a regionálních autobusů vybraných dopravců z mapy IDZK (mpvnet.cz),
//       MHD Kroměříž z její vlastní mapy (kromeriz.mhdonline.cz), na mapě IDZK není.
//       Navíc (pole odis) vozy z mapy ODIS (Moravskoslezský kraj: regionální autobusy a MHD měst včetně Ostravy)
//       a (pole pce) MHD Pardubice z mapy dopravního podniku (online.dpmp.cz).
// /flix: dálkové autobusy FlixBus, které zastavují v kraji (sledování spojů FlixBus), /flix/route jejich trasa.
// /iredo: vozy z mapy IREDO (iredo.online, Pardubický kraj: regionální autobusy, MHD menších měst a vlaky).
// /vdv: vozy z mapy VDV (mapavdv.kr-vysocina.cz, Kraj Vysočina: regionální autobusy a vlaky) se spoji.
// /jmk: poslední dávka živých poloh IDS JMK (otevřená data KORDIS JMK, CC BY). Proud je posílá jen jednou
//       za půl minuty, proxy si poslední dávku drží, aby aplikace měla vozy hned po startu.

const UPSTREAM = 'https://www.dszo.cz';
const ALLOWED_PATHS = new Set(['/online/', '/online/tabs2.php', '/online/spoj.php']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Polohy všech osobních vlaků v ČR (souřadnice S-JTSK, EPSG:5514).
const TRAINS_URL = 'https://mapy.spravazeleznic.cz/serverside/request2.php?module=Layers%5COsVlaky&&action=load';
// Obdélník kolem oblasti (Zlínský, Jihomoravský, Olomoucký, Moravskoslezský, Pardubický kraj a Vysočina) v S-JTSK (s rezervou pár kilometrů),
// přesně ořízne aplikace.
const ZK_BOX = { minX: -735000, maxX: -415000, minY: -1230000, maxY: -1030000 };
const TRAIN_FIELDS = ['tt', 'tn', 'na', 'fn', 'ln', 'cna', 'nsn', 'nst', 'nsp', 'cp', 'cr', 'de', 'd', 'a'];

// Mapa vlaků SŽ z Cloudflaru často neodpoví (z jiných sítí ano). Čekáme na ni proto jen chvíli
// a po výpadku ji dvě minuty nezkoušíme. Náhradou jsou vlaky z map IDZK (Zlínský kraj), ODIS (Moravskoslezský kraj) a IDS JMK
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

/** Vlaky z mapy na platformě mpvnet (IDZK, ODIS) ve stejných polích jako od SŽ, jen s polohou ve WGS84 (lat, lon). */
async function mpvTrains(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz', 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' },
      body,
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

const idzkTrains = () => mpvTrains(MPV_URL, MPV_BODY);
const odisTrains = () => mpvTrains(ODIS_URL, ODIS_BODY);

/** Vlaky (sourceType K) z map IREDO a IDSOK ve stejných polích jako od SŽ: „R19 (R 864 Svitava)“, „Os 15311“. */
function connectionTrains(list) {
  return (list ?? [])
    .filter((s) => s.sourceType === 'K' && Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => {
      const name = String(s.name ?? '');
      const inner = /\(([^)]+)\)/.exec(name)?.[1] ?? name;
      const [tt = '', tn = ''] = inner.trim().split(/\s+/);
      const line = s.extLineName ?? (/^(\S+)\s*\(/.exec(name)?.[1] || '');
      return { lat: s.lat, lon: s.lon, tt, tn: String(s.trainNumber ?? tn), line, na: '', fn: s.dep ?? '', ln: s.dest ?? '', cna: '', d: s.operator ?? '', de: Number.isFinite(s.delay) ? s.delay : '', a: Number.isFinite(s.angle) ? s.angle : '' };
    });
}
const iredoTrains = () => iredoList().then(connectionTrains, () => null);
const vdvTrains = () => vdvList().then(connectionTrains, () => null);
const idsokTrains = () => idsokBuses().then((body) => connectionTrains(JSON.parse(body).list), () => null);

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
    const [idzk, odis, jmk, iredo, ok, vys] = await Promise.all([idzkTrains(), odisTrains(), jmkTrains(), iredoTrains(), idsokTrains(), vdvTrains()]);
    if (idzk || odis || jmk || iredo || ok || vys) {
      // Vlak na hranici krajů ukazuje víc map: jen jednou (podle čísla vlaku).
      const seen = new Set();
      const list = [...(idzk ?? []), ...(odis ?? []), ...(iredo ?? []), ...(ok ?? []), ...(vys ?? [])].filter((t) => !t.tn || (!seen.has(t.tn) && seen.add(t.tn)));
      return new Response(JSON.stringify({ trains: [...list, ...(jmk ?? [])], source: 'idzk', at: new Date().toISOString() }), {
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
const CARRIERS = /ČSAD BUS U|Z-Group|ARRIVA|Transdev|TQM|Psota/i;

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

// MHD Pardubice (DPMP): mapa online.dpmp.cz čte api.mhdonline.cz s hlavičkou X-App-Protocol: HMAC-SHA256
// veřejného klíče ze skriptu mapy nad číslem čtvrthodiny. Když ji server odmítne (nová verze mapy),
// najdeme si klíč v aktuálním skriptu mapy.
const PCE_API = 'https://api.mhdonline.cz/pardubice/vehicles';
const PCE_SITE = 'https://online.dpmp.cz';
let pceSeed = 'your-public-protocol-seed';

export async function pceProtocol(seed, now = Date.now()) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(Math.floor(now / 900000))));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function pceScrapeSeed() {
  const html = await (await fetch(`${PCE_SITE}/`, { signal: AbortSignal.timeout(6000) })).text();
  const src = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
  if (!src) return null;
  const js = await (await fetch(new URL(src, PCE_SITE).href, { signal: AbortSignal.timeout(6000) })).text();
  return /"([^"]{4,100})",\w+=15\*60\*1e3/.exec(js)?.[1] ?? null;
}

async function pardubiceBuses() {
  const get = async (seed) =>
    fetch(PCE_API, {
      headers: { Accept: 'application/json', Origin: PCE_SITE, Referer: `${PCE_SITE}/`, 'X-App-Protocol': await pceProtocol(seed), 'User-Agent': 'Mozilla/5.0 (compatible; mhd-zlin-live; github.com/JaneckaD/polohy)' },
      signal: AbortSignal.timeout(6000),
    });
  try {
    let res = await get(pceSeed);
    if (res.status === 401 || res.status === 403) {
      const seed = await pceScrapeSeed();
      if (seed && seed !== pceSeed) {
        res = await get(seed);
        if (res.ok) pceSeed = seed;
      }
    }
    if (!res.ok) return [];
    return (await res.json()).vehicles ?? [];
  } catch {
    return []; // výpadek MHD Pardubice nesmí shodit ostatní
  }
}

// Mapa ODIS (Moravskoslezský kraj) běží na stejné platformě jako mapa IDZK.
const ODIS_URL = 'https://mpvnet.cz/odis/map/mapData';
const ODIS_BODY = JSON.stringify({ w: 16.8, s: 49.3, e: 18.95, n: 50.5, zoom: 13, showStops: false, mapFilterId: null });

async function odisBuses() {
  try {
    const res = await fetch(ODIS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz', 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' },
      body: ODIS_BODY,
    });
    if (!res.ok) return [];
    const data = await res.json();
    // Jen autobusy, trolejbusy a tramvaje (vlaky bere aplikace odjinud); z kódu stačí prvních 12 polí.
    return (data.transmitters ?? [])
      .filter((t) => t.t === 'H' && t.cat !== 1)
      .map(({ cn, x, y, ico, ds, cr, cat, t }) => ({ cn: String(cn ?? '').split('|').slice(0, 12).join('|'), x, y, ico, ds, cr, cat, t }));
  } catch {
    return []; // výpadek ODIS nesmí shodit ostatní
  }
}

// Olomoucký kraj (IDSOK): mapa poloh spojů na cestujok.cz (CestujOK). Server je pomalý nebo nedostupný
// z některých sítí, proto vlastní adresa a krátký časový limit; poslední odpověď se drží 15 s.
const IDSOK_URL = 'https://www.cestujok.cz/idspublicservices/api/service/position';
let idsokLast = null; // { at, body }

async function idsokBuses() {
  if (idsokLast && Date.now() - idsokLast.at < 15000) return idsokLast.body;
  const res = await fetch(IDSOK_URL, {
    headers: {
      Accept: 'application/json',
      Referer: 'https://www.cestujok.cz/idspublic/',
      'User-Agent': 'Mozilla/5.0 (compatible; mhd-zlin-live; github.com/JaneckaD/polohy)',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('neočekávaná odpověď');
  idsokLast = { at: Date.now(), body: JSON.stringify({ at: Date.now(), list }) };
  return idsokLast.body;
}

async function idsok() {
  try {
    return new Response(await idsokBuses(), {
      headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return new Response(`IDSOK: ${err.message}`, { status: 502, headers: CORS });
  }
}

// Pardubický kraj (IREDO): mapa spojů iredo.online. Stejný formát spojů jako mapa IDSOK (regionální autobusy,
// MHD menších měst, vlaky); poslední odpověď se drží 10 s.
const IREDO_URL = 'https://iredo.online/map/mapData';
const IREDO_BODY = JSON.stringify({ w: 15.25, s: 49.5, e: 16.95, n: 50.3, zoom: 13, showStops: false, mapFilterId: null });
let iredoLast = null; // { at, list }

async function iredoList() {
  if (iredoLast && Date.now() - iredoLast.at < 10000) return iredoLast.list;
  const res = await fetch(IREDO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://iredo.online/', 'User-Agent': 'Mozilla/5.0 (compatible; mhd-zlin-live; github.com/JaneckaD/polohy)' },
    body: IREDO_BODY,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = (await res.json()).connections;
  if (!Array.isArray(list)) throw new Error('neočekávaná odpověď');
  iredoLast = { at: Date.now(), list };
  return list;
}

async function iredo() {
  try {
    const list = await iredoList();
    return new Response(JSON.stringify({ at: iredoLast.at, list }), {
      headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return new Response(`IREDO: ${err.message}`, { status: 502, headers: CORS });
  }
}

// Kraj Vysočina (VDV): mapa vozů mapavdv.kr-vysocina.cz. Seznam vozů posílá licenci linky, zpoždění (min),
// cíl a druh (BUS, TRAIN); číslo spoje a zastávky s časy jsou až v jízdním řádu vozu (HTML), ten si proxy
// u každého vozu načte jednou (nejvýš VDV_DETAILS najednou) a drží do konce spoje. Ven jde stejný formát
// spojů jako z map IREDO a IDSOK.
const VDV_SITE = 'https://mapavdv.kr-vysocina.cz';
const VDV_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', Referer: `${VDV_SITE}/`, 'User-Agent': 'Mozilla/5.0 (compatible; mhd-zlin-live; github.com/JaneckaD/polohy)' };
const VDV_DETAILS = 30;
const VDV_CACHE = 'https://dszo-proxy.internal/vdv-trips';
let vdvLast = null; // { at, list }
let vdvTrips = null; // Map id → { lic, trip, dep, depTime, dest, destTime, until }

const pragueMin = (now = Date.now()) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  return h * 60 + m;
};
const hmMin = (s) => {
  const m = /(\d{1,2}):(\d{2})/.exec(s ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const htmlText = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** Jízdní řád vozu z mapy VDV (HTML) → { lic, trip, dep, depTime, dest, destTime } nebo null. */
export function parseVdvTimetable(html) {
  const label = htmlText(/id="currentLineRouteLabel"[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1]);
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(label);
  if (!m) return null;
  const cur = html.split(/id="timetableNextContainer"/)[0].split(/id="timetableCurrentContainer"/)[1] ?? '';
  const rows = [...cur.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map((r) => r.slice(1).map(htmlText));
  if (rows.length < 2) return { lic: m[1], trip: m[2], dep: null, depTime: null, dest: null, destTime: null };
  const [first, last] = [rows[0], rows.at(-1)];
  return { lic: m[1], trip: m[2], dep: first[0], depTime: first[2] || first[1], dest: last[0], destTime: last[1] || last[2] };
}

async function vdvTimetable(id) {
  const res = await fetch(`${VDV_SITE}/Ajax/GetTimetable?vehicleNumber=${encodeURIComponent(id)}&currentStopId=0`, { headers: VDV_HEADERS, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseVdvTimetable(await res.text());
}

/** Vůz z mapy VDV (+ jeho spoj) → spoj ve formátu map IREDO a IDSOK. */
export function vdvConnection(p, t) {
  const train = p.traction === 'TRAIN';
  const delay = Number(p.delay);
  const dest = /^-?\d+ N\/a$/.test(String(p.finalStopName ?? '')) ? null : p.finalStopName;
  return {
    id: p.id,
    lat: p.lat,
    lon: p.lng,
    name: train ? '' : `${t?.lic ?? p.text} ${t?.trip ?? ''}`.trim(),
    lineNumber: t?.lic ?? String(p.text ?? ''),
    serviceNumber: train ? null : (t?.trip ?? null),
    sourceType: train ? 'K' : 'S',
    vehicleType: train ? 'V' : 'A',
    trainNumber: train ? String(p.text ?? '') : undefined,
    dep: t?.dep ?? null,
    depTime: t?.depTime ?? null,
    dest: t?.dest ?? dest,
    destTime: t?.destTime ?? null,
    delay: Number.isFinite(delay) && Math.abs(delay) < 1000 ? delay : null,
  };
}

async function vdvList(ctx) {
  if (vdvLast && Date.now() - vdvLast.at < 10000) return vdvLast.list;
  const cache = globalThis.caches?.default;
  const res = await fetch(`${VDV_SITE}/Ajax/GetPoints`, { headers: VDV_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Záporná čísla vozů jsou spoje IDS JMK, ty má aplikace z vlastního zdroje.
  const all = await res.json();
  if (!Array.isArray(all)) throw new Error('neočekávaná odpověď');
  const points = all.filter((p) => Number(p.id) > 0 || p.traction === 'TRAIN');
  if (!vdvTrips) {
    vdvTrips = new Map();
    const saved = await cache?.match(VDV_CACHE).then((r) => r?.json()).catch(() => null);
    for (const [id, t] of saved ?? []) vdvTrips.set(String(id), t);
  }
  const now = Date.now();
  const nowMin = pragueMin(now);
  for (const [id, t] of vdvTrips) if (t.until < now) vdvTrips.delete(id);
  const todo = points.filter((p) => p.traction !== 'TRAIN' && /^\d{6}$/.test(String(p.text)) && vdvTrips.get(String(p.id))?.lic !== String(p.text)).slice(0, VDV_DETAILS);
  const got = await Promise.all(todo.map((p) => vdvTimetable(p.id).then((t) => [p, t], () => [p, null])));
  for (const [p, t] of got) {
    // Spoj platí do půl hodiny po příjezdu do cíle (nejvýš 4 h); bez jízdního řádu to zkusíme za 5 min.
    const left = t?.destTime ? (hmMin(t.destTime) - nowMin + 1440) % 1440 : NaN;
    const until = now + (t?.trip ? Math.min(240, (Number.isFinite(left) && left < 1200 ? left : 120) + 30) : 5) * 60000;
    vdvTrips.set(String(p.id), { ...(t ?? { lic: String(p.text) }), until });
  }
  if (got.length && cache && ctx?.waitUntil) {
    ctx.waitUntil(cache.put(VDV_CACHE, new Response(JSON.stringify([...vdvTrips]), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=14400' } })).catch(() => {}));
  }
  const list = points.map((p) => vdvConnection(p, vdvTrips.get(String(p.id))));
  vdvLast = { at: now, list };
  return list;
}

async function vdv(ctx) {
  try {
    const list = await vdvList(ctx);
    return new Response(JSON.stringify({ at: vdvLast.at, list }), {
      headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return new Response(`VDV: ${err.message}`, { status: 502, headers: CORS });
  }
}

async function cityBuses() {
  const [upstream, km, odis, pce] = await Promise.all([
    fetch(MPV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://mpvnet.cz', 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' },
      body: MPV_BODY,
    }),
    kromerizBuses(),
    odisBuses(),
    pardubiceBuses(),
  ]);
  if (!upstream.ok) return new Response('Upstream error', { status: 502, headers: CORS });
  const data = await upstream.json();
  const vehicles = (data.transmitters ?? [])
    .filter((t) => CITY_LICENCES.some((l) => String(t.cn ?? '').startsWith(l)) || (t.cat === 2 && CARRIERS.test(t.cr ?? '')))
    // Z kódu stačí prvních 12 polí (linka, spoj, zastávky, cíl, nízkopodlažnost, SPZ), zbytek jsou nuly.
    .map(({ cn, x, y, ico, ds, tm, cr }) => ({ cn: String(cn ?? '').split('|').slice(0, 12).join('|'), x, y, ico, ds, tm, cr }));
  return new Response(JSON.stringify({ vehicles, km, odis, pce }), {
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
// Další zastávky na projíždějících linkách (Jihlava AN a Brtnická, Třebíč AN, Humpolec, Pardubice AN): stačí
// odjezdy (spoje tudy projíždějí), ať se vejdeme do limitu dotazů workeru.
const FLIX_THROUGH = [
  'dcc272ee-9603-11e6-9066-549f350fcb0c',
  '9e581b7d-02d9-4819-898f-b555619acc49',
  '788d12d5-f922-4534-8389-d5e8d32cc9fb',
  '066fecd8-d91d-47bf-a55e-4339cdea0e11',
  '10776137-5278-4d4f-a308-9415d8a3c4c5',
];
// Obdélník kolem oblasti (WGS84), přesně ořízne aplikace.
const ZK_WGS = { s: 48.5, n: 50.35, w: 14.7, e: 18.95 };
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
    [...FLIX_STATIONS.flatMap((st) => [[st, 'departures'], [st, 'arrivals']]), ...FLIX_THROUGH.map((st) => [st, 'departures'])].map(([st, kind]) =>
      flixJson(`${FLIX}/v2/timetable/${st}/${kind}?from=${iso(t - 3 * 3600e3)}&to=${iso(t + 3 * 3600e3)}&${FLIX_KEY}`, 300),
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

// Živé polohy IDS JMK: veřejný proud KORDIS JMK (WebSocket). Proud posílá všechny vozy najednou zhruba
// jednou za 30 s; dávku si držíme (v paměti a v cache Cloudflaru) a obnovujeme na pozadí.
const JMK_STREAM = 'https://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe';
const JMK_FIELDS = 'ID,VType,LineName,Lat,Lng,Bearing,Course,LF,Delay,LastStopID,FinalStopID,IsInactive,TimeUpdated';
const JMK_LAST = 'https://dszo-proxy.internal/jmk-last';
let jmkLast = null; // { at, body }
let jmkPending = null;

/** Počká na jednu dávku proudu (nejvýš 28 s, waitUntil Cloudflaru dává 30 s) a vrátí ji jako JSON { at, list }. Zprávy se neparsují. */
async function collectJmk() {
  const res = await fetch(JMK_STREAM, { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`JMK stream: HTTP ${res.status}`);
  ws.accept();
  ws.send(JSON.stringify({ filter: { outFields: JMK_FIELDS } }));
  const messages = await new Promise((resolve) => {
    const list = [];
    let quiet = null;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(hard);
      try {
        ws.close();
      } catch {
        /* už zavřené */
      }
      resolve(list);
    };
    const hard = setTimeout(done, 28000);
    ws.addEventListener('message', (e) => {
      // Hned po připojení přijde potvrzení filtru (bez vozu); dávka vozů až pak, zhruba do 30 s.
      if (typeof e.data !== 'string' || !e.data.includes('"attributes"')) return;
      list.push(e.data);
      // Dávka přijde během chvilky: po 1,2 s ticha je celá.
      clearTimeout(quiet);
      quiet = setTimeout(done, 1200);
    });
    ws.addEventListener('close', done);
    ws.addEventListener('error', done);
  });
  if (!messages.length) throw new Error('JMK stream: žádná data');
  const at = Date.now();
  const body = `{"at":${at},"list":[${messages.join(',')}]}`;
  jmkLast = { at, body };
  await globalThis.caches?.default
    ?.put(JMK_LAST, new Response(body, { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'max-age=300' } }))
    .catch(() => {});
  return jmkLast;
}

function refreshJmk() {
  jmkPending ??= collectJmk()
    .catch(() => null)
    .finally(() => {
      jmkPending = null;
    });
  return jmkPending;
}

async function jmkSnapshot(ctx) {
  if (!jmkLast) {
    const cached = await globalThis.caches?.default?.match(JMK_LAST).catch(() => null);
    if (cached) {
      const body = await cached.text();
      const at = Number(/"at":(\d+)/.exec(body)?.[1]) || 0;
      if (!jmkLast || at > jmkLast.at) jmkLast = { at, body };
    }
  }
  const age = jmkLast ? Date.now() - jmkLast.at : Infinity;
  // Dávka starší než 25 s se obnoví na pozadí. Na novou se nikdy nečeká (trvá až 30 s): odpověď je hned
  // ta poslední (do 3 minut), jinak 503 a aplikace mezitím ukáže odhad podle jízdního řádu.
  if (age > 25000) ctx?.waitUntil?.(refreshJmk());
  if (!jmkLast || Date.now() - jmkLast.at > 180000) return new Response('No data', { status: 503, headers: CORS });
  return new Response(jmkLast.body, {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/trains') return trains();
    if (request.method === 'GET' && url.pathname === '/mhd') return cityBuses();
    if (request.method === 'GET' && url.pathname === '/jmk') return jmkSnapshot(ctx);
    if (request.method === 'GET' && url.pathname === '/idsok') return idsok();
    if (request.method === 'GET' && url.pathname === '/iredo') return iredo();
    if (request.method === 'GET' && url.pathname === '/vdv') return vdv(ctx);
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
