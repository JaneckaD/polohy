// Jízdní řád vlaku (všechny zastávky) z dat pro vyhledávání spojení a poloha vlaku mezi nimi.
import { nameSimilarity } from './names.js';

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
