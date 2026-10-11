// Zpracování odpovědi Overpass API na kompaktní trasy linek MHD.
import { normalizeName } from '../src/names.js';

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

  const pointOf = (m) => {
    if (m.type === 'node') {
      const n = nodes.get(m.ref);
      return n ? [n.lat, n.lon, n.tags?.name] : null;
    }
    if (m.type === 'way') {
      const w = ways.get(m.ref);
      const pts = (w?.nodes ?? []).map((id) => nodes.get(id)).filter(Boolean);
      if (!pts.length) return null;
      const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
      return [lat, lon, w.tags?.name];
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
      if (!w || w.tags?.public_transport === 'platform' || w.tags?.highway === 'platform') continue;
      let pts = (w.nodes ?? []).map((id) => nodes.get(id)).filter(Boolean).map((n) => [n.lon, n.lat]);
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
  for (const n of nodes.values()) {
    const t = n.tags;
    if (!t?.name) continue;
    if (!(t.public_transport === 'platform' || t.public_transport === 'stop_position' || t.highway === 'bus_stop')) continue;
    const key = normalizeName(t.name);
    const s = sums.get(key) ?? [0, 0, 0];
    s[0] += n.lat; s[1] += n.lon; s[2]++;
    sums.set(key, s);
  }
  const stops = {};
  for (const [key, [lat, lon, c]] of sums) stops[key] = [round(lat / c), round(lon / c)];

  return { routes, stops };
}
