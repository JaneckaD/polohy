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
