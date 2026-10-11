// Které vozy na mapě jsou ty, kterými pojedu: pro každou jízdu spojení najdeme vůz stejné linky
// a směru, který je podle své poslední zastávky a zpoždění právě tam, kde má spoj podle jízdního řádu být.
import { nameSimilarity, stripPlatform } from './names.js';

/** Vrací pro každou jízdu spojení číslo vozu, nebo null (vůz ještě nevyjel / nejde poznat). */
export function matchJourneyVehicles(journey, P, vehicles, now) {
  const used = new Set();
  return journey.legs
    .filter((l) => l.type === 'ride' && !l.stay)
    .map((leg) => {
      const pat = leg.trip.pattern;
      // Navazující pokračování stejné linky jede stejným vozem až do konce.
      let best = null;
      for (const v of vehicles) {
        if (used.has(v.id) || String(v.line) !== String(pat.r) || !v.stop) continue;
        if (v.headsign && nameSimilarity(v.headsign, P.stops[pat.s.at(-1)].name) < 0.5 && nameSimilarity(v.headsign, pat.h) < 0.5) continue;
        const stop = stripPlatform(v.stop);
        for (let k = 0; k <= leg.toK; k++) {
          if (nameSimilarity(stop, P.stops[pat.s[k]].name) < 0.75) continue;
          // Vůz u zastávky k: podle jízdního řádu tam má být v čase times[k] (+ zpoždění).
          const expected = leg.trip.times[k] - leg.shift + Math.max(0, Math.round((v.delay ?? 0) / 60));
          const diff = now - expected;
          if (diff < -4 || diff > 8) continue;
          const score = Math.abs(diff - 1);
          if (!best || score < best.score) best = { score, id: v.id };
        }
      }
      if (best) used.add(best.id);
      return best?.id ?? null;
    });
}
