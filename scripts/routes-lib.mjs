// Zpracování odpovědi Overpass API na kompaktní trasy linek MHD.
import { normalizeName, nameSimilarity } from '../src/names.js';

const STOP_ROLE = /^(stop|platform)(_entry_only|_exit_only)?$/;
const WAY_ROLE = /^(|forward|backward)$/;

function round(n) {
  return Math.round(n * 1e5) / 1e5;
}

// Douglas–Peucker, tolerance ve stupních (~0.00004° ≈ 3–4 m).
function simplify(points, tolerance = 0.00004) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-18;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function isDszoRoute(tags) {
  if (!/^\d{1,2}$/.test(tags.ref ?? '')) return false;
  const op = `${tags.operator ?? ''} ${tags.network ?? ''}`;
  if (/DSZO|Dopravní společnost Zlín|MHD Zlín|Zlín/i.test(op)) return true;
  return !tags.operator;
}

export function buildRoutes(overpass) {
  const nodes = new Map();
  const ways = new Map();
  const relations = [];
  for (const el of overpass.elements ?? []) {
    if (el.type === 'node') nodes.set(el.id, el);
    else if (el.type === 'way') ways.set(el.id, el);
    else if (el.type === 'relation') relations.push(el);
  }

  // Body cesty: z „out geom“ přímo u člena relace, jinak přes samostatné prvky way a node.
  const wayPoints = (m) => {
    if (Array.isArray(m.geometry)) return m.geometry.filter(Boolean).map((g) => [g.lon, g.lat]);
    const w = ways.get(m.ref);
    return (w?.nodes ?? []).map((id) => nodes.get(id)).filter(Boolean).map((n) => [n.lon, n.lat]);
  };

  const pointOf = (m) => {
    if (m.type === 'node') {
      const n = nodes.get(m.ref);
      return n ? [n.lat, n.lon, n.tags?.name] : null;
    }
    if (m.type === 'way') {
      const pts = wayPoints(m);
      if (!pts.length) return null;
      const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      return [lat, lon, ways.get(m.ref)?.tags?.name];
    }
    return null;
  };

  const routes = [];
  for (const rel of relations) {
    const tags = rel.tags ?? {};
    if (!isDszoRoute(tags)) continue;

    // Zastávky v pořadí; dvojice stop + platform se stejným názvem sloučíme.
    const stops = [];
    for (const m of rel.members ?? []) {
      if (!STOP_ROLE.test(m.role)) continue;
      const p = pointOf(m);
      if (!p || !p[2]) continue;
      const last = stops[stops.length - 1];
      if (last && normalizeName(last[0]) === normalizeName(p[2])) {
        // Pro polohu dáváme přednost stop_position (na silnici) před nástupištěm.
        if (m.role.startsWith('stop')) { last[1] = round(p[0]); last[2] = round(p[1]); }
        continue;
      }
      stops.push([p[2], round(p[0]), round(p[1])]);
    }

    // Geometrie: cesty v pořadí, otočené tak, aby navazovaly.
    let line = [];
    let wayCount = 0;
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    for (const m of rel.members ?? []) {
      if (m.type !== 'way' || !WAY_ROLE.test(m.role)) continue;
      const w = ways.get(m.ref);
      if (w?.tags?.public_transport === 'platform' || w?.tags?.highway === 'platform') continue;
      let pts = wayPoints(m);
      if (pts.length < 2) continue;
      wayCount++;
      if (wayCount === 1) {
        line = pts;
        continue;
      }
      // První cesta mohla být v relaci obráceně: poznáme to až podle druhé.
      if (wayCount === 2 && !same(pts[0], line.at(-1)) && !same(pts.at(-1), line.at(-1))) {
        if (same(pts[0], line[0]) || same(pts.at(-1), line[0])) line.reverse();
      }
      if (same(pts.at(-1), line.at(-1))) pts = pts.reverse();
      line = line.concat(same(pts[0], line.at(-1)) ? pts.slice(1) : pts);
    }

    if (stops.length < 2) continue;
    routes.push({
      ref: tags.ref,
      type: tags.route,
      from: tags.from ?? stops[0][0],
      to: tags.to ?? stops[stops.length - 1][0],
      stops,
      line: simplify(line).map(([x, y]) => [round(x), round(y)]),
    });
  }

  // Slovník všech pojmenovaných zastávek pro případ, že trasa linky v OSM chybí.
  const sums = new Map();
  // Všechna místa zastavení a nástupiště (na opravu poloh zastávek z jízdních řádů).
  const platforms = [];
  for (const n of nodes.values()) {
    const t = n.tags;
    if (!t?.name) continue;
    if (!(t.public_transport === 'platform' || t.public_transport === 'stop_position' || t.highway === 'bus_stop')) continue;
    platforms.push([t.name, round(n.lat), round(n.lon), t.public_transport === 'stop_position' ? 's' : 'p']);
    const key = normalizeName(t.name);
    const s = sums.get(key) ?? [0, 0, 0];
    s[0] += n.lat; s[1] += n.lon; s[2]++;
    sums.set(key, s);
  }
  const stops = {};
  for (const [key, [lat, lon, c]] of sums) stops[key] = [round(lat / c), round(lon / c)];

  return { routes, stops, platforms };
}

const metres = (lat1, lon1, lat2, lon2) => Math.hypot((lat1 - lat2) * 110574, (lon1 - lon2) * 111320 * Math.cos((lat1 * Math.PI) / 180));
const plainName = (n) => String(n).replace(/^Zlín,\s*/, '');

/**
 * Opravuje polohy zastávek z jízdních řádů podle OpenStreetMap: nejbližší místo zastavení
 * (stop_position, jinak nástupiště) se stejným názvem do 120 m. Jízdní řády mají jednu polohu
 * pro oba směry; když jsou v OSM nástupiště na obou stranách silnice, vybere podle polohy
 * předchozí a další zastávky to vpravo ve směru jízdy (jinak by trasa vedla do protisměru
 * a vůz by se tam musel otáčet).
 * Vrací funkci (název, lat, lon, předchozí [lat, lon]?, další [lat, lon]?) → [lat, lon].
 */
export function stopCorrector(platforms = []) {
  const cells = new Map();
  const cell = (lat, lon) => `${Math.round(lat * 200)},${Math.round(lon * 130)}`; // ~550 m
  for (const p of platforms) {
    const k = cell(p[1], p[2]);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(p);
  }
  const cache = new Map();
  const stats = { checked: 0, moved: 0, sum: 0, sided: 0 };
  const correct = (name, lat, lon, prev = null, next = null) => {
    if (lat == null) return [lat, lon];
    const a = prev?.[0] != null ? prev : [lat, lon];
    const b = next?.[0] != null ? next : [lat, lon];
    const key = `${name}|${lat}|${lon}|${a}|${b}`;
    if (cache.has(key)) return cache.get(key);
    const [ci, cj] = cell(lat, lon).split(',').map(Number);
    const near = [];
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const p of cells.get(`${ci + di},${cj + dj}`) ?? []) {
          const d = metres(lat, lon, p[1], p[2]);
          if (d <= 120 && nameSimilarity(plainName(p[0]), plainName(name)) >= 0.75) near.push({ p, d });
        }
      }
    }
    // Strana silnice: vzdálenost nástupiště vlevo od směru jízdy (v metrech) vůči středu všech nástupišť.
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    const dx = (b[1] - a[1]) * kx;
    const dy = (b[0] - a[0]) * 110574;
    const len = Math.hypot(dx, dy);
    let sided = false;
    if (near.length > 1 && len > 30) {
      const cLat = near.reduce((s, x) => s + x.p[1], 0) / near.length;
      const cLon = near.reduce((s, x) => s + x.p[2], 0) / near.length;
      for (const x of near) {
        const ox = (x.p[2] - cLon) * kx;
        const oy = (x.p[1] - cLat) * 110574;
        x.left = (dx * oy - dy * ox) / len;
      }
      sided = near.some((x) => x.left > 3) && near.some((x) => x.left < -3);
    }
    let best = null;
    for (const x of near) {
      // Místo zastavení na silnici má přednost (sedí na trase), pak to bližší; v protisměru ne.
      const score = x.d + (x.p[3] === 's' ? 0 : 25) + (sided && x.left > 3 ? 200 : 0);
      if (!best || score < best.score) best = { score, d: x.d, p: x.p };
    }
    stats.checked++;
    if (sided) stats.sided++;
    let out = [lat, lon];
    if (best && (best.d > 8 || sided)) {
      out = [best.p[1], best.p[2]];
      stats.moved++;
      stats.sum += best.d;
    }
    cache.set(key, out);
    return out;
  };
  correct.stats = stats;
  return correct;
}

/**
 * Místa, kde se trasa vrací po stejné silnici zpátky (otočka do protisměru): bod trasy leží do 20 m
 * od části trasy projeté o víc než 150 m dřív. Kruhové objezdy a serpentiny se tak nepočítají.
 * Vrací [[lon, lat]] (jedno místo za každý návrat).
 */
export function uTurns(line = []) {
  const out = [];
  if (line.length < 3) return out;
  const kx = 111320 * Math.cos((line[0][1] * Math.PI) / 180);
  const xy = line.map(([lon, lat]) => [lon * kx, lat * 110574]);
  const along = [0];
  for (let i = 1; i < xy.length; i++) along.push(along[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  // Vzdálenost bodu od úseku a kolik metrů trasy je k nejbližšímu místu úseku.
  const project = (p, i) => {
    const [a, b] = [xy[i], xy[i + 1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    return { d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), at: along[i] + t * Math.sqrt(len2) };
  };
  let skipUntil = -1;
  for (let j = 2; j < xy.length; j++) {
    if (along[j] < skipUntil) continue;
    for (let i = 0; i + 1 < j && along[i] < along[j] - 150; i++) {
      const p = project(xy[j], i);
      if (p.d < 20 && p.at < along[j] - 150) {
        out.push(line[j]);
        skipUntil = along[j] + 300;
        break;
      }
    }
  }
  return out;
}

/** Zjednodušená a zaokrouhlená lomená čára [[lon, lat]]. */
export function simplifyLine(line) {
  return simplify(line).map(([x, y]) => [round(x), round(y)]);
}

/**
 * Polohy zastávek podle názvu ze slovníku OSM: [[název, lat, lon]], u nenalezených lat/lon null.
 * Názvy z jízdních řádů („Otrokovice,žel.st.“) se s OSM liší, proto i přibližná shoda.
 */
export function locateStops(names, dictionary) {
  const keys = Object.keys(dictionary);
  return names.map((name) => {
    let pos = dictionary[normalizeName(name)];
    if (!pos) {
      let best = 0.75;
      for (const k of keys) {
        const sim = nameSimilarity(k, name);
        if (sim > best) { best = sim; pos = dictionary[k]; }
      }
    }
    return pos ? [name, pos[0], pos[1]] : [name, null, null];
  });
}
