// MHD dalších měst kraje a regionální autobusy: polohy vozů z mapy IDZK (přes proxy /mhd), jízdní řády z GTFS IDZK.
import { nameSimilarity } from './names.js';
import { formatDelay } from './dszo.js';

// Barvy jsou podle druhu dopravy, ne podle města nebo dopravce: MHD modrá (jako autobusy DSZO),
// regionální autobusy oranžová. Kdo vůz provozuje, je napsané v detailu.
const MHD = { main: '#0a66d8', text: '#ffffff', stop: '#063f86' };
const REGIONAL = { main: '#e8710a', text: '#ffffff', stop: '#9c4a00' };

export const CITIES = {
  km: { name: 'Kroměříž', licence: '775', ...MHD },
  vm: { name: 'Valašské Meziříčí', licence: '946', ...MHD },
  // MHD Uherské Hradiště (ZDS-Psota, i Staré Město a Kunovice) a Vsetín (Z-Group).
  uh: { name: 'Uherské Hradiště', licence: '805', ...MHD },
  vs: { name: 'Vsetín', licence: '945', ...MHD },
};

/**
 * Dopravci regionálních autobusů IDZK. code = číslo dopravce v route_id GTFS IDZK („BUS_MHD:802180_263_…“),
 * live = jak se dopravce jmenuje na mapě IDZK (jen u těch, jejichž vozy na mapě ukazujeme).
 */
export const CARRIERS = {
  csad: { name: 'ČSAD BUS Uherské Hradiště', short: 'ČSAD BUS UH', code: '263', live: /ČSAD BUS U/i, ...REGIONAL },
  zgroup: { name: 'Z-Group bus', short: 'Z-Group', code: '312', live: /Z-Group/i, ...REGIONAL },
  arriva: { name: 'ARRIVA autobusy', short: 'Arriva', code: '88', live: /ARRIVA/i, ...REGIONAL },
  tdm: { name: 'Transdev Morava', short: 'Transdev Morava', code: '1425', live: /Transdev Morava/i, ...REGIONAL },
  tqm: { name: 'TQM-holding', short: 'TQM', code: '1005', live: /TQM/i, ...REGIONAL },
  psota: { name: 'ZDS-Psota', short: 'ZDS-Psota', code: '1114', ...REGIONAL },
  tds: { name: 'Transdev Slezsko', short: 'Transdev Slezsko', code: '267', live: /Transdev Slezsko/i, ...REGIONAL },
  reg: { name: 'IDZK', short: 'IDZK', code: null, ...REGIONAL },
};

/** Všechny sítě (města i dopravci) podle klíče, jak je nese vůz (v.city) i spoj (pattern.c). */
export const NETWORKS = { ...CITIES, ...CARRIERS };
export const isCarrier = (key) => key in CARRIERS;

/** Popis sítě pro detail vozu a spoje: „MHD Kroměříž“, „ČSAD BUS UH“. */
export const networkLabel = (key) => (CITIES[key] ? `MHD ${CITIES[key].name}` : CARRIERS[key]?.short ?? '');

/** Dopravce podle route_id z GTFS IDZK (null u MHD měst a linek DSZO). */
export function carrierOfRoute(routeId) {
  const code = /^BUS[^:]*:\d+_(\d+)_/.exec(routeId ?? '')?.[1];
  return Object.keys(CARRIERS).find((k) => CARRIERS[k].code === code) ?? 'reg';
}

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
  const m = /\$([zp])-?(\d+)~min\.~(\d+)~s/.exec(ds ?? '');
  if (!m) return null;
  const s = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === 'p' ? -s : s;
}

/** Záznam z proxy → vůz pro mapu (stejný tvar jako vozy DSZO), nebo null. */
export function parseCityBus(t) {
  const f = String(t.cn ?? '').split('|');
  // MHD města podle licence linky, regionální autobus podle dopravce (jen dopravci, které ukazujeme).
  const city = cityOfLicence(f[0] ?? '') ?? (t.cr ? Object.keys(CARRIERS).find((k) => CARRIERS[k].live?.test(t.cr)) : null) ?? null;
  if (!city || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return null;
  const angle = /a_(\d+)\.png/.exec(t.ico ?? '');
  const delay = parseDelay(t.ds);
  const plate = (f[11] ?? '').trim();
  return {
    id: `${city}-${plate || `${f[0]}-${f[2]}`}`,
    type: 'bus',
    city,
    line: f[1],
    licence: f[0] || null,
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
    // Nízkopodlažnost: 1 ano, 0 ne, jinak neznámá.
    lowFloor: f[10] === '1' ? true : f[10] === '0' ? false : null,
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
