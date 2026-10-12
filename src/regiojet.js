// Dálkové autobusy RegioJet: polohy RegioJet nezveřejňuje (ani zpoždění), proto je odhadujeme
// podle jízdního řádu (public/rj.json z scripts/build-regiojet.mjs) po trase mezi zastávkami.
import { regionContains } from './region.js';
import { decodePolyline } from './coaches.js';

let dataPromise = null;

/** Jízdní řády RegioJetu přes kraj, načtené jednou (bez nich prázdná data). */
export function loadRegioJet() {
  dataPromise ??= fetch('./rj.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d) => d ?? { stations: {}, segs: {}, conns: [] });
  return dataPromise;
}

// --- Kalendář ---------------------------------------------------------------

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const holidayCache = new Map();

/** Státní svátek ČR (včetně Velkého pátku a Velikonočního pondělí)? */
export function isHoliday(date) {
  const year = Number(date.slice(0, 4));
  if (!holidayCache.has(year)) {
    const fixed = ['01-01', '05-01', '05-08', '07-05', '07-06', '09-28', '10-28', '11-17', '12-24', '12-25', '12-26'];
    const set = new Set(fixed.map((md) => `${year}-${md}`));
    const easter = easterSunday(year);
    set.add(ymd(easter - 2 * 86400000));
    set.add(ymd(easter + 86400000));
    holidayCache.set(year, set);
  }
  return holidayCache.get(year).has(date);
}

/**
 * Jede spoj RegioJetu v den date („2026-10-12“)? Symboly: x pracovní dny, 1–7 dny v týdnu,
 * + neděle a svátky, bez symbolů denně. Časové kódy: EXCLUDING nejede, INCLUDING_ALSO jede také,
 * ONLY / INCLUDING jede jen.
 */
export function runsOn(conn, date) {
  const [from, to] = conn.valid ?? [];
  if ((from && date < from) || (to && date > to)) return false;
  const inRange = ([, a, b]) => date >= a && date <= (b ?? a);
  const codes = conn.codes ?? [];
  if (codes.some((c) => c[0] === 'EXCLUDING' && inRange(c))) return false;
  if (codes.some((c) => c[0] === 'INCLUDING_ALSO' && inRange(c))) return true;
  const only = codes.filter((c) => c[0] === 'ONLY' || c[0] === 'INCLUDING');
  if (only.length) return only.some(inRange);

  const dow = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // 1 = pondělí … 7 = neděle
  const holiday = isHoliday(date);
  const days = (conn.sym ?? []).filter((s) => /^[xX+1-7]$/.test(s));
  if (!days.length) return true;
  return days.some((s) => {
    if (s === 'x' || s === 'X') return dow <= 5 && !holiday;
    if (s === '+') return dow === 7 || holiday;
    return Number(s) === dow;
  });
}

// --- Poloha podle jízdního řádu -----------------------------------------------

const RAD = Math.PI / 180;
function distance([lon1, lat1], [lon2, lat2]) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * RAD);
  return Math.hypot(x, lat2 - lat1);
}
function bearing([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Bod v podílu f (0–1) délky lomené čáry [[lon, lat], …] a směr jízdy v něm. */
export function along(line, f) {
  const lens = line.slice(1).map((p, i) => distance(line[i], p));
  const total = lens.reduce((a, b) => a + b, 0);
  let left = Math.min(Math.max(f, 0), 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? Math.min(left / lens[i], 1) : 0;
      const [a, b] = [line[i], line[i + 1]];
      return { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, bearing: bearing(a, b) };
    }
    left -= lens[i];
  }
  return { lon: line[0][0], lat: line[0][1], bearing: null };
}

const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const prevDay = (date) => ymd(Date.parse(`${date}T00:00:00Z`) - 86400000);

/**
 * Autobusy RegioJet, které teď podle jízdního řádu jedou uvnitř kraje.
 * date = dnešní datum v Praze, now = minuty od půlnoci (i se zlomkem).
 */
export function regioJetVehicles(data, region, date, now) {
  const out = [];
  const segCache = new Map();
  const segment = (a, b) => {
    const key = `${a}-${b}`;
    if (!segCache.has(key)) {
      const enc = data.segs?.[key];
      const sa = data.stations[a];
      const sb = data.stations[b];
      segCache.set(key, enc ? decodePolyline(enc) : sa?.[1] != null && sb?.[1] != null ? [[sa[2], sa[1]], [sb[2], sb[1]]] : null);
    }
    return segCache.get(key);
  };
  for (const conn of data.conns ?? []) {
    // Spoj, který vyjel včera a jede přes půlnoc, má časy po 24:00.
    for (const [day, t] of [[date, now], [prevDay(date), now + 1440]]) {
      const stops = conn.stops;
      const first = stops[0][2] ?? stops[0][1];
      const last = stops.at(-1)[1] ?? stops.at(-1)[2];
      if (t < first || t > last || !runsOn(conn, day)) continue;
      let pos = null;
      let ni = -1;
      let atStop = false;
      for (let i = 0; i < stops.length; i++) {
        const [id, arr, dep] = stops[i];
        const a = arr ?? dep;
        const d = dep ?? arr;
        const st = data.stations[id];
        if (t >= a && t <= d) {
          if (st?.[1] == null) break;
          ni = i;
          atStop = true;
          pos = { lat: st[1], lon: st[2], bearing: null };
          break;
        }
        const next = stops[i + 1];
        const nextArr = next?.[1] ?? next?.[2];
        if (next && t > d && t < nextArr) {
          const line = segment(id, next[0]);
          if (!line || line.length < 2) break;
          ni = i + 1;
          pos = along(line, (t - d) / (nextArr - d));
          break;
        }
      }
      if (!pos || (region && !regionContains(region, pos.lon, pos.lat))) continue;
      const calls = stops.map(([id, arr, dep], i) => ({
        seq: i + 1,
        name: data.stations[id]?.[0] ?? String(id),
        lat: data.stations[id]?.[1] ?? null,
        lon: data.stations[id]?.[2] ?? null,
        time: hhmm(dep ?? arr),
      }));
      out.push({
        id: `rj-${conn.id}-${day}`,
        type: 'bus',
        city: 'rj',
        line: 'RJ',
        lineName: `${conn.from} – ${conn.to}`,
        estimated: true,
        lat: pos.lat,
        lon: pos.lon,
        bearing: pos.bearing,
        stop: atStop ? calls[ni].name : ni > 0 ? calls[ni - 1].name : null,
        next: atStop ? (calls[ni + 1]?.name ?? null) : (calls[ni]?.name ?? null),
        from: calls[0].name,
        headsign: calls.at(-1).name,
        tripNo: null,
        lowFloor: null,
        features: [],
        plate: null,
        delay: null,
        delayText: '',
        updated: null,
        calls,
        nextIndex: ni,
        atStop,
        segments: stops.slice(1).map((s, i) => segment(stops[i][0], s[0])),
      });
    }
  }
  return out;
}
