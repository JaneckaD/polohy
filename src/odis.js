// Živé polohy ODIS (Moravskoslezský kraj a linky ODIS do okolí): veřejná mapa koordinátora ODIS na mpvnet.cz
// přes proxy /mhd (pole odis). Regionální autobusy, MHD Ostravy (DPO), Opavy (MDPO) a dalších měst.
// Spoj (zastávky, časy, druh vozu, dopravce) se dohledá v datech vyhledávání spojení (celostátní jízdní řády)
// podle licence linky a čísla spoje; MHD Ostrava posílá místo licence číslo linky.
import { formatDelay } from './dszo.js';
import { cityStopName, lineLabel, parseDelay, carrierName } from './cities.js';
import { nameSimilarity } from './names.js';
import { krajOf } from './region.js';

const NETS = new Set(['other', 'town', 'coach']);
// Licence linek MHD Ostrava (DPO) začínají 915: linka 12 = 915012.
const DPO_LICENCE = '915';

const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const dayIndex = (start, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);

function distM(lat1, lon1, lat2, lon2) {
  const kx = 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot((lat1 - lat2) * 110574, (lon1 - lon2) * kx);
}

// Spoje celostátních dat podle „licence|číslo spoje“, postavené jednou.
const tripIndex = new WeakMap();
function tripsByKey(P) {
  if (!tripIndex.has(P)) {
    const idx = new Map();
    for (const trip of P.trips) {
      if (!NETS.has(trip.pattern.c) || trip.no == null) continue;
      const key = `${trip.pattern.r}|${trip.no}`;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(trip);
    }
    tripIndex.set(P, idx);
  }
  return tripIndex.get(P);
}

// Spoje MHD podle čísla linky (MHD Ostrava posílá místo čísla spoje pořadí vozu).
const lineIndex = new WeakMap();
function tripsByLine(P) {
  if (!lineIndex.has(P)) {
    const idx = new Map();
    for (const trip of P.trips) {
      if (!NETS.has(trip.pattern.c)) continue;
      const key = lineLabel(trip.pattern.r);
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(trip);
    }
    lineIndex.set(P, idx);
  }
  return lineIndex.get(P);
}

/**
 * Spoj podle linky, příští zastávky a cíle: příští zastávka má být podle jízdního řádu a zpoždění
 * za chvíli (do 12 minut). Pro vozy, jejichž číslo spoje neodpovídá jízdnímu řádu.
 */
export function matchOdisByStop(P, line, next, headsign, date, min, delayMin = 0) {
  if (!P || !line || !next) return null;
  const di = dayIndex(P.startDate, date);
  let best = null;
  for (const trip of tripsByLine(P).get(String(line)) ?? []) {
    const s = trip.pattern.s;
    if (headsign && nameSimilarity(headsign, P.stops[s.at(-1)].name) < 0.6) continue;
    for (const [day, shift] of [[di, 0], [di - 1, 1440]]) {
      if (day < 0 || day >= P.days || trip.mask[day] !== '1') continue;
      const t = min + shift - Math.max(0, delayMin);
      if (t < trip.arr[0] - 30 || t > trip.times.at(-1) + 5) continue;
      for (let k = 1; k < s.length; k++) {
        const ahead = trip.arr[k] - t;
        if (ahead < -2 || ahead > 12 || !sameStop(next, P.stops[s[k]].name)) continue;
        const score = Math.abs(ahead - 1.5);
        if (!best || score < best.score) best = { score, trip, shift };
      }
    }
  }
  return best;
}

/** Jízda spoje, která teď jede (dnešní, nebo včerejší přes půlnoc): { trip, shift } nebo null. */
export function matchOdisTrip(P, licence, tripNo, date, min, delayMin = 0) {
  if (!P || !licence || !tripNo) return null;
  const di = dayIndex(P.startDate, date);
  let best = null;
  for (const trip of tripsByKey(P).get(`${licence}|${tripNo}`) ?? []) {
    for (const [day, shift] of [[di, 0], [di - 1, 1440]]) {
      if (day < 0 || day >= P.days || trip.mask[day] !== '1') continue;
      const t = min + shift;
      const first = trip.arr[0] - 60;
      const last = trip.times.at(-1) + Math.max(0, delayMin) + 30;
      const gap = t < first ? first - t : t > last ? t - last : 0;
      if (!best || gap < best.gap) best = { gap, trip, shift };
    }
  }
  return best && best.gap <= 30 ? best : null;
}

// Trasy vzorů spojů po silnicích (src/estimated.js), u tramvají rovně mezi zastávkami.
let segmentsFor = () => null;
export function setOdisSegments(fn) {
  segmentsFor = fn;
}

const callsCache = new WeakMap();
function tripCalls(P, trip, net, tram) {
  if (!callsCache.has(trip)) {
    const pat = trip.pattern;
    const calls = pat.s.map((si, i) => ({ seq: i + 1, name: cityStopName(net, P.stops[si].name), raw: P.stops[si].name, lat: P.stops[si].lat, lon: P.stops[si].lon, time: hhmm(trip.times[i]) }));
    const segments = tram ? calls.slice(1).map((c, i) => (c.lat != null && calls[i].lat != null ? [[calls[i].lon, calls[i].lat], [c.lon, c.lat]] : null)) : segmentsFor(P, pat);
    callsCache.set(trip, { calls, segments });
  }
  return callsCache.get(trip);
}

const sameStop = (a, b) => !!a && !!b && nameSimilarity(a, b) >= 0.75;
const TYPES = { r: 'tram', t: 'trolleybus' };

/** Druh vozu MHD Ostrava podle čísla linky, když spoj nenajdeme: 1–20 tramvaje, 101–199 trolejbusy. */
function dpoType(line) {
  const n = Number(line);
  return n >= 1 && n <= 20 ? 'tram' : n >= 101 && n <= 199 ? 'trolleybus' : 'bus';
}

/**
 * Záznam mapy ODIS → vůz pro mapu (stejný tvar jako vozy IDS JMK), nebo null (vlak, vůz bez linky).
 * cn: licence|linka|spoj|poslední zastávka|…|příští zastávka|…|…|odkud|cíl|nízkopodlažní|SPZ (MHD Ostrava:
 * linka|linka|spoj|…, ev. číslo vozu místo SPZ).
 */
export function parseOdis(t, { P = null, region = null, date, min } = {}) {
  if (t.cat === 1 || t.t !== 'H' || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return null;
  // Na mapě ODIS jsou i linky Zlínského kraje (Valašsko): ty ukazuje mapa IDZK.
  if (region) {
    const kraj = krajOf(region, t.y, t.x);
    if (!kraj || kraj === 'zlk' || kraj === 'jmk') return null;
  }
  const f = String(t.cn ?? '').split('|');
  if (!f[1]) return null;
  const dpo = t.cat === 3 || /^DPO\b/.test(t.cr ?? '');
  const licence = /^\d{6}$/.test(f[0]) ? f[0] : dpo ? `${DPO_LICENCE}${String(f[1]).padStart(3, '0')}` : null;
  const tripNo = f[2] || null;
  const delay = parseDelay(t.ds);
  const delayMin = Math.round((delay ?? 0) / 60);
  const match = P && date ? (matchOdisTrip(P, licence, tripNo, date, min, delayMin) ?? matchOdisByStop(P, lineLabel(f[1]), f[5], f[9], date, min, delayMin)) : null;
  const pat = match?.trip.pattern;
  const city = pat?.c ?? (dpo || /MDPO/.test(t.cr ?? '') ? 'town' : 'other');
  const type = TYPES[pat?.y] ?? (dpo ? dpoType(f[1]) : 'bus');
  const angle = /a_(\d+)\.png/.exec(t.ico ?? '');
  const plate = (f[11] ?? '').replace(/^Ev\.\s*č\.\s*/i, 'ev. č. ').trim();
  const v = {
    id: `odis-${plate || `${f[0]}-${tripNo}`}`,
    type,
    city,
    line: lineLabel(f[1]),
    licence,
    lat: t.x,
    lon: t.y,
    bearing: angle ? Number(angle[1]) : null,
    stop: f[3] ? cityStopName(city, f[3]) : null,
    next: f[5] ? cityStopName(city, f[5]) : null,
    from: f[8] ? cityStopName(city, f[8]) : null,
    headsign: f[9] ? cityStopName(city, f[9]) : null,
    rawStop: f[3] || null,
    rawHeadsign: f[9] || null,
    tripNo,
    operatorName: pat?.c === 'town' ? pat.o : carrierName(t.cr),
    lowFloor: f[10] === '1' ? true : f[10] === '0' ? false : null,
    features: f[10] === '1' ? ['lowlevel'] : [],
    plate: plate || null,
    delay,
    delayText: formatDelay(delay),
    updated: null,
    live: 'odis',
  };
  if (match) {
    const { calls, segments } = tripCalls(P, match.trip, city, type === 'tram');
    // Příští zastávka podle názvu z mapy, jinak podle jízdního řádu a zpoždění.
    const now = min + match.shift - Math.max(0, Math.round((delay ?? 0) / 60));
    let ni = f[5] ? calls.findIndex((c, i) => i > 0 && sameStop(f[5], c.raw)) : -1;
    if (ni < 0) {
      ni = match.trip.times.findIndex((tt) => tt > now);
      if (ni < 0) ni = calls.length - 1;
    }
    const waiting = now < match.trip.times[0];
    if (waiting) ni = 0; // čeká na výchozí zastávce
    const prev = calls[ni - 1];
    const standing = /stoji/.test(t.ico ?? '');
    const atStop = ni === 0 || (standing && prev?.lat != null && distM(t.x, t.y, prev.lat, prev.lon) < 80);
    const k = atStop && ni > 0 ? ni - 1 : ni;
    Object.assign(v, {
      tripId: match.trip.id,
      from: calls[0].name,
      headsign: v.headsign ?? calls.at(-1).name,
      next: atStop ? (calls[k + 1]?.name ?? null) : calls[k].name,
      calls,
      nextIndex: k,
      atStop,
      segments,
    });
  }
  return v;
}
