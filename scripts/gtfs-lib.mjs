// Jízdní řády ve formátu GTFS (např. Integrovaná doprava Zlínského kraje).
// ZIP se čte proudově, takže zvládne i velké celostátní balíky: nejdřív linky, spoje a kalendář,
// pak jen zastavení a tvary tras vybraných spojů.
import { Unzip, UnzipInflate } from 'fflate';
import { assembleLines } from './jdf-lib.mjs';

/** Rozdělí řádek CSV (s uvozovkami podle RFC 4180). */
export function parseCsvLine(line) {
  const out = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let value = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { value += '"'; i += 2; }
          else { i++; break; }
        } else value += line[i++];
      }
      out.push(value);
      i = line.indexOf(',', i) + 1 || line.length + 1;
    } else {
      const end = line.indexOf(',', i);
      out.push(line.slice(i, end < 0 ? line.length : end));
      i = end < 0 ? line.length + 1 : end + 1;
    }
  }
  return out;
}

/**
 * Projde vybrané soubory ZIPu po řádcích. handlers: { 'trips.txt': (row) => … }, row = objekt podle hlavičky.
 */
export function readGtfsFiles(zipBytes, handlers) {
  const uz = new Unzip();
  uz.register(UnzipInflate);
  uz.onfile = (file) => {
    const name = file.name.split('/').pop().toLowerCase();
    const handle = handlers[name];
    if (!handle) return;
    const decoder = new TextDecoder('utf-8');
    let rest = '';
    let header = null;
    const line = (text) => {
      if (!text.trim()) return;
      const fields = parseCsvLine(text.replace(/\r$/, ''));
      if (!header) {
        header = fields.map((f) => f.replace(/^﻿/, '').trim());
        return;
      }
      const row = {};
      header.forEach((h, i) => (row[h] = fields[i] ?? ''));
      handle(row);
    };
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      const text = rest + decoder.decode(chunk, { stream: !final });
      const lines = text.split('\n');
      rest = final ? '' : lines.pop();
      for (const l of lines) line(l);
    };
    file.start();
  };
  uz.push(zipBytes, true);
}

const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const gtfsDate = (d) => d.replaceAll('-', '');

// Oblast Zlína a Otrokovic: spoje MHD DSZO mají zastávky jen tady.
export const ZLIN_BBOX = { minLon: 17.45, maxLon: 17.85, minLat: 49.14, maxLat: 49.32 };
const inBbox = (lat, lon, b) => lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat;

/** Název zastávky jako v datech DSZO: bez „Zlín,“ na začátku. */
export function displayStopName(name) {
  return name.replace(/^Zlín\s*,\s*/i, '').trim();
}

/**
 * Z GTFS vybere linky DSZO a převede je do stejné podoby jako buildTimetables z JDF.
 * Každá varianta trasy navíc nese coords (polohy zastávek) a shape (tvar trasy z shapes.txt, pokud je).
 */
export function buildFromGtfs(zipBytes, { startDate, days = 120, bbox = ZLIN_BBOX, log = () => {} } = {}) {
  const agencies = [];
  const routes = new Map();
  const trips = new Map();
  const services = new Map(); // service_id -> { days:[7], start, end, add:Set, remove:Set }
  const stops = new Map();

  const service = (id) => {
    if (!services.has(id)) services.set(id, { week: null, start: null, end: null, add: new Set(), remove: new Set() });
    return services.get(id);
  };

  readGtfsFiles(zipBytes, {
    'agency.txt': (r) => agencies.push(r),
    'routes.txt': (r) => routes.set(r.route_id, r),
    'trips.txt': (r) => trips.set(r.trip_id, r),
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
    'stops.txt': (r) => stops.set(r.stop_id, { name: r.stop_name, lat: Number(r.stop_lat), lon: Number(r.stop_lon) }),
  });

  log(`GTFS: dopravci ${agencies.map((a) => `${a.agency_id}=${a.agency_name}`).slice(0, 30).join('; ')}`);
  log(`GTFS: ${routes.size} linek, ${trips.size} spojů, ${stops.size} zastávek, ${services.size} kalendářů`);

  // Linky DSZO: podle dopravce, jinak všechny linky s jedno- a dvoumístným číslem (ověříme podle oblasti).
  const dszoAgencies = new Set(agencies.filter((a) => /dszo|dopravní společnost zlín/i.test(a.agency_name)).map((a) => a.agency_id));
  const candidate = (r) =>
    dszoAgencies.size
      ? dszoAgencies.has(r.agency_id) || (dszoAgencies.size === agencies.length)
      : /^\d{1,2}$/.test(r.route_short_name.trim());
  const routeIds = new Set([...routes.values()].filter(candidate).map((r) => r.route_id));
  log(`GTFS: dopravce DSZO ${dszoAgencies.size ? [...dszoAgencies].join(',') : 'nenalezen'}, kandidátů linek ${routeIds.size}`);

  const tripStops = new Map();
  const neededShapes = new Set();
  for (const [id, t] of trips) {
    if (!routeIds.has(t.route_id)) continue;
    tripStops.set(id, []);
    if (t.shape_id) neededShapes.add(t.shape_id);
  }

  const shapes = new Map();
  readGtfsFiles(zipBytes, {
    'stop_times.txt': (r) => {
      const list = tripStops.get(r.trip_id);
      if (!list) return;
      const time = toMinutes(r.departure_time) ?? toMinutes(r.arrival_time);
      if (time == null) return;
      list.push({ seq: Number(r.stop_sequence), stop: r.stop_id, time });
    },
    'shapes.txt': (r) => {
      if (!neededShapes.has(r.shape_id)) return;
      if (!shapes.has(r.shape_id)) shapes.set(r.shape_id, []);
      shapes.get(r.shape_id).push([Number(r.shape_pt_sequence), Number(r.shape_pt_lon), Number(r.shape_pt_lat)]);
    },
  });

  // Ověření oblasti: linka musí mít většinu zastavení v Zlíně a Otrokovicích.
  const inside = new Map();
  for (const [id, list] of tripStops) {
    const routeId = trips.get(id).route_id;
    const c = inside.get(routeId) ?? { in: 0, all: 0 };
    for (const s of list) {
      const st = stops.get(s.stop);
      c.all++;
      if (st && inBbox(st.lat, st.lon, bbox)) c.in++;
    }
    inside.set(routeId, c);
  }
  const accepted = new Set([...inside].filter(([, c]) => c.all && c.in / c.all >= 0.8).map(([id]) => id));
  log(`GTFS: linek v oblasti Zlín–Otrokovice ${accepted.size}: ${[...accepted].map((id) => routes.get(id).route_short_name).join(', ')}`);

  // Dny provozu.
  const dates = [];
  const start = Date.parse(`${startDate}T00:00:00Z`);
  for (let i = 0; i < days; i++) dates.push(new Date(start + i * 86400000).toISOString().slice(0, 10));
  const maskCache = new Map();
  const maskOf = (serviceId) => {
    if (maskCache.has(serviceId)) return maskCache.get(serviceId);
    const s = services.get(serviceId);
    const mask = dates
      .map((d) => {
        if (!s) return '0';
        const g = gtfsDate(d);
        if (s.remove.has(g)) return '0';
        if (s.add.has(g)) return '1';
        if (!s.week || g < s.start || g > s.end) return '0';
        const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
        return s.week[dow] ? '1' : '0';
      })
      .join('');
    maskCache.set(serviceId, mask);
    return mask;
  };

  const stopNames = [];
  const nameIndex = new Map();
  const idx = (stopId) => {
    const name = displayStopName(stops.get(stopId)?.name ?? stopId);
    if (!nameIndex.has(name)) {
      nameIndex.set(name, stopNames.length);
      stopNames.push(name);
    }
    return nameIndex.get(name);
  };

  const anyTrolley = [...accepted].some((id) => ['11', '800'].includes(routes.get(id).route_type));
  const result = new Map();
  // Každý spoj tak, jak jede (pořadí zastávek ze stop_times), pro vyhledávání spojení.
  const rawTrips = [];
  for (const [id, list] of tripStops) {
    const trip = trips.get(id);
    if (!accepted.has(trip.route_id) || list.length < 2) continue;
    const route = routes.get(trip.route_id);
    const ref = route.route_short_name.trim();
    const mask = maskOf(trip.service_id);
    if (!mask.includes('1')) continue;
    list.sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < list.length; i++) while (list[i].time < list[i - 1].time) list[i].time += 1440;
    // Bez typu trolejbus v datech: trolejbusové linky DSZO mají čísla do 29.
    const type = ['11', '800'].includes(route.route_type) || (!anyTrolley && Number(ref) < 30) ? 'trolleybus' : 'bus';
    const entry = result.get(ref) ?? { ref, type, name: route.route_long_name || '', dirs: { A: [], B: [] } };
    result.set(ref, entry);
    rawTrips.push({
      ref,
      type,
      mask,
      times: list.map((s) => s.time),
      stops: list.map((s) => {
        const st = stops.get(s.stop);
        return [displayStopName(st?.name ?? s.stop), st?.lat ?? null, st?.lon ?? null];
      }),
    });
    const dir = trip.direction_id === '1' ? 'B' : 'A';
    entry.dirs[dir].push({
      stops: list.map((s) => idx(s.stop)),
      times: list.map((s) => s.time),
      mask,
      shape: trip.shape_id || null,
      coords: list.map((s) => {
        const st = stops.get(s.stop);
        return st ? [st.lat, st.lon] : null;
      }),
    });
  }

  const lines = assembleLines(result, stopNames);
  // Tvary tras: body seřazené podle pořadí, jako [lon, lat].
  for (const line of lines) {
    for (const d of line.directions) {
      for (const v of d.variants) {
        const pts = v.shape && shapes.get(v.shape);
        v.shape = pts ? pts.sort((a, b) => a[0] - b[0]).map((p) => [p[1], p[2]]) : null;
      }
    }
  }
  log(`GTFS: tvary tras ${shapes.size ? 'jsou' : 'chybí'} (${shapes.size})`);
  return { startDate, days, stopNames, lines, rawTrips };
}

