// Kompaktní data pro vyhledávání spojení v prohlížeči (public/tt/planner.json).
//
// {
//   startDate, days,
//   stops:    [[název, lat, lon]],              zastávky sloučené podle názvu (všechna nástupiště)
//   masks:    ['0110…'],                        dny provozu od startDate (1 = jede)
//   patterns: [{ r: linka, y: 't'|'b', h: cíl, s: [index zastávky…] }],
//   trips:    [[pattern, maska, čas první zastávky, rozdíl k další, …]]   časy v minutách od půlnoci
// }

export function buildPlannerData(tt) {
  const stopIndex = new Map();
  const acc = []; // [name, sumLat, sumLon, n]
  const idx = (name) => {
    if (!stopIndex.has(name)) {
      stopIndex.set(name, acc.length);
      acc.push([name, 0, 0, 0]);
    }
    return stopIndex.get(name);
  };
  // Polohy zastávek: průměr ze všech nástupišť (variant tras), kde je známe.
  for (const line of tt.lines) {
    for (const d of line.directions) {
      for (const v of d.variants) {
        v.stops.forEach((name, i) => {
          const c = v.coords?.[i];
          const a = acc[idx(name)];
          if (c && Number.isFinite(c[0])) {
            a[1] += c[0];
            a[2] += c[1];
            a[3]++;
          }
        });
      }
    }
  }

  const masks = [];
  const maskIdx = new Map();
  const patterns = [];
  const patternIdx = new Map();
  const trips = [];
  for (const line of tt.lines) {
    for (const d of line.directions) {
      for (const trip of d.trips) {
        const seq = [];
        const times = [];
        trip.t.forEach((t, i) => {
          if (t == null) return;
          seq.push(idx(d.stops[i]));
          times.push(t);
        });
        if (seq.length < 2) continue;
        const mask = d.masks[trip.d];
        if (!mask?.includes('1')) continue;
        if (!maskIdx.has(mask)) {
          maskIdx.set(mask, masks.length);
          masks.push(mask);
        }
        const headsign = d.stops[trip.t.findLastIndex((t) => t != null)];
        const key = `${line.ref}|${headsign}|${seq.join(',')}`;
        if (!patternIdx.has(key)) {
          patternIdx.set(key, patterns.length);
          patterns.push({ r: line.ref, y: line.type === 'trolleybus' ? 't' : 'b', h: headsign, s: seq });
        }
        trips.push([patternIdx.get(key), maskIdx.get(mask), times[0], ...times.slice(1).map((t, i) => t - times[i])]);
      }
    }
  }

  const round = (x) => Math.round(x * 1e5) / 1e5;
  return {
    startDate: tt.startDate,
    days: tt.days,
    stops: acc.map(([name, la, lo, n]) => (n ? [name, round(la / n), round(lo / n)] : [name, null, null])),
    masks,
    patterns,
    trips,
  };
}
