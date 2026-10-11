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
    // Příjezdy: vlaky ve stanici stojí, jinde je příjezd = odjezd.
    const dwell = data.dwell?.[id];
    const arr = dwell ? times.map((t, i) => t - (dwell[i] ?? 0)) : times;
    return { id, pattern: data.patterns[p], mask: data.masks[m], times, arr, no: data.tripNo?.[id] ?? null };
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
  const walkMin = new Map();
  walks.forEach((list, a) => list.forEach((w) => walkMin.set(a * stops.length + w.to, w)));
  return { startDate: data.startDate, days: data.days, stops, trips, walks, walkMin, connCache: new Map() };
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
      const arr = trip.arr[k + 1] - shift;
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
export function earliestJourney(P, { origins, target, date, time, penalty = 0, walkTransfers = true, avoid = null }) {
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
    if (avoid?.has(c.trip)) continue;
    const key = `${c.trip}|${c.shift}`;
    const inTrip = tripEnter.has(key);
    if (!inTrip && ready[c.from] > c.dep) continue;
    if (!inTrip) tripEnter.set(key, c);
    if (c.arr < arrival[c.to]) {
      arrival[c.to] = c.arr;
      ready[c.to] = Math.min(ready[c.to], c.arr + MIN_CHANGE_MIN + penalty);
      how[c.to] = { type: 'ride', enter: tripEnter.get(key), exit: c };
      if (walkTransfers) reachByWalk(c.to, c.arr, P.walks[c.to], penalty);
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
  return finishJourney(improveTransfers(P, legs));
}

/**
 * Nejrychlejší hledání vystoupí z prvního vozu co nejpozději a přestoupí „na těsno“.
 * Pro každý přestup proto zkusíme všechna místa, kde jde z prvního vozu vystoupit a do druhého
 * (stejného spoje) nastoupit, a vybereme to s nejkratší chůzí a dostatečnou rezervou –
 * raději dřív vystoupit a počkat. Příjezd do cíle se nemění.
 */
function improveTransfers(P, legs) {
  const n = P.stops.length;
  const rides = legs.filter((l) => l.type === 'ride');
  if (rides.length < 2) return legs;
  // Původní pěší přesuny mezi jízdami (když lepší místo přestupu nenajdeme, zůstanou).
  legs.forEach((l, i) => {
    if (l.type === 'ride' && legs[i - 1]?.type === 'walk' && i > 1) l.walkBefore = { min: legs[i - 1].min, m: legs[i - 1].m };
  });
  // Nejlepší místo přestupu z jízdy a na jízdu b, nebo null, když na sebe nenavazují.
  const bestLink = (a, b) => {
    const as = a.trip.pattern.s;
    const bs = b.trip.pattern.s;
    let best = null;
    for (let k = a.fromK + 1; k < as.length; k++) {
      const arr = a.trip.arr[k] - a.shift;
      for (let m = 0; m < b.toK; m++) {
        const dep = b.trip.times[m] - b.shift;
        if (dep < arr) continue;
        const sa = as[k];
        const sb = bs[m];
        const w = sa === sb ? null : P.walkMin.get(sa * n + sb);
        if (sa !== sb && !w) continue;
        const walk = w ? w.min : 0;
        const slack = dep - arr - walk;
        if (slack < (walk ? 0 : MIN_CHANGE_MIN)) continue;
        // Chůze je nejdražší, těsný přestup (pod 3 min) penalizujeme, delší rezerva je drobné plus.
        const score = walk + (slack < 3 ? (3 - slack) * 3 : 0) - Math.min(slack, 15) * 0.1;
        if (!best || score < best.score) best = { score, k, m, w, arr, dep };
      }
    }
    return best;
  };
  // Zbytečné „přeskoky“ (jedna zastávka jiným vozem jen kvůli dřívějšímu přestupu) vynecháme,
  // když jde z předchozí jízdy přestoupit rovnou na následující.
  for (let i = 1; i < rides.length - 1; i++) {
    if (bestLink(rides[i - 1], rides[i + 1])) {
      rides.splice(i, 1);
      i--;
    }
  }
  for (let r = 0; r < rides.length - 1; r++) {
    const a = rides[r];
    const b = rides[r + 1];
    const best = bestLink(a, b);
    if (!best) continue;
    a.toK = best.k;
    a.to = a.trip.pattern.s[best.k];
    a.arr = best.arr;
    b.fromK = best.m;
    b.from = b.trip.pattern.s[best.m];
    b.dep = best.dep;
    b.walkBefore = best.w ? { min: best.w.min, m: best.w.m } : null;
  }
  // Úseky znovu poskládáme: pěší přesun mezi jízdami jen tam, kde se mění zastávka.
  const out = [];
  if (legs[0].type === 'walk') out.push(legs[0]);
  rides.forEach((ride, i) => {
    if (i > 0 && ride.walkBefore) out.push({ type: 'walk', from: rides[i - 1].to, to: ride.from, min: ride.walkBefore.min, m: ride.walkBefore.m });
    delete ride.walkBefore;
    out.push(ride);
  });
  if (legs.at(-1).type === 'walk') {
    const last = legs.at(-1);
    out.push({ ...last, from: rides.at(-1).to });
  }
  return out;
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
  let result = [];
  // Hledání je rychlé, takže klidně víckrát: při řídkých spojích se k dalšímu příjezdu
  // dostaneme až přes několik dřívějších odjezdů, které všechny čekají na stejný spoj.
  for (let i = 0; i < 60; i++) {
    const fast = earliestJourney(P, { origins, target, date, time: t });
    if (!fast) break;
    add(fast);
    const q = { origins, target, date, time: t };
    if (fast.transfers) {
      // Varianty: s méně přestupy (přestup „stojí“ 10 min navíc), bez přecházení mezi zastávkami
      // a jinými spoji (bez každého ze spojů nejrychlejší varianty).
      add(earliestJourney(P, { ...q, penalty: 10 }));
      // Co nejjednodušší cesta (třeba jedním vlakem nebo jednou linkou), i když je o něco delší.
      add(earliestJourney(P, { ...q, penalty: 30 }));
      if (fast.walkTransfers) add(earliestJourney(P, { ...q, walkTransfers: false }));
      for (const l of fast.legs) if (l.type === 'ride') add(earliestJourney(P, { ...q, avoid: new Set([l.trip.id]) }));
    }
    // Další hledání od odjezdu prvního vozu + 1 min (dřív odejít nemá smysl).
    t = fast.firstRideDep - (fast.legs[0].type === 'walk' ? fast.legs[0].min : 0) + 1;
    result = bestOf(found);
    // Dál už nemá smysl hledat, když nové spojení přijede později než všechna nabízená
    // (pozdější hledání je už nemůže nahradit, ani jednodušším spojením o 10 min později).
    if (result.length >= count && found.at(-1).arr > Math.max(...result.slice(0, count).map((j) => j.arr)) + 10) break;
  }
  return result.slice(0, count);
}

function bestOf(found) {
  const good = found.filter((j) => !dominated(j, found));
  // Výrazně horší spojení (pomalé, s víc přestupy) nemá cenu nabízet.
  const cost = (j) => j.duration + 5 * j.transfers + 3 * j.walkTransfers;
  const best = Math.min(...good.map(cost));
  return good.filter((j) => cost(j) <= best * 1.6 + 10).sort((a, b) => a.dep - b.dep || a.arr - b.arr);
}

// Spojení je zbytečné, když jiné odjíždí později (nebo stejně), přijede dřív (nebo stejně)
// a nedá víc námahy (přestupy, chůze) – a aspoň v jednom je lepší.
// Námaha: přestup jako 5 minut, k tomu všechny minuty chůze.
const effort = (j) => 5 * j.transfers + j.legs.reduce((a, l) => a + (l.type === 'walk' ? l.min : 0), 0);

function dominated(j, all) {
  const ej = effort(j);
  return all.some((k) => {
    if (k === j) return false;
    const ek = effort(k);
    // Jednodušší spojení (méně přestupů, třeba přímý vlak místo kombinace s MHD), které odjíždí
    // nejvýš o 10 minut dřív a přijede nejvýš o 10 minut později, zbytečné přestupování nahradí.
    if (k.transfers < j.transfers && ek < ej && k.dep >= j.dep - 10 && k.arr <= j.arr + 10) return true;
    if (k.arr > j.arr) return false;
    if (ek > ej) return false;
    // Stejné časy i námaha (jen jiný vlak nebo vůz uprostřed): stačí jedno z nich.
    if (k.dep === j.dep && k.arr === j.arr && ek === ej && k.transfers === j.transfers) return all.indexOf(k) < all.indexOf(j);
    if (k.dep >= j.dep) return k.dep > j.dep || k.arr < j.arr || ek < ej;
    // Vyjít o chvilku dřív a být tam mnohem dřív (nebo s menší námahou) je lepší volba;
    // čím víc času se ušetří, tím dřív se vyplatí vyjít (třetina ušetřeného času, aspoň 3 min).
    const saved = j.arr - k.arr;
    return k.dep >= j.dep - Math.max(3, saved / 3) && (saved >= 5 || ek < ej);
  });
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
    // U poslední zastávky úseku čas příjezdu, jinak odjezdu.
    const times = k === leg.toK ? leg.trip.arr : leg.trip.times;
    out.push({ name: s.name, lat: s.lat, lon: s.lon, time: times[k] - leg.shift });
  }
  return out;
}
