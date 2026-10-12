// Autobusy bez živé polohy (regionální linky IDS JMK a ostatních dopravců, dálkové a mezinárodní linky):
// kde teď podle jízdního řádu jedou. Berou se ze stejných dat jako vyhledávání spojení (tt/planner.json),
// takže co je na mapě, jde vždy najít i ve spojích. Poloha je odhad po silnici mezi zastávkami.
import { regionContains, krajOf } from './region.js';
import { along } from './regiojet.js';
import { tripGeometry } from './route-match.js';
import { cityStopName, lineLabel } from './cities.js';

// Sítě, jejichž vozy nemají jinou polohu. FlixBus a RegioJet mají vlastní zdroj uvnitř Zlínského kraje,
// jinde (Jihomoravský kraj) je odhadneme také z jízdního řádu.
const ESTIMATED = new Set(['jmk', 'other', 'coach', 'flix', 'rj']);
const OWN_SOURCE = new Set(['flix', 'rj']);

const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;

const indexCache = new WeakMap(); // planner -> spoje sítí z ESTIMATED
function tripsOf(P) {
  if (!indexCache.has(P)) indexCache.set(P, P.trips.filter((t) => ESTIMATED.has(t.pattern.c)));
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
function segmentsOf(P, pattern) {
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

/**
 * Autobusy, které teď podle jízdního řádu jedou uvnitř oblasti.
 * date = dnešní datum v Praze („2026-10-12“), min = minuty od půlnoci (i se zlomkem).
 */
export function estimatedVehicles(P, region, date, min) {
  if (!P) return [];
  const di = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${P.startDate}T00:00:00Z`)) / 86400000);
  const out = [];
  for (const trip of tripsOf(P)) {
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
      // FlixBus a RegioJet uvnitř Zlínského kraje ukazují vlastní zdroje.
      if (OWN_SOURCE.has(pattern.c) && (!region || krajOf(region, pos.lon, pos.lat) === 'zlk')) continue;
      const calls = s.map((si, i) => ({ seq: i + 1, name: cityStopName(pattern.c, P.stops[si].name), lat: P.stops[si].lat, lon: P.stops[si].lon, time: hhmm(times[i]) }));
      out.push({
        id: `est-${trip.id}-${day}`,
        type: 'bus',
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
