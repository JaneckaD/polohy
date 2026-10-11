// MHD dalších měst kraje (Kroměříž, Valašské Meziříčí) z GTFS Integrované dopravy Zlínského kraje,
// pro vyhledávání spojení a pro jízdní řád vozu na mapě. Linky poznáme podle čísla licence v route_id.
import { readGtfsFiles } from './gtfs-lib.mjs';

export const CITY_ROUTES = { km: 'BUS_MHD:775', vm: 'BUS_MHD:946' };

const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const cityOf = (routeId) => Object.keys(CITY_ROUTES).find((c) => routeId.startsWith(CITY_ROUTES[c])) ?? null;

/** Spoje městské MHD jako rawTrips pro buildPlannerFromTrips: { ref, type: 'bus', city, mask, times, stops }. */
export function cityTrips(zipBytes, { startDate, days, log = () => {} }) {
  const routes = new Map();
  const trips = new Map();
  const stops = new Map();
  const services = new Map();
  const service = (id) => {
    if (!services.has(id)) services.set(id, { week: null, start: null, end: null, add: new Set(), remove: new Set() });
    return services.get(id);
  };
  readGtfsFiles(zipBytes, {
    'routes.txt': (r) => cityOf(r.route_id) && routes.set(r.route_id, r),
    'trips.txt': (r) => cityOf(r.route_id) && trips.set(r.trip_id, r),
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
      if (!trips.has(r.trip_id)) return;
      if (!times.has(r.trip_id)) times.set(r.trip_id, []);
      times.get(r.trip_id).push(r);
    },
  });

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
    const route = routes.get(trip.route_id);
    if (!route || list.length < 2) continue;
    const mask = maskOf(trip.service_id);
    if (!mask.includes('1')) continue;
    list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const dep = list.map((r) => toMinutes(r.departure_time) ?? toMinutes(r.arrival_time));
    if (dep.some((t) => t == null)) continue;
    for (let i = 1; i < dep.length; i++) while (dep[i] < dep[i - 1]) dep[i] += 1440;
    out.push({
      ref: route.route_short_name.trim(),
      type: 'bus',
      city: cityOf(trip.route_id),
      mask,
      times: dep,
      stops: list.map((r) => {
        const s = stops.get(r.stop_id);
        return [s?.stop_name ?? r.stop_id, s ? Number(s.stop_lat) : null, s ? Number(s.stop_lon) : null];
      }),
    });
  }
  const count = {};
  for (const t of out) count[t.city] = (count[t.city] ?? 0) + 1;
  log(`MHD dalších měst: ${Object.entries(count).map(([c, n]) => `${c} ${n} spojů`).join(', ') || 'žádné spoje'}`);
  return out;
}
