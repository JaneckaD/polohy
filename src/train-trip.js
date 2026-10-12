// Jízdní řád vlaku (všechny zastávky) z dat pro vyhledávání spojení a poloha vlaku mezi nimi.
import { nameSimilarity } from './names.js';
import { trainKind, trainOperator } from './trains.js';

const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const dayIndex = (start, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Zastávky vlaku s daným číslem, jak jede dnes (nebo včera přes půlnoc).
 * Vrací [{ name, lat, lon, time (odjezd), arr (příjezd), dep, arrMin }] nebo null.
 */
export function trainTrip(P, number, date, now) {
  if (!P || !number) return null;
  const di = dayIndex(P.startDate, date);
  let best = null;
  for (const trip of P.trips) {
    const pat = trip.pattern;
    if (pat.y !== 'v' || pat.n !== String(number)) continue;
    for (const shift of [0, 1440]) {
      const d = di - shift / 1440;
      if (d < 0 || d >= P.days || trip.mask[d] !== '1') continue;
      if (shift && trip.times.at(-1) < 1440) continue;
      // Ze dnešních jízd ta, která teď jede (nebo je časově nejblíž).
      const first = trip.arr[0] - shift;
      const last = trip.times.at(-1) - shift;
      const gap = now < first ? first - now : now > last ? now - last : 0;
      if (!best || gap < best.gap) best = { trip, shift, gap };
    }
  }
  if (!best) return null;
  const { trip, shift } = best;
  const stops = trip.pattern.s.map((si, k) => {
    const s = P.stops[si];
    return {
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      time: hhmm(trip.times[k] - shift),
      arr: hhmm(trip.arr[k] - shift),
      depMin: trip.times[k] - shift,
      arrMin: trip.arr[k] - shift,
    };
  });
  stops.line = trip.pattern.l ?? null; // linka, např. S11 nebo R18 Slovácký expres
  stops.equip = P.equip?.[String(number)] ?? null; // kódy výbavy z jízdního řádu SŽ
  return stops;
}

/**
 * Kde vlak je: index poslední zastávky, kterou projel (nebo kde stojí), a jestli v ní stojí.
 * Poslední projetý bod z dat může být i stanice bez zastavení nebo výhybna, proto podle názvu,
 * a když nesedí, podle jízdního řádu a zpoždění.
 */
export function trainPosition(trip, v, now) {
  if (!trip?.length) return { current: -1, atStop: true };
  const delay = Math.max(0, Math.round((v.delay ?? 0) / 60));
  const moving = v.bearing != null;
  let current = -1;
  let bestSim = 0.74;
  trip.forEach((s, i) => {
    const sim = nameSimilarity(s.name, v.stop ?? '');
    if (sim > bestSim) {
      bestSim = sim;
      current = i;
    }
  });
  if (current >= 0) {
    // Plánovaný čas v posledním bodě: ze stejného jména by mohla být i jiná stanice.
    const planned = toMinutes(v.stopPlanned);
    const s = trip[current];
    if (planned != null && Math.abs(planned - s.depMin) > 30 && Math.abs(planned - s.arrMin) > 30) current = -1;
  }
  if (current < 0) {
    // Podle času: poslední zastávka, ze které už měl odjet.
    const t = now - delay;
    for (let i = 0; i < trip.length; i++) if (trip[i].depMin <= t) current = i;
    if (current < 0) return { current: 0, atStop: true };
    return { current, atStop: !moving || current === trip.length - 1 };
  }
  return { current, atStop: !moving || current === trip.length - 1 };
}

const RAD = Math.PI / 180;
const metres = (lat1, lon1, lat2, lon2) => Math.hypot((lat2 - lat1) * 111320, (lon2 - lon1) * 111320 * Math.cos(lat1 * RAD));

/** Kde má jízda vlaku být v čase t (minuty) podle jízdního řádu: { lat, lon } nebo null. */
function plannedPosition(P, trip, t) {
  const s = trip.pattern.s;
  if (t < trip.arr[0] || t > trip.times.at(-1)) return null;
  for (let k = 0; k < s.length; k++) {
    const a = P.stops[s[k]];
    if (t <= trip.times[k]) return t >= trip.arr[k] && a.lat != null ? { lat: a.lat, lon: a.lon } : null;
    const b = P.stops[s[k + 1]];
    if (b && t < trip.arr[k + 1]) {
      if (a.lat == null || b.lat == null) return null;
      const f = (t - trip.times[k]) / Math.max(trip.arr[k + 1] - trip.times[k], 0.5);
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
  }
  return null;
}

// Jízdy vlaků podle linky (S3, R12…), spočítané jednou pro data vyhledávání.
const byLine = new WeakMap();
function trainsOfLine(P, line) {
  if (!byLine.has(P)) {
    const index = new Map();
    for (const trip of P.trips) {
      if (trip.pattern.y !== 'v' || !trip.pattern.l) continue;
      const key = trip.pattern.l.split(' ')[0];
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(trip);
    }
    byLine.set(P, index);
  }
  return byLine.get(P).get(line) ?? [];
}

/**
 * Vlak z mapy IDS JMK (jen linka, cíl, zpoždění a poloha) → číslo, druh a dopravce z jízdního řádu:
 * ze dnešních jízd stejné linky ta, která má podle jízdního řádu (se zpožděním) být nejblíž polohy vlaku.
 * Vrátí vůz doplněný o číslo, nebo ten samý, když se jízda nenajde.
 */
export function identifyTrain(P, v, date, now) {
  if (!P || !v.lineName) return v;
  const di = dayIndex(P.startDate, date);
  const t0 = now - Math.max(0, Math.round((v.delay ?? 0) / 60));
  let best = null;
  for (const trip of trainsOfLine(P, v.lineName)) {
    const pat = trip.pattern;
    for (const shift of [0, 1440]) {
      const d = di - shift / 1440;
      if (d < 0 || d >= P.days || trip.mask[d] !== '1') continue;
      const pos = plannedPosition(P, trip, t0 + shift);
      if (!pos) continue;
      let dist = metres(v.lat, v.lon, pos.lat, pos.lon);
      // Cíl jízdy podle mapy IDS JMK („Hlavní nádraží“) jen pomáhá rozhodnout mezi protisměry.
      if (v.headsign && nameSimilarity(P.stops[pat.s.at(-1)].name, v.headsign) < 0.5) dist += 1500;
      if (!best || dist < best.dist) best = { trip, dist };
    }
  }
  if (!best || best.dist > 5000) return v;
  const pat = best.trip.pattern;
  const code = pat.k || v.code;
  return {
    ...v,
    id: `vlak-${code}-${pat.n}`,
    line: `${code} ${pat.n}`,
    code,
    number: String(pat.n),
    kind: trainKind(code),
    operator: pat.o ? trainOperator(pat.o) : v.operator,
    from: P.stops[pat.s[0]].name,
    headsign: P.stops[pat.s.at(-1)].name,
  };
}

/**
 * Vlaky z mapy IDS JMK doplní podle jízdního řádu a vyřadí ty, které už máme z jiného zdroje
 * (stejné číslo, nebo stejná linka do 400 m od vlaku z mapy IDZK na hranici krajů).
 */
export function completeTrains(P, list, date, now) {
  const others = list.filter((v) => v.source !== 'jmk');
  const numbers = new Set(others.map((v) => v.number).filter(Boolean));
  const out = [...others];
  for (const v of list) {
    if (v.source !== 'jmk') continue;
    const w = identifyTrain(P, v, date, now);
    if (w.number && numbers.has(w.number)) continue;
    if (!w.number && others.some((o) => metres(o.lat, o.lon, w.lat, w.lon) < 400)) continue;
    if (w.number) numbers.add(w.number);
    out.push(w);
  }
  return out;
}
