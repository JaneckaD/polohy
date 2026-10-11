// Trasa vlaku po kolejích (public/rails.json) mezi dvěma stanicemi: nejkratší cesta po síti tratí.
// Čáry v rails.json jsou zjednodušené, takže kříženi a odbočky nemusí mít společný bod:
// konce čar proto napojíme na nejbližší místo jiné čáry (do 30 m).

const KY = 110574;
const kxAt = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const CELL = 0.01; // mřížka pro hledání blízkých úseků (asi 1 km)
const DEAD_END_M = 300; // slepý konec trati se napojí na jinou kolej nejvýš takhle daleko
const BRIDGE_M = 1000; // nejdelší spojka mezi nesouvisejícími kusy tratí (kolejiště velkých stanic v datech chybí)

function project(p, a, b) {
  const kx = kxAt(p[1]);
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * KY;
  const bx = (b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * KY;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { t, dist: Math.hypot(x, y), point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
}

const metres = (a, b) => Math.hypot((a[0] - b[0]) * kxAt(a[1]), (a[1] - b[1]) * KY);

export class RailNetwork {
  constructor(lines) {
    this.pts = []; // [lon, lat]
    this.adj = []; // [[soused, metry]]
    this.segs = []; // [i, j] úseky mezi body
    const ids = new Map();
    const node = (c) => {
      const key = `${c[0]},${c[1]}`;
      if (!ids.has(key)) {
        ids.set(key, this.pts.length);
        this.pts.push(c);
        this.adj.push([]);
      }
      return ids.get(key);
    };
    const ends = [];
    for (const line of lines ?? []) {
      if (line.length < 2) continue;
      let prev = node(line[0]);
      ends.push(prev);
      for (let k = 1; k < line.length; k++) {
        const cur = node(line[k]);
        if (cur !== prev) this.link(prev, cur);
        prev = cur;
      }
      ends.push(prev);
    }
    this.grid = new Map();
    this.segs.forEach((s, i) => this.index(i));
    // Konce čar napojíme na nejbližší úsek jiné čáry.
    for (const e of ends) {
      if (this.adj[e].length > 1) continue;
      const hit = this.nearest(this.pts[e], 30, e);
      if (hit) this.link(e, this.split(hit));
    }
    // Slepé konce (ve velkých stanicích chybí kolejiště a odbočka končí kus od hlavní trati):
    // napojíme je na nejbližší kolej do 300 m, na kterou se po kolejích nedá dostat zblízka.
    for (const e of ends) {
      if (this.adj[e].length !== 1) continue;
      const near = this.within(e, 1500);
      const hit = this.nearest(this.pts[e], DEAD_END_M, -1, ([a, b]) => !near.has(a) && !near.has(b));
      if (hit) this.link(e, this.split(hit));
    }
    this.bridge(BRIDGE_M);
  }

  /**
   * Kusy sítě, které spolu nesouvisí (v odbočce ve stanici zjednodušení čar ztratilo spojení),
   * propojí v místě, kde jsou si nejblíž, když je to do maxDist metrů.
   */
  bridge(maxDist) {
    const comp = new Array(this.pts.length).fill(-1);
    let count = 0;
    for (let s = 0; s < this.pts.length; s++) {
      if (comp[s] >= 0) continue;
      comp[s] = count;
      const stack = [s];
      while (stack.length) for (const [v] of this.adj[stack.pop()]) if (comp[v] < 0) (comp[v] = count), stack.push(v);
      count++;
    }
    if (count < 2) return;
    // Nejbližší místo (bod jednoho kusu k úseku druhého) pro každou dvojici kusů.
    const best = new Map();
    const r = Math.max(1, Math.ceil(maxDist / 700));
    this.pts.forEach((p, i) => {
      const cx = Math.floor(p[0] / CELL);
      const cy = Math.floor(p[1] / CELL);
      for (let x = cx - r; x <= cx + r; x++)
        for (let y = cy - r; y <= cy + r; y++)
          for (const si of this.grid.get(`${x},${y}`) ?? []) {
            const [a, b] = this.segs[si];
            if (comp[a] === comp[i]) continue;
            const pr = project(p, this.pts[a], this.pts[b]);
            const key = comp[i] < comp[a] ? `${comp[i]},${comp[a]}` : `${comp[a]},${comp[i]}`;
            if (pr.dist <= maxDist && pr.dist < (best.get(key)?.dist ?? Infinity)) best.set(key, { ...pr, seg: si, i });
          }
    });
    // Nejkratší spojky první, každá jen když kusy ještě nejsou propojené.
    const parent = [...Array(count).keys()];
    const root = (a) => (parent[a] === a ? a : (parent[a] = root(parent[a])));
    for (const hit of [...best.values()].sort((a, b) => a.dist - b.dist)) {
      const [a, b] = [root(comp[hit.i]), root(comp[this.segs[hit.seg][0]])];
      if (a === b) continue;
      parent[a] = b;
      const j = this.split(hit);
      this.link(hit.i, j);
      this.index(this.segs.length - 1);
    }
  }

  link(a, b) {
    const m = metres(this.pts[a], this.pts[b]);
    this.adj[a].push([b, m]);
    this.adj[b].push([a, m]);
    this.segs.push([a, b]);
  }

  index(i) {
    const [a, b] = this.segs[i];
    const pa = this.pts[a];
    const pb = this.pts[b];
    for (let x = Math.floor(Math.min(pa[0], pb[0]) / CELL); x <= Math.floor(Math.max(pa[0], pb[0]) / CELL); x++)
      for (let y = Math.floor(Math.min(pa[1], pb[1]) / CELL); y <= Math.floor(Math.max(pa[1], pb[1]) / CELL); y++) {
        const key = `${x},${y}`;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(i);
      }
  }

  /** Body dosažitelné po kolejích z bodu start do maxDist metrů. */
  within(start, maxDist) {
    const dist = new Map([[start, 0]]);
    const heap = [[0, start]];
    while (heap.length) {
      const [du, u] = pop(heap);
      if (du > (dist.get(u) ?? Infinity)) continue;
      for (const [v, w] of this.adj[u]) {
        const dv = du + w;
        if (dv <= maxDist && dv < (dist.get(v) ?? Infinity)) {
          dist.set(v, dv);
          push(heap, [dv, v]);
        }
      }
    }
    return dist;
  }

  /** Nejbližší úsek k bodu (do maxDist metrů); skip = bod, jehož úseky nepočítáme, accept = který úsek smí být. */
  nearest(p, maxDist, skip = -1, accept = null) {
    const cx = Math.floor(p[0] / CELL);
    const cy = Math.floor(p[1] / CELL);
    let best = null;
    const r = Math.max(1, Math.ceil(maxDist / 700));
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (const i of this.grid.get(`${x},${y}`) ?? []) {
          const [a, b] = this.segs[i];
          if (a === skip || b === skip || (accept && !accept(this.segs[i]))) continue;
          const pr = project(p, this.pts[a], this.pts[b]);
          if (pr.dist <= maxDist && (!best || pr.dist < best.dist)) best = { ...pr, seg: i };
        }
    return best;
  }

  /** Vloží bod do úseku (nebo vrátí jeho konec, když je blízko) a vrátí index bodu. */
  split(hit) {
    const [a, b] = this.segs[hit.seg];
    if (hit.t < 0.02 || metres(hit.point, this.pts[a]) < 3) return a;
    if (hit.t > 0.98 || metres(hit.point, this.pts[b]) < 3) return b;
    const n = this.pts.length;
    this.pts.push(hit.point);
    this.adj.push([]);
    // Původní úsek a–b nahradíme úseky a–n a n–b.
    this.adj[a] = this.adj[a].filter(([x]) => x !== b);
    this.adj[b] = this.adj[b].filter(([x]) => x !== a);
    this.segs[hit.seg] = [a, n];
    const ma = metres(this.pts[a], hit.point);
    const mb = metres(hit.point, this.pts[b]);
    this.adj[a].push([n, ma]);
    this.adj[n].push([a, ma], [b, mb]);
    this.adj[b].push([n, mb]);
    this.segs.push([n, b]);
    this.index(this.segs.length - 1);
    return n;
  }

  /** Bod sítě u stanice (do 400 m od koleje), nebo -1. */
  snap(lat, lon) {
    const hit = this.nearest([lon, lat], 400);
    return hit ? this.split(hit) : -1;
  }

  /** Cesta po kolejích mezi dvěma stanicemi jako [[lon, lat]…], nebo null. */
  path(from, to) {
    const a = this.snap(from[0], from[1]);
    const b = this.snap(to[0], to[1]);
    if (a < 0 || b < 0) return null;
    if (a === b) return null;
    const limit = metres(this.pts[a], this.pts[b]) * 3 + 2000; // objížďky přes celý kraj ne
    const dist = new Map([[a, 0]]);
    const prev = new Map();
    const heap = [[0, a]];
    const goal = this.pts[b];
    const h = (i) => metres(this.pts[i], goal);
    while (heap.length) {
      const [, u] = pop(heap);
      if (u === b) break;
      const du = dist.get(u);
      if (du > limit) return null;
      for (const [v, w] of this.adj[u]) {
        const dv = du + w;
        if (dv < (dist.get(v) ?? Infinity)) {
          dist.set(v, dv);
          prev.set(v, u);
          push(heap, [dv + h(v), v]);
        }
      }
    }
    if (!dist.has(b)) return null;
    const out = [];
    for (let u = b; u !== undefined; u = prev.get(u)) out.push(this.pts[u]);
    return out.reverse();
  }
}

function push(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p][0] <= heap[i][0]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}

function pop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
      if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
}

/** Geometrie vlaku ve tvaru jako tripGeometry: { names, segments, coords: [lat, lon] }. */
export function railGeometry(net, stops) {
  const coords = stops.map((s) => (s.lat != null ? [s.lat, s.lon] : null));
  const segments = [];
  for (let i = 0; i < stops.length - 1; i++) {
    segments.push(coords[i] && coords[i + 1] && net ? net.path(coords[i], coords[i + 1]) : null);
  }
  return { names: stops.map((s) => s.name), segments, coords };
}
