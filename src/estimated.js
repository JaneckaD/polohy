// Autobusy bez živé polohy (regionální linky IDS JMK a ostatních dopravců, dálkové a mezinárodní linky):
// kde teď podle jízdního řádu jedou. Berou se ze stejných dat jako vyhledávání spojení (tt/planner.json),
// takže co je na mapě, jde vždy najít i ve spojích. Poloha je odhad po silnici mezi zastávkami.
import { regionContains, krajOf } from './region.js';
import { along } from './regiojet.js';
import { tripGeometry } from './route-match.js';
import { cityStopName, lineLabel } from './cities.js';

// Sítě, jejichž vozy nemají jinou polohu. FlixBus a RegioJet mají vlastní zdroj uvnitř Zlínského kraje,
// jinde (Jihomoravský kraj) je odhadneme také z jízdního řádu. Linky IDS JMK (regionální i MHD) jedou živě
// z proudu KORDIS (src/jmk.js); odhadem jen, když proud nefunguje.
// MHD Olomouckého, Moravskoslezského a Pardubického kraje (town) a regionální linky (other) mohou jet živě
// z map ODIS, IDSOK, IREDO a MHD Pardubice:
// spoj, jehož vůz je na mapě živě, se odhadem neukazuje (setLiveTrips).
const ESTIMATED = new Set(['other', 'coach', 'flix', 'rj', 'town']);
const JMK_FALLBACK = new Set(['jmk', 'brno', 'jmkmhd']);
const OWN_SOURCE = new Set(['flix', 'rj']);
let jmkDown = false;
let liveTrips = new Set();
let liveKraje = new Set();
let liveTowns = new Set();
// MHD měst s vlastní živou mapou (mimo mapu kraje): jedou živě, jen když jejich mapa právě posílá vozy.
const OWN_TOWN_MAPS = new Set(['MHD Pardubice']);
// Kraje, jejichž mapa MHD měst neukazuje (VDV na Vysočině jen regionální linky): MHD se tam dál odhaduje.
const MAP_WITHOUT_TOWNS = new Set(['vys']);
/**
 * Kraje, kde mapa (ODIS v Moravskoslezském, IDSOK v Olomouckém, IREDO v Pardubickém, VDV na Vysočině) právě posílá vozy:
 * regionální linky a MHD se tam neodhadují (jedou živě, jako linky IDZK ve Zlínském kraji); vůz, ke kterému
 * se spoj nenašel, by se jinak ukázal dvakrát. towns = MHD měst s vlastní mapou, která právě posílá vozy.
 */
export function setLiveKraje(kraje, towns = []) {
  liveKraje = new Set(kraje);
  liveTowns = new Set(towns);
}
function liveNow(pattern, kraj) {
  if (pattern.c === 'town' && OWN_TOWN_MAPS.has(pattern.o)) return liveTowns.has(pattern.o);
  if (pattern.c === 'town' && MAP_WITHOUT_TOWNS.has(kraj)) return false;
  return (pattern.c === 'town' || pattern.c === 'other') && liveKraje.has(kraj);
}
/** Spoje (id spoje v datech vyhledávání), které právě jedou živě: jejich odhad se neukáže. */
export function setLiveTrips(ids) {
  liveTrips = ids instanceof Set ? ids : new Set(ids);
}
/** Živý proud IDS JMK nefunguje: jeho linky se ukážou odhadem podle jízdního řádu. */
export function setJmkDown(down) {
  jmkDown = !!down;
}

const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;

const indexCache = new WeakMap(); // planner -> spoje sítí z ESTIMATED
function tripsOf(P) {
  if (!indexCache.has(P)) indexCache.set(P, P.trips.filter((t) => ESTIMATED.has(t.pattern.c) || JMK_FALLBACK.has(t.pattern.c)));
  return indexCache.get(P);
}

// Trasy po silnicích (routes-bus.json): kus trasy mezi zastávkami vzoru spoje, spočítaný jednou.
let routesByCity = new Map();
export function setBusRoutes(routes) {
  routesByCity = new Map();
  for (const r of routes ?? []) {
    if (!routesByCity.has(r.city)) routesByCity.set(r.city, []);
    routesByCity.get(r.city).push(r);
  }
  patternGeo = new WeakMap();
}
export const hasBusRoutes = () => routesByCity.size > 0;

let patternGeo = new WeakMap(); // vzor spoje -> segmenty [[lon, lat], …] | null
export function segmentsOf(P, pattern) {
  if (!patternGeo.has(pattern)) {
    const own = routesByCity.get(pattern.c);
    let segments = null;
    if (own?.length) {
      const trip = pattern.s.map((si) => ({ name: cityStopName(pattern.c, P.stops[si].name) }));
      segments = tripGeometry(trip, own, `${pattern.c}:${pattern.r}`, {}).segments;
    }
    patternGeo.set(pattern, segments);
  }
  return patternGeo.get(pattern);
}

// Zastávky spoje se staví jednou (při každé obnově se jinak tvořily znovu pro každý vůz).
const callsCache = new WeakMap();
function callsOf(P, trip) {
  let calls = callsCache.get(trip);
  if (!calls) {
    const { pattern, times } = trip;
    calls = pattern.s.map((si, i) => ({ seq: i + 1, name: cityStopName(pattern.c, P.stops[si].name), lat: P.stops[si].lat, lon: P.stops[si].lon, time: hhmm(times[i]) }));
    callsCache.set(trip, calls);
  }
  return calls;
}

/**
 * Autobusy, které teď podle jízdního řádu jedou uvnitř oblasti.
 * date = dnešní datum v Praze („2026-10-12“), min = minuty od půlnoci (i se zlomkem).
 */
export function estimatedVehicles(P, region, date, min) {
  if (!P) return [];
  const di = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${P.startDate}T00:00:00Z`)) / 86400000);
  const out = [];
  for (const trip of tripsOf(P)) {
    if (!jmkDown && JMK_FALLBACK.has(trip.pattern.c)) continue;
    if (liveTrips.has(trip.id)) continue;
    // Spoj dnešního dne, nebo včerejšího, který jede přes půlnoc (časy po 24:00).
    for (const [day, t] of [[di, min], [di - 1, min + 1440]]) {
      if (day < 0 || day >= P.days || trip.mask[day] !== '1') continue;
      const { times, arr, pattern } = trip;
      if (t < arr[0] || t > times.at(-1)) continue;
      const s = pattern.s;
      let k = 0;
      while (k < s.length - 2 && t >= arr[k + 1]) k++;
      let atStop = false;
      let ni = k + 1;
      let pos = null;
      const stop = (i) => P.stops[s[i]];
      if (t >= arr[k] && t <= times[k]) {
        atStop = true;
        ni = k;
        if (stop(k).lat == null) continue;
        pos = { lat: stop(k).lat, lon: stop(k).lon, bearing: null };
      } else {
        const a = stop(k);
        const b = stop(k + 1);
        if (a.lat == null || b.lat == null) continue;
        const f = (t - times[k]) / Math.max(arr[k + 1] - times[k], 1e-6);
        const line = segmentsOf(P, pattern)?.[k];
        pos = line?.length > 1 ? along(line, f) : along([[a.lon, a.lat], [b.lon, b.lat]], f);
      }
      if (region && !regionContains(region, pos.lon, pos.lat)) continue;
      if ((liveKraje.size || liveTowns.size) && region && (pattern.c === 'town' || pattern.c === 'other') && liveNow(pattern, krajOf(region, pos.lon, pos.lat))) continue;
      // FlixBus a RegioJet uvnitř Zlínského kraje ukazují vlastní zdroje.
      if (OWN_SOURCE.has(pattern.c) && (!region || krajOf(region, pos.lon, pos.lat) === 'zlk')) continue;
      const calls = callsOf(P, trip);
      out.push({
        id: `est-${trip.id}-${day}`,
        type: pattern.y === 'r' ? 'tram' : pattern.y === 't' ? 'trolleybus' : 'bus',
        city: pattern.c,
        line: lineLabel(pattern.r),
        lineRef: pattern.r,
        lineName: null,
        estimated: true,
        international: !!pattern.i,
        operatorName: pattern.o ?? null,
        lat: pos.lat,
        lon: pos.lon,
        bearing: pos.bearing,
        stop: atStop ? calls[ni].name : calls[ni - 1]?.name ?? null,
        next: atStop ? (calls[ni + 1]?.name ?? null) : (calls[ni]?.name ?? null),
        from: calls[0].name,
        headsign: pattern.h,
        tripNo: trip.no ?? null,
        lowFloor: null,
        features: [],
        plate: null,
        delay: null,
        delayText: '',
        updated: null,
        calls,
        nextIndex: ni,
        atStop,
        // Kusy trasy po silnici; kde chybí, dopočítá se při výběru vozu.
        segments: segmentsOf(P, pattern) ?? s.slice(1).map(() => null),
      });
    }
  }
  return out;
}
