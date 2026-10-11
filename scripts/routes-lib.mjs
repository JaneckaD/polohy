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
 * (stop_position, jinak nástupiště) se stejným názvem do 120 m. Zastávka je na mapě jeden bod pro
 * oba směry: když má v OSM protější nástupiště (stejný název, do 40 m), dáme ji doprostřed mezi ně,
 * tedy zhruba na osu silnice. Stranu silnice neřešíme, trasa kolem zastávky jen projede.
 * Vrací funkci (název, lat, lon) → [lat, lon].
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
  const stats = { checked: 0, moved: 0, sum: 0, paired: 0 };
  const correct = (name, lat, lon) => {
    if (lat == null) return [lat, lon];
    const key = `${name}|${lat}|${lon}`;
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
    let best = null;
    for (const x of near) {
      // Místo zastavení na silnici má přednost (sedí na trase), pak to bližší.
      const score = x.d + (x.p[3] === 's' ? 0 : 25);
      if (!best || score < best.score) best = { score, d: x.d, p: x.p };
    }
    stats.checked++;
    let out = [lat, lon];
    if (best) {
      // Protější zastávka stejného druhu (místo zastavení k místu zastavení) přes silnici.
      let pair = null;
      for (const x of near) {
        if (x.p === best.p || x.p[3] !== best.p[3]) continue;
        const d = metres(best.p[1], best.p[2], x.p[1], x.p[2]);
        if (d >= 6 && d <= 40 && (!pair || d < pair.d)) pair = { d, p: x.p };
      }
      if (pair) {
        out = [Math.round(((best.p[1] + pair.p[1]) / 2) * 1e6) / 1e6, Math.round(((best.p[2] + pair.p[2]) / 2) * 1e6) / 1e6];
        stats.paired++;
      } else if (best.d > 8) out = [best.p[1], best.p[2]];
      if (out[0] !== lat || out[1] !== lon) {
        stats.moved++;
        stats.sum += metres(lat, lon, out[0], out[1]);
      }
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

/**
 * Odstraní z trasy objížďky, kterými se vůz jen otáčí: trasa odbočí, vrátí se po stejné silnici
 * (do 20 m) a cestou neobslouží žádnou zastávku. Takové kličky vznikají, když se zastávka chytí
 * na špatnou stranu silnice. Smyčky se zastávkami a zajížďky na zastávku zůstanou.
 * line = [[lon, lat]], stops = [[název, lat, lon]].
 */
export function removeDetours(line = [], stops = [], maxLen = 1500) {
  let cur = line;
  for (let round = 0; round < 50; round++) {
    const cut = findDetour(cur, stops, maxLen);
    if (!cut) return cur;
    cur = [...cur.slice(0, cut.i + 1), cut.point, ...cur.slice(cut.j)];
  }
  return cur;
}

function findDetour(line, stops, maxLen) {
  if (line.length < 3) return null;
  const kx = 111320 * Math.cos((line[0][1] * Math.PI) / 180);
  const xy = line.map(([lon, lat]) => [lon * kx, lat * 110574]);
  const sxy = stops.filter((s) => s[1] != null).map((s) => [s[2] * kx, s[1] * 110574]);
  const along = [0];
  for (let i = 1; i < xy.length; i++) along.push(along[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const proj = (p, i) => {
    const [a, b] = [xy[i], xy[i + 1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    return { d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), at: along[i] + t * Math.sqrt(len2), t };
  };
  for (let j = 2; j < xy.length; j++) {
    for (let i = 0; i + 1 < j; i++) {
      const p = proj(xy[j], i);
      const len = along[j] - p.at;
      if (p.d >= 20 || len < 60 || len > maxLen) continue;
      // Obsluhuje klička zastávku? Zastávku u místa, kde se trasa vrací, nepočítáme.
      const serves = sxy.some((s) => {
        if (Math.hypot(s[0] - xy[j][0], s[1] - xy[j][1]) <= 30) return false;
        for (let k = i + 1; k < j; k++) if (proj(s, k).d < 25) return true;
        return false;
      });
      if (serves) continue;
      const [a, b] = [line[i], line[i + 1]];
      return { i, j, point: [a[0] + (b[0] - a[0]) * p.t, a[1] + (b[1] - a[1]) * p.t] };
    }
  }
  return null;
}
