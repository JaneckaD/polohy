// Písmena u spojů DSZO (8d = končí v zast. Baťova nem., 38g = jede na Otrokovice, prům. areál):
// z papírových jízdních řádů (viz scripts/dszo-notes.mjs) jsou u spojů v datech vyhledávání.
// Vůz na mapě k spoji přiřadíme podle linky, cíle, aktuální zastávky a času (se zpožděním).
import { nameSimilarity, stripPlatform } from './names.js';

const dayIndex = (start, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);

/** Písmeno spoje, kterým vůz DSZO jede, a jeho vysvětlení: { mark, note } nebo null. */
export function vehicleMark(P, v, date, now) {
  const notes = P?.notes?.[v.line];
  if (!notes || v.city || v.type === 'train' || !v.stop) return null;
  const di = dayIndex(P.startDate, date);
  if (di < 0 || di >= P.days) return null;
  const delay = Math.max(0, Math.round((v.delay ?? 0) / 60));
  const stop = stripPlatform(v.stop);
  let best = null;
  for (const trip of P.trips) {
    const pat = trip.pattern;
    if (pat.r !== v.line || pat.c || pat.y === 'v' || trip.mask[di] !== '1') continue;
    if (v.headsign && nameSimilarity(v.headsign, pat.h) < 0.5 && nameSimilarity(v.headsign, P.stops[pat.s.at(-1)].name) < 0.5) continue;
    pat.s.forEach((si, k) => {
      const diff = now - (trip.times[k] + delay);
      if (diff < -3 || diff > 6 || nameSimilarity(stop, P.stops[si].name) < 0.75) return;
      const score = Math.abs(diff - 1);
      if (!best || score < best.score) best = { score, trip };
    });
  }
  const mark = best?.trip.mark;
  return mark && notes[mark] ? { mark, note: notes[mark] } : null;
}
