// MHD dalších měst kraje a regionální autobusy: polohy vozů z mapy IDZK (přes proxy /mhd), jízdní řády z GTFS IDZK.
import { nameSimilarity } from './names.js';
import { formatDelay } from './dszo.js';

// Barvy jsou podle druhu dopravy, ne podle města nebo dopravce: MHD modrá (jako autobusy DSZO),
// regionální autobusy oranžová. Kdo vůz provozuje, je napsané v detailu.
const MHD = { main: '#0a66d8', text: '#ffffff', stop: '#063f86' };
const REGIONAL = { main: '#e8710a', text: '#ffffff', stop: '#9c4a00' };
// Dálkové autobusy (FlixBus, RegioJet) tyrkysové: zelenou už má spěšný vlak.
const COACH = { main: '#00838f', text: '#ffffff', stop: '#005a62' };

export const CITIES = {
  km: { name: 'Kroměříž', licence: '775', ...MHD },
  vm: { name: 'Valašské Meziříčí', licence: '946', ...MHD },
  // MHD Uherské Hradiště (ZDS-Psota, i Staré Město a Kunovice) a Vsetín (Z-Group).
  uh: { name: 'Uherské Hradiště', licence: '805', ...MHD },
  vs: { name: 'Vsetín', licence: '945', ...MHD },
  // IDS JMK (živé polohy KORDIS, jízdní řády GTFS KORDIS): MHD Brna (tramvaje, trolejbusy, autobusy)
  // a MHD ostatních měst kraje (město je u spoje jako „MHD Znojmo“).
  brno: { name: 'Brno', licence: null, jmk: true, ...MHD },
  jmkmhd: { name: null, licence: null, jmk: true, ...MHD },
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
  psota: { name: 'ZDS-Psota', short: 'ZDS-Psota', code: '1114', live: /Psota/i, ...REGIONAL },
  tds: { name: 'Transdev Slezsko', short: 'Transdev Slezsko', code: '267', live: /Transdev Slezsko/i, ...REGIONAL },
  reg: { name: 'IDZK', short: 'IDZK', code: null, ...REGIONAL },
  // Regionální linky IDS JMK (jízdní řády KORDIS JMK) a ostatní regionální linky v oblasti (celostátní data,
  // dopravce je u spoje).
  jmk: { name: 'IDS JMK', short: 'IDS JMK', code: null, ...REGIONAL },
  other: { name: 'Regionální autobus', short: 'Regionální autobus', code: null, ...REGIONAL },
};

/** Dálkové autobusy (nejsou v IDZK): FlixBus ze sledování spojů, RegioJet odhadem podle jízdního řádu. */
export const COACHES = {
  flix: { name: 'FlixBus', short: 'FlixBus', ...COACH },
  rj: { name: 'RegioJet', short: 'RegioJet', ...COACH },
  // Ostatní dálkové a mezinárodní linky (dopravce je u spoje).
  coach: { name: 'Dálkový autobus', short: 'Dálkový autobus', ...COACH },
};

/** Všechny sítě (města i dopravci) podle klíče, jak je nese vůz (v.city) i spoj (pattern.c). */
export const NETWORKS = { ...CITIES, ...CARRIERS, ...COACHES };
export const isCarrier = (key) => key in CARRIERS;
export const isCoach = (key) => key in COACHES;
/** Síť IDS JMK (živé polohy z proudu KORDIS): regionální linky, MHD Brna a MHD ostatních měst. */
export const isJmk = (key) => key === 'jmk' || !!CITIES[key]?.jmk;
/** Trasy po silnicích jsou v routes-bus.json (načítá se až při potřebě), ne v routes.json. */
export const lazyRoutes = (key) => isCarrier(key) || isCoach(key) || !!CITIES[key]?.jmk;

/** Popis sítě pro detail vozu a spoje: „MHD Kroměříž“, „ČSAD BUS UH“, „FlixBus“. */
export const networkLabel = (key) => (CITIES[key] ? (CITIES[key].name ? `MHD ${CITIES[key].name}` : 'MHD') : (CARRIERS[key] ?? COACHES[key])?.short ?? '');

/** Číslo linky pro zobrazení: šestimístná licence z jízdních řádů („726504“) → číslo linky („504“), jako u linek IDZK. */
export function lineLabel(ref) {
  const m = /^(\d{3})(\d{3})$/.exec(String(ref ?? ''));
  return m ? String(Number(m[2])) || m[2] : String(ref ?? '');
}

/** Dopravce podle route_id z GTFS IDZK (null u MHD měst a linek DSZO). */
export function carrierOfRoute(routeId) {
  const code = /^BUS[^:]*:\d+_(\d+)_/.exec(routeId ?? '')?.[1];
  return Object.keys(CARRIERS).find((k) => CARRIERS[k].code === code) ?? 'reg';
}

/** Krátký název dopravce z mapy IDZK („TQM–MHDVM“ → „TQM“, „ZDS-Psota“). */
export function carrierName(cr) {
  if (!cr) return null;
  for (const c of Object.values(CARRIERS)) if (c.code && (c.live ?? new RegExp(c.short, 'i')).test(cr)) return c.short;
  return cr.replace(/,.*$/, '').trim() || null;
}

const cityOfLicence = (cn) => Object.keys(CITIES).find((c) => CITIES[c].licence && cn.startsWith(CITIES[c].licence)) ?? null;

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
    operator: carrierName(t.cr),
    delay,
    delayText: formatDelay(delay),
    updated: null,
  };
}

/** Rozdíl proti jízdnímu řádu z mapy MHD Kroměříž: „-00:05:55“ = 355 s zpoždění, kladný = náskok. */
export function parseKmDelay(text) {
  const m = /^([+-])?(\d+):(\d+):(\d+)$/.exec(text ?? '');
  if (!m) return null;
  const s = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return s === 0 ? 0 : m[1] === '-' ? s : -s;
}

/** Vůz MHD Kroměříž z její vlastní mapy (kromeriz.mhdonline.cz) → vůz pro mapu, nebo null. */
export function parseKmBus(b) {
  if (!Number.isFinite(b.gps_latitude) || !Number.isFinite(b.gps_longitude) || b.line_number == null) return null;
  const delay = parseKmDelay(b.time_difference);
  return {
    id: `km-${b.vid}`,
    type: 'bus',
    city: 'km',
    line: String(b.line_number),
    licence: CITIES.km.licence,
    lat: b.gps_latitude,
    lon: b.gps_longitude,
    bearing: null,
    stop: b.current_stop_name || null,
    next: null,
    from: null,
    headsign: b.destination_name || null,
    rawStop: b.current_stop_name ? `Kroměříž, ${b.current_stop_name}` : null,
    rawHeadsign: b.destination_name ? `Kroměříž, ${b.destination_name}` : null,
    // Číslo spoje odpovídá číslu spoje v jízdním řádu (GTFS IDZK).
    tripNo: b.connection_no != null ? String(b.connection_no) : null,
    lowFloor: null,
    aircon: typeof b.air_conditioning === 'boolean' ? b.air_conditioning : null,
    features: b.air_conditioning ? ['ac'] : [],
    plate: null,
    delay,
    delayText: formatDelay(delay),
    updated: b.state_dtime ?? null,
  };
}

export async function fetchCityBuses(proxy) {
  const res = await fetch(`${proxy}/mhd`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`/mhd: HTTP ${res.status}`);
  const data = await res.json();
  return [...(data.vehicles ?? []).map(parseCityBus), ...(data.km ?? []).map(parseKmBus)].filter(Boolean);
}

/**
 * Kde je vůz podle jízdního řádu a zpoždění, když název jeho zastávky ve spoji nenajdeme
 * (mapa MHD Kroměříž píše „Nádraží“, jízdní řád „aut.nádr.“): poslední zastávka, kterou už měl projet.
 */
export function timeTripPosition(trip, delaySec, now) {
  if (!trip?.length) return null;
  const delay = Math.max(0, Math.round((delaySec ?? 0) / 60));
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let i = -1;
  trip.forEach((s, k) => {
    if (s.time && toMin(s.time) + delay <= now) i = k;
  });
  if (i < 0) return { current: 0, atStop: true };
  return { current: i, atStop: i === trip.length - 1 };
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
