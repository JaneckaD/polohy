// Autobusy RegioJet, které jezdí přes Zlínský kraj: jízdní řády z veřejného API RegioJetu
// (stejná data jako stránky zastávek na regiojet.cz) → public/rj.json.
// Polohy vozů RegioJet nezveřejňuje, aplikace je proto odhaduje podle jízdního řádu.
// Úseky mezi zastávkami spočítá OSRM (vlastní z scripts/osrm-local.sh, jinak veřejný).
import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://brn-ybus-pubapi.sa.cz/restapi';
const HEADERS = { 'X-Lang': 'cs', 'X-Currency': 'CZK', 'X-Application-Origin': 'WEB', 'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)' };
const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const PUBLIC_OSRM = OSRM === 'https://router.project-osrm.org';
const OUT = new URL('../public/rj.json', import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.json();
      console.warn(`RegioJet ${path}: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`RegioJet ${path}: ${err.message}`);
    }
    await sleep(2000);
  }
  throw new Error(`RegioJet ${path} nejde načíst`);
}

function inside(ring, lon, lat) {
  let ok = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}

/** „09:45:00.000“ → minuty od půlnoci, prázdné → null. */
const minutes = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

/** Google polyline (přesnost 5) z [[lon, lat], …]. */
function encodePolyline(coords) {
  let out = '';
  let pLat = 0;
  let pLon = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of coords) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lon * 1e5);
    out += enc(a - pLat) + enc(b - pLon);
    pLat = a;
    pLon = b;
  }
  return out;
}

async function road(a, b) {
  const url = `${OSRM}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=simplified&geometries=geojson`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const json = res.ok ? await res.json() : null;
      if (PUBLIC_OSRM) await sleep(1100);
      if (json?.code === 'Ok') return json.routes[0].geometry.coordinates;
    } catch {
      /* zkusíme znovu */
    }
  }
  return null;
}

async function main() {
  const region = JSON.parse(await readFile(new URL('../public/region.json', import.meta.url), 'utf8'));
  const ring = region.geometry.coordinates[0];

  // Zastávky RegioJetu s polohou; v kraji jsou ty uvnitř hranice.
  const stations = new Map();
  for (const country of await api('/consts/locations')) {
    for (const city of country.cities ?? []) {
      for (const s of city.stations ?? []) {
        const lat = Number(s.latitude);
        const lon = Number(s.longitude);
        stations.set(s.id, { name: s.fullname || `${city.name} - ${s.name}`, lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null });
      }
    }
  }
  const kraj = [...stations].filter(([, s]) => s.lat != null && inside(ring, s.lon, s.lat)).map(([id]) => id);
  console.log(`RegioJet: ${stations.size} zastávek, v kraji ${kraj.length}`);

  // Linky přes zastávky v kraji (jízdní řád „WEB“ je ten, který ukazuje regiojet.cz).
  // Seznam linek zastávky API někdy odmítne (HTTP 400), proto i známé linky: 721311 Brno – Kroměříž – Zlín
  // a 721308 Brno – Olomouc – Ostrava (některé spoje přes Zlín).
  const lines = new Set([721311, 721308]);
  for (const id of kraj) {
    try {
      for (const l of await api(`/consts/lines/${id}`)) if (l.lineGroupCode === 'WEB') lines.add(l.lineNumber);
    } catch (err) {
      console.warn(err.message);
    }
  }
  console.log(`RegioJet: linky přes kraj ${[...lines].join(', ') || 'žádné'}`);

  const conns = [];
  const codesOf = new Map();
  const krajSet = new Set(kraj);
  for (const line of lines) {
    for (const c of await api(`/consts/timetables/WEB/${line}`)) {
      // Jen zastávky s časem („<“ = tudy nejede nebo nezastavuje).
      const stops = [];
      let last = -1;
      let shift = 0;
      for (const s of c.stations ?? []) {
        let arr = minutes(s.arrival);
        let dep = minutes(s.departure);
        if (arr == null && dep == null) continue;
        // Přes půlnoc: časy dál rostou.
        if ((arr ?? dep) + shift < last) shift += 1440;
        if (arr != null) arr += shift;
        if (dep != null) dep += shift;
        last = dep ?? arr;
        stops.push([s.stationId, arr, dep]);
      }
      if (stops.length < 2 || !stops.some(([id]) => krajSet.has(id))) continue;
      if (!codesOf.has(c.timetableId)) codesOf.set(c.timetableId, await api(`/consts/timetables/${c.timetableId}/time-codes`));
      const codes = codesOf.get(c.timetableId);
      conns.push({
        id: c.connectionId,
        line,
        from: c.fromCityName,
        to: c.toCityName,
        valid: [c.validFrom, c.validTo],
        sym: c.symbols ?? [],
        codes: (c.timeCodes ?? []).flatMap((m) => codes.find((x) => x.mark === m)?.items ?? []).map((i) => [i.type, i.from, i.to]),
        stops,
      });
    }
  }

  // Trasy po silnicích mezi po sobě jdoucími zastávkami.
  const segs = {};
  for (const c of conns) {
    for (let i = 0; i + 1 < c.stops.length; i++) {
      const a = stations.get(c.stops[i][0]);
      const b = stations.get(c.stops[i + 1][0]);
      const key = `${c.stops[i][0]}-${c.stops[i + 1][0]}`;
      if (key in segs || a?.lat == null || b?.lat == null) continue;
      const coords = await road([a.lat, a.lon], [b.lat, b.lon]);
      segs[key] = coords ? encodePolyline(coords) : null;
    }
  }
  const used = new Set(conns.flatMap((c) => c.stops.map(([id]) => id)));
  const out = {
    built: new Date().toISOString(),
    stations: Object.fromEntries([...used].map((id) => [id, [stations.get(id)?.name ?? String(id), stations.get(id)?.lat ?? null, stations.get(id)?.lon ?? null]])),
    segs,
    conns,
  };
  await writeFile(OUT, JSON.stringify(out));
  const missing = Object.values(segs).filter((s) => !s).length;
  console.log(`RegioJet: ${conns.length} spojů přes kraj, ${Object.keys(segs).length} úseků (bez trasy ${missing}).`);
}

main().catch(async (err) => {
  // Bez dat RegioJetu aplikace funguje dál: použijeme minulou verzi z webu, nebo prázdná data.
  console.error(`RegioJet: ${err.message}`);
  let previous = null;
  if (process.env.PAGES_URL) {
    try {
      const res = await fetch(new URL('rj.json', process.env.PAGES_URL));
      if (res.ok) previous = await res.text();
    } catch {
      /* nic */
    }
  }
  await writeFile(OUT, previous ?? JSON.stringify({ stations: {}, segs: {}, conns: [] }));
});
