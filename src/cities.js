// MHD dalších měst kraje: polohy vozů z mapy IDZK (přes proxy /mhd), jízdní řády z GTFS IDZK.
// Každé město má vlastní barvu, aby bylo na mapě poznat, že jde o jinou MHD než ve Zlíně.
import { nameSimilarity } from './names.js';
import { formatDelay } from './dszo.js';

export const CITIES = {
  km: { name: 'Kroměříž', licence: '775', main: '#e8590c', text: '#ffffff', stop: '#a33d06' },
  vm: { name: 'Valašské Meziříčí', licence: '946', main: '#00897b', text: '#ffffff', stop: '#005f56' },
};

const cityOfLicence = (cn) => Object.keys(CITIES).find((c) => cn.startsWith(CITIES[c].licence)) ?? null;

/** Název zastávky pro zobrazení: „Valašské Meziříčí,žel.st.“ → „žel.st.“ (obec jen u jiné obce). */
export function cityStopName(city, name) {
  if (!name) return name;
  const tidy = name.replace(/,\s*/, ', ');
  const prefix = `${CITIES[city]?.name}, `;
  return tidy.startsWith(prefix) ? tidy.slice(prefix.length) : tidy;
}

/** Zpoždění z textu mapy IDZK: „$z1~min.~34~s“ = 94 s zpoždění, „$p…“ = náskok. */
export function parseDelay(ds) {
  const m = /\$([zp])(\d+)~min\.~(\d+)~s/.exec(ds ?? '');
  if (!m) return null;
  const s = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === 'p' ? -s : s;
}

/** Záznam z proxy → vůz pro mapu (stejný tvar jako vozy DSZO), nebo null. */
export function parseCityBus(t) {
  const f = String(t.cn ?? '').split('|');
  const city = cityOfLicence(f[0] ?? '');
  if (!city || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return null;
  const angle = /a_(\d+)\.png/.exec(t.ico ?? '');
  const delay = parseDelay(t.ds);
  const plate = (f[11] ?? '').trim();
  return {
    id: `${city}-${plate || f[2]}`,
    type: 'bus',
    city,
    line: f[1],
    lat: t.x,
    lon: t.y,
    bearing: angle ? Number(angle[1]) : null,
    stop: cityStopName(city, f[3]) || null,
    next: cityStopName(city, f[5]) || null,
    from: cityStopName(city, f[8]) || null,
    headsign: cityStopName(city, f[9]) || null,
    // Celé názvy (s obcí) pro hledání spoje v jízdních řádech.
    rawStop: f[3] || null,
    rawHeadsign: f[9] || null,
    tripNo: f[2] || null,
    lowFloor: f[10] === '1',
    features: f[10] === '1' ? ['lowlevel'] : [],
    plate: plate || null,
    delay,
    delayText: formatDelay(delay),
    updated: null,
  };
}

export async function fetchCityBuses(proxy) {
  const res = await fetch(`${proxy}/mhd`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`/mhd: HTTP ${res.status}`);
  const data = await res.json();
  return (data.vehicles ?? []).map(parseCityBus).filter(Boolean);
}

const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const dayIndex = (start, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);

/**
 * Spoj, kterým vůz městské MHD právě jede (z dat vyhledávání spojení): stejná linka a cíl,
 * a u poslední zastávky má být podle jízdního řádu (+ zpoždění) zhruba teď.
 * Vrací [{ name, time, lat, lon }] nebo [].
 */
export function cityTrip(P, v, date, now) {
  if (!P || !v.city) return [];
  const di = dayIndex(P.startDate, date);
  const delay = Math.max(0, Math.round((v.delay ?? 0) / 60));
  let best = null;
  // Podle čísla spoje (z mapy IDZK): ze dnešních jízd ta, která teď jede (nebo je časově nejblíž).
  for (const trip of P.trips) {
    const pat = trip.pattern;
    if (!v.tripNo || trip.no !== v.tripNo || pat.c !== v.city || pat.r !== v.line || di < 0 || di >= P.days || trip.mask[di] !== '1') continue;
    const first = trip.times[0];
    const last = trip.times.at(-1) + delay;
    const gap = now < first - 30 ? first - now : now > last ? now - last : 0;
    if (!best || gap < best.score) best = { score: gap, trip };
  }
  if (best && best.score > 60) best = null;
  // Jinak podle linky, cíle a poslední zastávky.
  for (const trip of best ? [] : P.trips) {
    const pat = trip.pattern;
    if (pat.c !== v.city || pat.r !== v.line || di < 0 || di >= P.days || trip.mask[di] !== '1') continue;
    if (v.rawHeadsign && nameSimilarity(v.rawHeadsign, P.stops[pat.s.at(-1)].name) < 0.6) continue;
    pat.s.forEach((si, k) => {
      if (!v.rawStop || nameSimilarity(v.rawStop, P.stops[si].name) < 0.8) return;
      const diff = now - (trip.times[k] + delay);
      if (diff < -5 || diff > 15) return;
      const score = Math.abs(diff - 1);
      if (!best || score < best.score) best = { score, trip };
    });
  }
  if (!best) return [];
  return best.trip.pattern.s.map((si, k) => {
    const s = P.stops[si];
    return { name: cityStopName(v.city, s.name), lat: s.lat, lon: s.lon, time: hhmm(best.trip.times[k]) };
  });
}
