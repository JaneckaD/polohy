// Vyhledávání spojení (algoritmus Connection Scan) nad daty tt/planner.json.
// Umí přestupy na stejné zastávce i pěší přestupy mezi blízkými zastávkami (nejvýš 10 minut chůze).
// Čisté funkce bez DOM, aby šly testovat v Node.

import { normalizeName } from './names.js';

export const MAX_WALK_MIN = 10;
const WALK_M_PER_MIN = 75; // asi 4,5 km/h
const DETOUR = 1.3; // ulice nejsou vzdušnou čarou
const MIN_CHANGE_MIN = 1; // přestup na stejné zastávce

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const walkMinutes = (meters) => Math.max(1, Math.ceil((meters * DETOUR) / WALK_M_PER_MIN));

/** Připraví data: rozbalí časy spojů a spočítá pěší přestupy. */
export function preparePlanner(data) {
  const stops = data.stops.map(([name, lat, lon], i) => ({ i, name, lat, lon, norm: normalizeName(name) }));
  const trips = data.trips.map(([p, m, t0, ...deltas], id) => {
    const times = [t0];
    for (const d of deltas) times.push(times.at(-1) + d);
    return { id, pattern: data.patterns[p], mask: data.masks[m], times };
  });
  // Pěší přestupy: dvojice různých zastávek do 10 minut chůze.
  const walks = stops.map(() => []);
  for (const a of stops) {
    if (a.lat == null) continue;
    for (const b of stops) {
      if (b.i <= a.i || b.lat == null) continue;
      const m = distanceMeters(a.lat, a.lon, b.lat, b.lon);
      const min = walkMinutes(m);
      if (min > MAX_WALK_MIN) continue;
      walks[a.i].push({ to: b.i, min, m: Math.round(m * DETOUR) });
      walks[b.i].push({ to: a.i, min, m: Math.round(m * DETOUR) });
    }
  }
  return { startDate: data.startDate, days: data.days, stops, trips, walks, connCache: new Map() };
}

const dayIndex = (start, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);

/** Spoje jedoucí v daný den, rozložené na úseky mezi zastávkami a seřazené podle odjezdu. */
export function connectionsFor(P, date) {
  if (P.connCache.has(date)) return P.connCache.get(date);
  const di = dayIndex(P.startDate, date);
  const conns = [];
  const add = (trip, shift) => {
    const s = trip.pattern.s;
    for (let k = 0; k < s.length - 1; k++) {
      const dep = trip.times[k] - shift;
      const arr = trip.times[k + 1] - shift;
      if (arr < 0) continue;
      conns.push({ dep, arr, from: s[k], to: s[k + 1], trip: trip.id, k, shift });
    }
  };
  for (const trip of P.trips) {
    if (di >= 0 && di < P.days && trip.mask[di] === '1') add(trip, 0);
    // Spoje z předchozího dne, které jedou po půlnoci.
    if (di - 1 >= 0 && di - 1 < P.days && trip.mask[di - 1] === '1' && trip.times.at(-1) >= 1440) add(trip, 1440);
  }
  conns.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
  P.connCache.set(date, conns);
  if (P.connCache.size > 4) P.connCache.delete(P.connCache.keys().next().value);
  return conns;
}

/**
 * Jedno nejrychlejší spojení. origins = [{ stop, walk }] (walk = minuty chůze k zastávce, 0 pro zvolenou zastávku),
 * target = index cílové zastávky, time = minuty od půlnoci. Vrací seznam úseků nebo null.
 */
export function earliestJourney(P, { origins, target, date, time, penalty = 0 }) {
  const conns = connectionsFor(P, date);
  const n = P.stops.length;
  const arrival = new Array(n).fill(Infinity); // kdy tam nejdřív jsem
  const ready = new Array(n).fill(Infinity); // kdy tam můžu nastoupit do jiného vozu
  const how = new Array(n).fill(null);
  const tripEnter = new Map();

  // penalty = minuty navíc za každý přestup: hledání pak dává přednost spojení s méně přestupy.
  const reachByWalk = (from, t, viaWalks, extra = 0) => {
    for (const w of viaWalks) {
      const at = t + w.min + extra;
      if (at < arrival[w.to]) {
        arrival[w.to] = at;
        ready[w.to] = at;
        how[w.to] = { type: 'walk', from, min: w.min, m: w.m };
      }
    }
  };

  for (const o of origins) {
    const at = time + o.walk;
    if (at < arrival[o.stop]) {
      arrival[o.stop] = at;
      ready[o.stop] = at;
      how[o.stop] = o.walk ? { type: 'walk', from: -1, min: o.walk, m: o.m } : { type: 'start' };
    }
  }
  // Ze zvolené zastávky je možné dojít pěšky i na blízké zastávky.
  for (const o of origins) if (!o.walk) reachByWalk(o.stop, time, P.walks[o.stop]);

  let lo = 0;
  let hi = conns.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (conns[mid].dep < time) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < conns.length; i++) {
    const c = conns[i];
    if (c.dep > arrival[target]) break;
    const key = `${c.trip}|${c.shift}`;
    const inTrip = tripEnter.has(key);
    if (!inTrip && ready[c.from] > c.dep) continue;
    if (!inTrip) tripEnter.set(key, c);
    if (c.arr < arrival[c.to]) {
      arrival[c.to] = c.arr;
      ready[c.to] = Math.min(ready[c.to], c.arr + MIN_CHANGE_MIN + penalty);
      how[c.to] = { type: 'ride', enter: tripEnter.get(key), exit: c };
      reachByWalk(c.to, c.arr, P.walks[c.to], penalty);
    }
  }
  if (!Number.isFinite(arrival[target])) return null;

  const legs = [];
  let s = target;
  for (let guard = 0; guard < 50; guard++) {
    const h = how[s];
    if (!h || h.type === 'start') break;
    if (h.type === 'walk') {
      legs.unshift({ type: 'walk', from: h.from, to: s, min: h.min, m: h.m, arr: arrival[s] });
      if (h.from < 0) break;
      s = h.from;
    } else {
      const trip = P.trips[h.enter.trip];
      legs.unshift({
        type: 'ride',
        trip,
        shift: h.enter.shift,
        fromK: h.enter.k,
        toK: h.exit.k + 1,
        from: h.enter.from,
        to: h.exit.to,
        dep: h.enter.dep,
        arr: h.exit.arr,
      });
      s = h.enter.from;
    }
  }
  return finishJourney(legs);
}

function finishJourney(legs) {
  // Pěší úsek na konci za poslední jízdou: arr jízdy + chůze. Na začátku dopočítáme odchod.
  const rides = legs.filter((l) => l.type === 'ride');
  if (!rides.length) return null;
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    if (l.type !== 'walk') continue;
    const prev = legs[i - 1];
    const next = legs[i + 1];
    l.dep = prev ? prev.arr : next.dep - l.min;
    l.arr = l.dep + l.min;
  }
  // Stejná linka pokračuje ze stejné zastávky (např. přes konečnou): v praxi se zůstává ve voze.
  let stays = 0;
  for (let i = 1; i < legs.length; i++) {
    const a = legs[i - 1];
    const b = legs[i];
    if (a.type === 'ride' && b.type === 'ride' && a.to === b.from && a.trip.pattern.r === b.trip.pattern.r && b.dep - a.arr <= 10) {
      b.stay = true;
      stays++;
    }
  }
  const dep = legs[0].dep;
  const arr = legs.at(-1).arr;
  return {
    legs,
    dep,
    arr,
    duration: arr - dep,
    transfers: rides.length - 1 - stays,
    walkTransfers: legs.filter((l, i) => l.type === 'walk' && i > 0 && i < legs.length - 1).length,
    firstRideDep: rides[0].dep,
  };
}

/** Několik spojení po sobě od zadaného času: nejrychlejší i ta s méně přestupy. */
export function searchJourneys(P, { origins, target, date, time, count = 5 }) {
  const found = [];
  const seen = new Set();
  const add = (j) => {
    if (!j) return;
    const sig = j.legs.map((l) => (l.type === 'ride' ? `${l.trip.id}:${l.from}-${l.to}` : `w${l.to}`)).join('|');
    if (seen.has(sig)) return;
    seen.add(sig);
    found.push(j);
  };
  let t = time;
  for (let i = 0; i < count * 3; i++) {
    const fast = earliestJourney(P, { origins, target, date, time: t });
    if (!fast) break;
    add(fast);
    // Totéž s „cenou“ přestupu: najde spojení s méně přestupy, i když přijede o pár minut později.
    if (fast.transfers) add(earliestJourney(P, { origins, target, date, time: t, penalty: 10 }));
    // Další hledání od odjezdu prvního vozu + 1 min (dřív odejít nemá smysl).
    t = fast.firstRideDep - (fast.legs[0].type === 'walk' ? fast.legs[0].min : 0) + 1;
    if (found.filter((j) => !dominated(j, found)).length >= count) break;
  }
  const good = found.filter((j) => !dominated(j, found));
  // Výrazně horší spojení (pomalé, s víc přestupy) nemá cenu nabízet.
  const cost = (j) => j.duration + 5 * j.transfers + 3 * j.walkTransfers;
  const best = Math.min(...good.map(cost));
  return good
    .filter((j) => cost(j) <= best * 1.4 + 8)
    .sort((a, b) => a.dep - b.dep || a.arr - b.arr)
    .slice(0, count);
}

// Spojení je zbytečné, když jiné odjíždí později (nebo stejně), přijede dřív (nebo stejně)
// a nemá víc přestupů ani pěších přestupů – a aspoň v jednom je lepší.
function dominated(j, all) {
  return all.some(
    (k) =>
      k !== j &&
      k.dep >= j.dep &&
      k.arr <= j.arr &&
      k.transfers <= j.transfers &&
      k.walkTransfers <= j.walkTransfers &&
      (k.dep > j.dep || k.arr < j.arr || k.transfers < j.transfers || k.walkTransfers < j.walkTransfers),
  );
}

/** Zastávky podle textu (bez diakritiky, slova od začátku). */
export function findStops(P, query, limit = 8) {
  const q = normalizeName(query).split(' ').filter(Boolean);
  if (!q.length) return [];
  const scored = [];
  for (const s of P.stops) {
    const words = s.norm.split(' ');
    if (!q.every((w) => words.some((x) => x.startsWith(w)))) continue;
    const score = (s.norm.startsWith(q.join(' ')) ? 0 : 1) + s.norm.length / 100;
    scored.push([score, s]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, s]) => s);
}

/** Zastávky do 10 minut chůze od místa (pro „Moje poloha“). */
export function nearbyStops(P, lat, lon) {
  const out = [];
  for (const s of P.stops) {
    if (s.lat == null) continue;
    const m = distanceMeters(lat, lon, s.lat, s.lon);
    const min = walkMinutes(m);
    if (min <= MAX_WALK_MIN) out.push({ stop: s.i, walk: min, m: Math.round(m * DETOUR) });
  }
  return out.sort((a, b) => a.walk - b.walk).slice(0, 12);
}

/** Zastávky a časy jednoho úseku jízdy (pro detail spojení a kreslení na mapě). */
export function rideStops(P, leg) {
  const out = [];
  for (let k = leg.fromK; k <= leg.toK; k++) {
    const s = P.stops[leg.trip.pattern.s[k]];
    out.push({ name: s.name, lat: s.lat, lon: s.lon, time: leg.trip.times[k] - leg.shift });
  }
  return out;
}
