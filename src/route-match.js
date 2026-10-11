// Výběr trasy linky pro konkrétní vůz a rozdělení na projetou a zbývající část.
// Čisté funkce bez MapLibre, aby šly testovat v Node.
import { nameSimilarity, normalizeName, stripPlatform } from './names.js';

const M_PER_DEG_LAT = 111320;
const MAX_DISTANCE_M = 400;

function toXY([lon, lat], lat0) {
  return [lon * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180), lat * M_PER_DEG_LAT];
}

/** Nejbližší bod lomené čáry: { dist (m), along (m od začátku), seg, t, point: [lon, lat], bearing }. */
export function projectOnLine(line, lon, lat) {
  const p = toXY([lon, lat], lat);
  let best = null;
  let along = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = toXY(line[i], lat);
    const b = toXY(line[i + 1], lat);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len))) : 0;
    const dist = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (!best || dist < best.dist) {
      best = {
        dist,
        along: along + t * len,
        seg: i,
        t,
        point: [line[i][0] + t * (line[i + 1][0] - line[i][0]), line[i][1] + t * (line[i + 1][1] - line[i][1])],
        bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
      };
    }
    along += len;
  }
  return best;
}

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function tripOverlap(route, trip) {
  if (!trip?.length) return 0;
  let hit = 0;
  for (const s of trip) {
    const name = stripPlatform(s.name);
    if (route.stops.some(([n]) => nameSimilarity(n, name) >= 0.75)) hit++;
  }
  return hit / trip.length;
}

/** Najde nejpravděpodobnější variantu trasy pro vůz (linka, konečná, směr jízdy, jízdní řád). */
export function findRoute(routes, vehicle, trip) {
  let best = null;
  for (const route of routes) {
    if (route.ref !== vehicle.line || route.line.length < 2) continue;
    const proj = projectOnLine(route.line, vehicle.lon, vehicle.lat);
    if (!proj || proj.dist > MAX_DISTANCE_M) continue;

    let score = -proj.dist / 400;
    if (vehicle.headsign) {
      score += 2 * Math.max(nameSimilarity(route.to, vehicle.headsign), nameSimilarity(route.stops.at(-1)[0], vehicle.headsign));
    }
    score += 1.5 * tripOverlap(route, trip);
    if (Number.isFinite(vehicle.bearing)) score += Math.cos((angleDiff(vehicle.bearing, proj.bearing) * Math.PI) / 180);

    if (!best || score > best.score) best = { route, proj, score };
  }
  return best;
}

/** Rozdělí trasu v místě vozu: passed = už projeto, upcoming = kam ještě pojede. */
export function splitRoute(route, proj) {
  const passedLine = [...route.line.slice(0, proj.seg + 1), proj.point];
  const upcomingLine = [proj.point, ...route.line.slice(proj.seg + 1)];
  const stops = route.stops.map(([name, lat, lon]) => {
    const p = projectOnLine(route.line, lon, lat);
    return { name, lat, lon, passed: p ? p.along < proj.along - 15 : false };
  });
  return { passedLine, upcomingLine, stops };
}

/**
 * Náhradní trasa, když linka v OSM chybí: zastávky z jízdního řádu spoje dohledáme
 * ve slovníku zastávek a spojíme rovnými čarami.
 */
export function routeFromTrip(trip, stopIndex, currentStop) {
  const keys = Object.keys(stopIndex);
  const stops = [];
  for (const s of trip) {
    const name = stripPlatform(s.name);
    let pos = stopIndex[normalizeName(name)];
    if (!pos) {
      let bestSim = 0.8;
      for (const k of keys) {
        const sim = nameSimilarity(k, name);
        if (sim > bestSim) { bestSim = sim; pos = stopIndex[k]; }
      }
    }
    if (pos) stops.push({ name, time: s.time, lat: pos[0], lon: pos[1] });
  }
  if (stops.length < 2) return null;

  const current = currentStop ? stops.findIndex((s) => nameSimilarity(s.name, currentStop) >= 0.9) : -1;
  stops.forEach((s, i) => (s.passed = i <= current));
  const coords = stops.map((s) => [s.lon, s.lat]);
  const cut = Math.max(0, current);
  return {
    passedLine: current >= 0 ? coords.slice(0, cut + 1) : [],
    upcomingLine: coords.slice(cut),
    stops,
  };
}

/** Index aktuální zastávky v jízdním řádu spoje (−1, když ji nenajdeme). */
export function currentTripIndex(trip, currentStop) {
  if (!currentStop) return -1;
  let best = -1, bestSim = 0.7;
  trip.forEach((s, i) => {
    const sim = nameSimilarity(stripPlatform(s.name), currentStop);
    if (sim > bestSim) { bestSim = sim; best = i; }
  });
  return best;
}

/** Doplní k zastávkám trasy časy z jízdního řádu spoje. */
export function attachTimes(stops, trip) {
  if (!trip?.length) return stops;
  return stops.map((s) => {
    const t = trip.find((x) => nameSimilarity(stripPlatform(x.name), s.name) >= 0.75);
    return t ? { ...s, time: t.time } : s;
  });
}

// --- Trasa podle zastávek konkrétního spoje ------------------------------------------
// Spoj (spoj.php) říká přesné pořadí zastávek. Mezi každými dvěma po sobě jdoucími
// zastávkami vezmeme kus předpočítané trasy po silnicích (nejdřív stejné linky, pak
// jakékoli jiné), takže sedí i odbočky a zkrácené spoje a smyčky na konečných nic nepletou.

function cumulative(line) {
  const lat0 = line[0][1];
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    const a = toXY(line[i - 1], lat0);
    const b = toXY(line[i], lat0);
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return cum;
}

/** Kus lomené čáry mezi vzdálenostmi a < b (v metrech od začátku). */
export function sliceLine(line, cum, a, b) {
  const at = (d) => {
    let i = cum.findIndex((c) => c >= d);
    if (i <= 0) return { i: Math.max(i, 0), p: line[Math.max(i, 0)] };
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return { i, p: [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])] };
  };
  const s = at(a);
  const e = at(b);
  const out = [s.p];
  for (let i = s.i; i < e.i; i++) if (cum[i] > a) out.push(line[i]);
  out.push(e.p);
  return out;
}

const routeCache = new WeakMap();

/** Polohy zastávek trasy na její čáře, postupně od začátku (smyčky na konečných nepřeskočí). */
function routeInfo(route) {
  let info = routeCache.get(route);
  if (info) return info;
  const cum = cumulative(route.line);
  const alongs = [];
  let from = 0;
  const lat0 = route.line[0][1];
  for (const [, lat, lon] of route.stops) {
    const p = toXY([lon, lat], lat0);
    let best = null;
    for (let i = from; i < route.line.length - 1; i++) {
      const a = toXY(route.line[i], lat0);
      const b = toXY(route.line[i + 1], lat0);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len))) : 0;
      const dist = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      const along = cum[i] + t * len;
      // Mírně preferujeme bližší pokračování, aby zastávka nepadla na pozdější průjezd stejným místem.
      const score = dist + 0.05 * (along - (alongs.at(-1) ?? 0));
      if (!best || score < best.score) best = { score, along, seg: i };
    }
    alongs.push(best ? best.along : alongs.at(-1) ?? 0);
    if (best) from = best.seg;
  }
  info = { cum, alongs, names: route.stops.map(([n]) => normalizeName(n)) };
  routeCache.set(route, info);
  return info;
}

function stopIndices(route, info, name) {
  const norm = normalizeName(name);
  const exact = [];
  info.names.forEach((n, i) => n === norm && exact.push(i));
  if (exact.length) return exact;
  const similar = [];
  route.stops.forEach(([n], i) => nameSimilarity(n, name) >= 0.75 && similar.push(i));
  return similar;
}

/** Kus trasy mezi dvěma zastávkami spoje, nebo null. */
function segmentOnRoute(route, a, b) {
  const info = routeInfo(route);
  const ia = stopIndices(route, info, a);
  if (!ia.length) return null;
  const ib = stopIndices(route, info, b);
  for (const j of ia) {
    for (const k of ib) {
      if (k <= j || k - j > 3) continue;
      const from = info.alongs[j];
      const to = info.alongs[k];
      if (!(to > from)) continue;
      const coords = sliceLine(route.line, info.cum, from, to);
      if (coords.length < 2) continue;
      return { coords, from: route.stops[j], to: route.stops[k] };
    }
  }
  return null;
}

/**
 * Geometrie spoje: pro každou dvojici po sobě jdoucích zastávek kus trasy (nebo null, když chybí)
 * a polohy zastávek. routes = trasy z routes.json, stopIndex = slovník poloh zastávek.
 */
export function tripGeometry(trip, routes, ref, stopIndex = {}) {
  const names = trip.map((s) => stripPlatform(s.name));
  const usable = routes.filter((r) => r.line?.length > 1 && r.stops?.length > 1);
  const ordered = [...usable.filter((r) => r.ref === ref), ...usable.filter((r) => r.ref !== ref)];
  const segments = [];
  const coords = names.map(() => null);
  for (let i = 0; i < names.length - 1; i++) {
    let seg = null;
    for (const route of ordered) {
      seg = segmentOnRoute(route, names[i], names[i + 1]);
      if (seg) break;
    }
    segments.push(seg?.coords ?? null);
    if (seg) {
      coords[i] ??= [seg.from[1], seg.from[2]];
      coords[i + 1] = [seg.to[1], seg.to[2]];
    }
  }
  // Zastávky, které žádný kus trasy nepokryl: poloha ze slovníku zastávek.
  const keys = Object.keys(stopIndex);
  names.forEach((name, i) => {
    if (coords[i]) return;
    let pos = stopIndex[normalizeName(name)];
    if (!pos) {
      let bestSim = 0.8;
      for (const k of keys) {
        const sim = nameSimilarity(k, name);
        if (sim > bestSim) { bestSim = sim; pos = stopIndex[k]; }
      }
    }
    if (pos) coords[i] = pos;
  });
  return { names, segments, coords };
}

/**
 * Rozdělí geometrii spoje v místě vozu. currentIdx = index zastávky, u které vůz je nebo
 * kterou naposledy projel (−1 = neznámý, pak podle polohy vozu).
 * Vrací passedLines / upcomingLines (seznamy čar, mezery bez trasy zůstanou prázdné) a zastávky.
 */
function distanceM(lat1, lon1, lat2, lon2) {
  const kx = 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot((lat1 - lat2) * 110574, (lon1 - lon2) * kx);
}

export function splitTrip(geo, vehicle, currentIdx, trip = []) {
  let cur = currentIdx;
  let cut = null; // { seg, proj }
  const near = (seg) => (seg ? projectOnLine(seg, vehicle.lon, vehicle.lat) : null);
  if (cur >= 0 && cur < geo.segments.length) {
    const p = near(geo.segments[cur]);
    if (p && p.dist < 150) cut = { seg: cur, proj: p };
  } else if (cur < 0) {
    let best = null;
    geo.segments.forEach((seg, i) => {
      const p = near(seg);
      if (p && p.dist < 150 && (!best || p.dist < best.proj.dist)) best = { seg: i, proj: p };
    });
    if (best) {
      cut = best;
      cur = best.seg;
    }
  }
  const passedLines = [];
  const upcomingLines = [];
  const push = (list, line) => {
    if (!line || line.length < 2) return;
    const last = list.at(-1);
    // Navazující kusy spojíme do jedné čáry, ať jsou spoje hladké.
    if (last && last.at(-1)[0] === line[0][0] && last.at(-1)[1] === line[0][1]) last.push(...line.slice(1));
    else list.push([...line]);
  };
  geo.segments.forEach((seg, i) => {
    if (!seg) return;
    if (cut && i === cut.seg) {
      const { proj } = cut;
      push(passedLines, [...seg.slice(0, proj.seg + 1), proj.point]);
      push(upcomingLines, [proj.point, ...seg.slice(proj.seg + 1)]);
    } else if (cur >= 0 && i < cur) push(passedLines, seg);
    else push(upcomingLines, seg);
  });
  // Stojí vůz v zastávce, nebo už jede k další? (DSZO hlásí poslední zastávku, dokud nedorazí k další.)
  const at = cur >= 0 ? geo.coords[cur] : null;
  const atStop = at ? distanceM(at[0], at[1], vehicle.lat, vehicle.lon) < 70 : true;
  const stops = [];
  geo.names.forEach((name, i) => {
    const c = geo.coords[i];
    if (!c) return;
    stops.push({ name, lat: c[0], lon: c[1], passed: cur >= 0 && i <= cur, ...(trip[i]?.time ? { time: trip[i].time } : {}) });
  });
  return { passedLines, upcomingLines, stops, atStop };
}
