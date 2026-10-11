// Vlaky pro vyhledávání spojení a detail vlaku: celostátní jízdní řády vlaků v GTFS
// (jizdnirady.cz, přebalené pro projekt Transitous). Bereme každý vlak, který ve Zlínském kraji
// zastaví aspoň ve dvou stanicích, a to s celou trasou (i mimo kraj), včetně zastávek na znamení.
import { readGtfsFiles } from './gtfs-lib.mjs';
import { regionContains } from '../src/region.js';

export const RAIL_GTFS_URL = 'https://raw.githubusercontent.com/hoermalmeister/gtfs-rehost/main/czrail/jizdnirady-gtfs.zip';

const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Zkratka druhu vlaku (Os, Sp, R, Ex, EC, RJ, LE…) podle linky a dopravce.
 * Data druh vlaku přímo nemají; linky S/L/P/U… jsou osobní vlaky, Sp/R/Ex podle začátku názvu.
 */
export function railCode(routeShortName = '', agency = '', international = false) {
  const name = routeShortName.trim();
  const first = name.split(/[\s/]/)[0];
  if (/^Sp\d*/.test(first)) return 'Sp';
  if (/^R\d*$/.test(first)) return 'R';
  if (/^Ex\d*$/.test(first)) return international ? 'EC' : 'Ex';
  const brand = /^(IC|EC|EN|SC|RJ|LE|rj|NJ|ECE|TLX|AEx)\b/.exec(name);
  if (brand) return brand[1];
  if (/regiojet/i.test(name) || /regiojet/i.test(agency)) return 'RJ';
  if (/leo express/i.test(name) || /leo express/i.test(agency)) return 'LE';
  if (/^[A-Z]{1,2}\d/.test(first)) return 'Os';
  return international ? 'EC' : 'Os';
}

/** Krátký název dopravce (bez „a.s.“, „s.r.o.“ a dodatků). */
export function operatorName(name = '') {
  return name.replace(/\s*-\s*žadatel$/i, '').trim();
}

/**
 * Z GTFS vlaků vybere ty, které projíždějí krajem, a vrátí je jako rawTrips pro buildPlannerFromTrips:
 * { ref: 'Os 14244', type: 'train', number, code, operator, mask, times (odjezdy), arr (příjezdy), stops: [[název, lat, lon]] }
 */
export function railTrips(zipBytes, { startDate, days, region, log = () => {} }) {
  const agencies = new Map();
  const routes = new Map();
  const trips = new Map();
  const stops = new Map();
  const services = new Map();
  const service = (id) => {
    if (!services.has(id)) services.set(id, { week: null, start: null, end: null, add: new Set(), remove: new Set() });
    return services.get(id);
  };
  readGtfsFiles(zipBytes, {
    'agency.txt': (r) => agencies.set(r.agency_id, r.agency_name),
    'routes.txt': (r) => routes.set(r.route_id, r),
    'trips.txt': (r) => trips.set(r.trip_id, r),
    'stops.txt': (r) => stops.set(r.stop_id, r),
    'calendar.txt': (r) => {
      const s = service(r.service_id);
      s.week = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => r[d] === '1');
      s.start = r.start_date;
      s.end = r.end_date;
    },
    'calendar_dates.txt': (r) => {
      const s = service(r.service_id);
      (r.exception_type === '1' ? s.add : s.remove).add(r.date);
    },
  });
  const times = new Map();
  readGtfsFiles(zipBytes, {
    'stop_times.txt': (r) => {
      if (!times.has(r.trip_id)) times.set(r.trip_id, []);
      times.get(r.trip_id).push(r);
    },
  });

  // Zahraniční stanice: kód UIC stanice nezačíná 54 (Česko).
  const foreign = (stopId) => {
    const s = stops.get(stopId);
    const parent = stops.get(s?.parent_station) ?? s;
    const uic = /UIC:(\d+)/.exec(parent?.relations ?? '')?.[1];
    return uic ? !uic.startsWith('54') : false;
  };

  const dates = [];
  const start = Date.parse(`${startDate}T00:00:00Z`);
  for (let i = 0; i < days; i++) dates.push(new Date(start + i * 86400000).toISOString().slice(0, 10).replaceAll('-', ''));
  const maskCache = new Map();
  const maskOf = (serviceId) => {
    if (maskCache.has(serviceId)) return maskCache.get(serviceId);
    const s = services.get(serviceId);
    const mask = dates
      .map((g) => {
        if (!s || s.remove.has(g)) return '0';
        if (s.add.has(g)) return '1';
        if (!s.week || g < s.start || g > s.end) return '0';
        const dow = (new Date(`${g.slice(0, 4)}-${g.slice(4, 6)}-${g.slice(6)}T00:00:00Z`).getUTCDay() + 6) % 7;
        return s.week[dow] ? '1' : '0';
      })
      .join('');
    maskCache.set(serviceId, mask);
    return mask;
  };

  const out = [];
  for (const [id, list] of times) {
    const trip = trips.get(id);
    const route = routes.get(trip?.route_id);
    if (!route) continue;
    list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const located = list.map((r) => stops.get(r.stop_id)).filter(Boolean);
    const inside = located.filter((s) => regionContains(region, Number(s.stop_lon), Number(s.stop_lat))).length;
    if (inside < 2) continue;
    const mask = maskOf(trip.service_id);
    if (!mask.includes('1')) continue;
    const dep = list.map((r) => toMinutes(r.departure_time) ?? toMinutes(r.arrival_time));
    const arr = list.map((r) => toMinutes(r.arrival_time) ?? toMinutes(r.departure_time));
    if (dep.some((t) => t == null)) continue;
    // Po půlnoci data někdy začínají znovu od 00:00: časy srovnáme za sebe.
    for (let i = 0; i < dep.length; i++) {
      const prev = i ? dep[i - 1] : -Infinity;
      while (arr[i] < prev) arr[i] += 1440;
      while (dep[i] < arr[i]) dep[i] += 1440;
    }
    const international = foreign(list[0].stop_id) || foreign(list.at(-1).stop_id);
    const agency = agencies.get(route.agency_id) ?? '';
    const code = railCode(route.route_short_name, agency, international);
    const number = trip.trip_short_name.trim();
    out.push({
      ref: `${code} ${number}`,
      type: 'train',
      number,
      code,
      operator: operatorName(agency),
      line: route.route_short_name.trim() || null,
      mask,
      times: dep,
      arr,
      stops: list.map((r) => {
        const s = stops.get(r.stop_id);
        return [s?.stop_name ?? r.stop_id, s ? Number(s.stop_lat) : null, s ? Number(s.stop_lon) : null];
      }),
    });
  }
  const codes = {};
  for (const t of out) codes[t.code] = (codes[t.code] ?? 0) + 1;
  log(`Vlaky: ${out.length} spojů přes kraj (${Object.entries(codes).map(([c, n]) => `${c} ${n}`).join(', ')})`);
  return out;
}
