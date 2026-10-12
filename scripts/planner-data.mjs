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

const distM = (a, b) => {
  const kx = 111320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * 110574, (a[1] - b[1]) * kx);
};

/**
 * Totéž přímo ze spojů tak, jak jedou (GTFS stop_times), bez skládání do směrů linky.
 * tt.rawTrips = [{ ref, type, mask, times: [min], stops: [[název, lat, lon]] }]
 * Zastávky se slučují podle názvu (všechna nástupiště jsou jedno místo pro přestup),
 * stejný název na místech dál než 400 m od sebe zůstane jako dvě zastávky.
 */
export function buildPlannerFromTrips(tt) {
  const places = []; // { name, pts: [[lat, lon]], key }
  const byName = new Map();
  const ptKeys = new Map(); // nástupiště (název+poloha) -> index místa
  const placeOf = ([name, lat, lon]) => {
    const pk = `${name}|${lat}|${lon}`;
    if (ptKeys.has(pk)) return ptKeys.get(pk);
    const list = byName.get(name) ?? [];
    byName.set(name, list);
    let at = -1;
    if (lat == null) at = list[0] ?? -1;
    else at = list.find((i) => places[i].pts.some((p) => distM(p, [lat, lon]) < 400)) ?? -1;
    if (at < 0) {
      at = places.length;
      places.push({ name, pts: [] });
      list.push(at);
    }
    if (lat != null) places[at].pts.push([lat, lon]);
    ptKeys.set(pk, at);
    return at;
  };

  const masks = [];
  const maskIdx = new Map();
  const patterns = [];
  const patternIdx = new Map();
  const trips = [];
  let skipped = 0;
  for (const t of tt.rawTrips) {
    if (!t.mask.includes('1') || t.stops.length < 2) continue;
    const seq = t.stops.map(placeOf);
    // Časy musí jít popořadě, jinak je spoj v datech poškozený.
    if (t.times.some((x, i) => i && x < t.times[i - 1])) {
      skipped++;
      continue;
    }
    if (!maskIdx.has(t.mask)) {
      maskIdx.set(t.mask, masks.length);
      masks.push(t.mask);
    }
    // Spoj zkrácený na zastávky v oblasti (dálkové linky) nese skutečný cíl.
    const headsign = t.headsign ?? t.stops.at(-1)[0];
    const key = `${t.city ?? ''}|${t.ref}|${headsign}|${t.operator ?? ''}|${seq.join(',')}`;
    if (!patternIdx.has(key)) {
      patternIdx.set(key, patterns.length);
      const pattern = { r: t.ref, y: t.type === 'train' ? 'v' : t.type === 'trolleybus' ? 't' : 'b', h: headsign, s: seq };
      // Vlak: číslo, druh a dopravce.
      // MHD jiného města (Kroměříž, Valašské Meziříčí): stejná čísla linek jako ve Zlíně.
      if (t.city) pattern.c = t.city;
      if (t.type === 'train') Object.assign(pattern, { n: t.number, k: t.code, o: t.operator, ...(t.line ? { l: t.line } : {}) });
      // Autobus mimo IDZK: dopravce, mezinárodní linka.
      else if (t.operator) pattern.o = t.operator;
      if (t.international) pattern.i = 1;
      patterns.push(pattern);
    }
    const entry = [patternIdx.get(key), maskIdx.get(t.mask), t.times[0], ...t.times.slice(1).map((x, i) => x - t.times[i])];
    // Vlaky stojí ve stanicích déle: kolik minut před odjezdem přijíždí (jen když někde stojí).
    const dwell = t.arr?.map((a, i) => Math.max(0, t.times[i] - a));
    if (dwell?.some((d) => d > 0)) entry.dwell = dwell;
    // Číslo spoje (MHD jiných měst: podle něj se pozná spoj vozu z mapy IDZK).
    if (t.number && t.type !== 'train') entry.no = t.number;
    trips.push(entry);
  }
  // Stejné spoje seřadíme podle odjezdu, ať jsou data stabilní.
  trips.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const dwell = {};
  trips.forEach((t, i) => t.dwell && (dwell[i] = t.dwell));
  const tripNo = {};
  trips.forEach((t, i) => t.no && (tripNo[i] = t.no));
  const round = (x) => Math.round(x * 1e5) / 1e5;
  return {
    startDate: tt.startDate,
    days: tt.days,
    stops: places.map((p) => {
      if (!p.pts.length) return [p.name, null, null];
      const lat = p.pts.reduce((a, q) => a + q[0], 0) / p.pts.length;
      const lon = p.pts.reduce((a, q) => a + q[1], 0) / p.pts.length;
      return [p.name, round(lat), round(lon)];
    }),
    masks,
    patterns,
    trips,
    dwell,
    tripNo,
    skipped,
  };
}
