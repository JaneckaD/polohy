// Tratě s osobní dopravou z odpovědi Overpass (cesty z relací route=train) na kompaktní čáry.

/** Zjednodušení čáry (Douglas–Peucker), tolerance v metrech. coords = [[lon, lat]] */
export function simplify(coords, tol = 4) {
  if (coords.length < 3) return coords;
  const kx = 111320 * Math.cos((coords[0][1] * Math.PI) / 180);
  const ky = 110574;
  const P = coords.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = P[a];
    const [bx, by] = P[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let max = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = len ? Math.abs(dy * (P[i][0] - ax) - dx * (P[i][1] - ay)) / len : Math.hypot(P[i][0] - ax, P[i][1] - ay);
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (max > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

const key = ([x, y]) => `${x},${y}`;

/** Spojí cesty, které na sebe navazují (koncový bod sdílí jen dvě cesty), do delších čar. */
export function mergeLines(lines) {
  const ends = new Map();
  const add = (k, i) => ends.set(k, [...(ends.get(k) ?? []), i]);
  lines.forEach((l, i) => {
    add(key(l[0]), i);
    add(key(l.at(-1)), i);
  });
  const used = new Uint8Array(lines.length);
  const next = (k, self) => {
    const at = ends.get(k);
    if (!at || at.length !== 2) return -1; // odbočka nebo konec
    const o = at[0] === self ? at[1] : at[0];
    return used[o] || o === self ? -1 : o;
  };
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let line = lines[i].slice();
    for (const forward of [true, false]) {
      let cur = i; // úsek, který tvoří tento konec čáry
      for (;;) {
        const end = forward ? line.at(-1) : line[0];
        const o = next(key(end), cur);
        if (o < 0) break;
        used[o] = 1;
        cur = o;
        let seg = lines[o];
        if (forward) {
          if (key(seg[0]) !== key(end)) seg = seg.slice().reverse();
          line = line.concat(seg.slice(1));
        } else {
          if (key(seg.at(-1)) !== key(end)) seg = seg.slice().reverse();
          line = seg.slice(0, -1).concat(line);
        }
      }
    }
    out.push(line);
  }
  return out;
}

export function buildRails(overpass) {
  const seen = new Set();
  const lines = [];
  for (const el of overpass.elements ?? []) {
    if (el.type !== 'way' || !el.geometry || seen.has(el.id)) continue;
    seen.add(el.id);
    const line = el.geometry.map((p) => [Math.round(p.lon * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5]);
    if (line.length > 1) lines.push(line);
  }
  const merged = mergeLines(lines).map((l) => simplify(l));
  return { lines: merged, ways: lines.length };
}
