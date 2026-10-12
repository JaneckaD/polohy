// Autobusy celé oblasti mimo IDZK, pro vyhledávání spojení (a mapu):
//  - regionální linky IDS JMK z otevřených dat KORDIS JMK (GTFS), bez MHD měst,
//  - ostatní regionální, dálkové a mezinárodní linky s aspoň dvěma zastávkami v oblasti z celostátních
//    jízdních řádů CIS JŘ převedených do GTFS (data.jr.ggu.cz). Spoje, které už jsou v datech z IDZK
//    nebo IDS JMK (stejné časy na stejných místech), se přeskočí.
// Výstup jsou rawTrips pro buildPlannerFromTrips: { ref, type: 'bus', city, number, mask, times, stops, headsign, operator }.
import { readGtfsFiles } from './gtfs-lib.mjs';
import { regionContains } from '../src/region.js';

export const KORDIS_GTFS_URL = 'https://kordis-jmk.cz/gtfs/gtfs.zip';
export const NATIONAL_GTFS_URL = 'https://data.jr.ggu.cz/results/latest/JDF_merged_GTFS.zip';

const toMinutes = (t) => {
  const m = /^(\d{1,3}):(\d{2})/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Kalendáře GTFS → maska dnů provozu od startDate ('0110…'). */
function calendars(startDate, days) {
  const services = new Map();
  const service = (id) => {
    if (!services.has(id)) services.set(id, { week: null, start: null, end: null, add: new Set(), remove: new Set() });
    return services.get(id);
  };
  const dates = [];
  const start = Date.parse(`${startDate}T00:00:00Z`);
  for (let i = 0; i < days; i++) dates.push(new Date(start + i * 86400000).toISOString().slice(0, 10).replaceAll('-', ''));
  const dows = dates.map((g) => (new Date(`${g.slice(0, 4)}-${g.slice(4, 6)}-${g.slice(6)}T00:00:00Z`).getUTCDay() + 6) % 7);
  const cache = new Map();
  return {
    handlers: {
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
    },
    mask(id) {
      if (cache.has(id)) return cache.get(id);
      const s = services.get(id);
      const mask = dates
        .map((g, i) => {
          if (!s || s.remove.has(g)) return '0';
          if (s.add.has(g)) return '1';
          if (!s.week || g < s.start || g > s.end) return '0';
          return s.week[dows[i]] ? '1' : '0';
        })
        .join('');
      cache.set(id, mask);
      return mask;
    },
  };
}

/** Časy v minutách popořadě (po půlnoci dál než 24:00). */
function minutes(rows) {
  const dep = rows.map((r) => toMinutes(r.departure_time) ?? toMinutes(r.arrival_time));
  if (dep.some((t) => t == null)) return null;
  for (let i = 1; i < dep.length; i++) while (dep[i] < dep[i - 1]) dep[i] += 1440;
  return dep;
}

/** Krátký název dopravce: „ČSAD Hodonín a.s.“ → „ČSAD Hodonín“. */
export function shortAgency(name) {
  return String(name ?? '')
    .replace(/,?\s*(spol\.\s*s\s*r\.\s*o\.|s\.\s*r\.\s*o\.|a\.\s*s\.|k\.\s*s\.|v\.\s*o\.\s*s\.|sp\.\s*z\s*o\.\s*o\.|s\.r\.l\.?|gmbh|llc|ltd\.?|příspěvková organizace)\s*\.?$/i, '')
    .replace(/,\s*$/, '')
    .trim();
}

/** Název zastávky z JDF jako v datech IDZK: „Brno,,ÚAN Zvonařka“ → „Brno,ÚAN Zvonařka“, Zlín bez obce. */
export function jdfStopName(name) {
  return String(name ?? '')
    .replace(/\s*,\s*(,\s*)+/g, ',')
    .replace(/,\s*$/, '')
    .replace(/^Zlín\s*,\s*/i, '')
    .trim();
}

// Linky MHD Brna v IDS JMK: čísla do 99, noční (N), expresní (E), náhradní (x9) a školní (š) linky.
const BRNO_MHD = /^(\d{1,2}|N\d+|E\d+|x\d{1,2}|š\d+|P\d+)$/i;
// Brněnské zóny IDS JMK (zastávky v Brně mají v datech název bez obce).
const BRNO_ZONES = new Set(['100', '101']);

/**
 * Regionální autobusy IDS JMK (GTFS KORDIS JMK). MHD měst se pozná podle čísla (Brno) nebo tak,
 * že všechny zastávky linky jsou v jedné obci.
 */
export function kordisTrips(zipBytes, { startDate, days, log = () => {} }) {
  const routes = new Map();
  const trips = new Map();
  const stops = new Map();
  const cal = calendars(startDate, days);
  readGtfsFiles(zipBytes, {
    'routes.txt': (r) => r.route_type === '3' && !BRNO_MHD.test(r.route_short_name.trim()) && routes.set(r.route_id, r),
    'trips.txt': (r) => routes.has(r.route_id) && trips.set(r.trip_id, r),
    'stops.txt': (r) => stops.set(r.stop_id, r),
    ...cal.handlers,
  });
  const times = new Map();
  readGtfsFiles(zipBytes, {
    'stop_times.txt': (r) => {
      if (!trips.has(r.trip_id)) return;
      if (!times.has(r.trip_id)) times.set(r.trip_id, []);
      times.get(r.trip_id).push(r);
    },
  });
  const brno = (s) => String(s?.zone_id ?? '').split(/[,;\s]+/).some((z) => BRNO_ZONES.has(z));
  const stopName = (s) => {
    const name = (s?.stop_name ?? '').trim();
    return brno(s) && !/^Brno\b/i.test(name) ? `Brno, ${name}` : name;
  };
  const town = (s) => (brno(s) ? 'Brno' : stopName(s).split(',')[0].trim());

  const out = [];
  const towns = new Map(); // route_id → obce
  for (const [id, list] of times) {
    const trip = trips.get(id);
    const route = routes.get(trip.route_id);
    if (list.length < 2) continue;
    const mask = cal.mask(trip.service_id);
    if (!mask.includes('1')) continue;
    list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const dep = minutes(list);
    if (!dep) continue;
    const st = list.map((r) => stops.get(r.stop_id));
    if (!towns.has(route.route_id)) towns.set(route.route_id, new Set());
    for (const s of st) towns.get(route.route_id).add(town(s));
    out.push({
      route: route.route_id,
      ref: route.route_short_name.trim(),
      type: 'bus',
      city: 'jmk',
      number: (trip.trip_short_name ?? '').trim() || null,
      mask,
      times: dep,
      stops: st.map((s, i) => [stopName(s) || list[i].stop_id, s ? Number(s.stop_lat) : null, s ? Number(s.stop_lon) : null]),
    });
  }
  const cityLines = new Set([...towns].filter(([, t]) => t.size === 1).map(([r]) => r));
  const regional = out.filter((t) => !cityLines.has(t.route));
  for (const t of regional) delete t.route;
  const cityRefs = [...new Set([...cityLines].map((r) => routes.get(r)?.route_short_name))].sort();
  log(`IDS JMK: ${regional.length} spojů regionálních linek (${new Set(regional.map((t) => t.ref)).size} linek), vynechané MHD měst: ${cityRefs.join(', ') || '—'}`);
  log(`IDS JMK ukázka zastávek: ${[...new Set(regional.slice(0, 40).flatMap((t) => t.stops.map((s) => s[0])))].slice(0, 25).join(' | ')}`);
  return regional;
}

// Klíč „čas + místo“ zastavení spoje (místo jako čtverec asi 2 × 2 km), podle něj poznáme spoj,
// který už v datech je z jiného zdroje (názvy zastávek se mezi zdroji liší).
const eventKey = (time, lat, lon) => `${time}|${Math.round(lat * 50)}|${Math.round(lon * 30)}`;

/** Zastavení spojů, které už v datech jsou (pro vynechání duplicit). */
export function knownEvents(rawTrips) {
  const set = new Set();
  for (const t of rawTrips) {
    if (t.type === 'train') continue;
    t.stops.forEach(([, lat, lon], i) => lat != null && set.add(eventKey(t.times[i] % 1440, lat, lon)));
  }
  return set;
}

// Druhy linek v celostátních datech (GTFS route_type): 701 regionální, 202 dálková, 201 mezinárodní.
// 704 (městská), 800 (trolejbus) a 900 (tramvaj) jsou MHD a zatím je nebereme.
const NATIONAL_TYPES = new Set(['701', '202', '201']);

/** Síť dálkového spoje podle dopravce (FlixBus a RegioJet mají na mapě vlastní vozy). */
function coachNetwork(agency) {
  if (/flixbus/i.test(agency)) return 'flix';
  if (/student agency|regiojet/i.test(agency)) return 'rj';
  return 'coach';
}

/**
 * Ostatní regionální, dálkové a mezinárodní autobusy z celostátních dat. Velký balík (přes 1 GB
 * zastavení) se čte proudově: spoje se drží jen, pokud mají aspoň dvě zastávky v oblasti.
 * Spoje se zkrátí na zastávky v oblasti, cíl (headsign) zůstane skutečný.
 */
export function nationalTrips(zipBytes, { startDate, days, region, known = new Set(), log = () => {} }) {
  const agencies = new Map();
  const routes = new Map();
  const trips = new Map();
  const stops = new Map();
  const cal = calendars(startDate, days);
  readGtfsFiles(zipBytes, {
    'agency.txt': (r) => agencies.set(r.agency_id, r.agency_name),
    'routes.txt': (r) => NATIONAL_TYPES.has(r.route_type) && routes.set(r.route_id, r),
    'stops.txt': (r) => {
      const lat = Number(r.stop_lat);
      const lon = Number(r.stop_lon);
      const ok = Number.isFinite(lat) && lat !== 0;
      stops.set(r.stop_id, { name: jdfStopName(r.stop_name), lat: ok ? lat : null, lon: ok ? lon : null, in: ok && regionContains(region, lon, lat) });
    },
    ...cal.handlers,
  });
  readGtfsFiles(zipBytes, {
    'trips.txt': (r) => routes.has(r.route_id) && trips.set(r.trip_id, r),
  });
  const kept = new Map();
  let current = null;
  let buffer = [];
  let regrouped = 0;
  const flush = () => {
    if (!current) return;
    let inside = 0;
    for (const r of buffer) if (stops.get(r.stop_id)?.in) inside++;
    if (inside >= 2) {
      if (kept.has(current)) {
        kept.get(current).push(...buffer);
        regrouped++;
      } else kept.set(current, buffer);
    }
    buffer = [];
  };
  readGtfsFiles(zipBytes, {
    'stop_times.txt': (r) => {
      if (r.trip_id !== current) {
        flush();
        current = trips.has(r.trip_id) ? r.trip_id : null;
      }
      if (current) buffer.push({ stop_id: r.stop_id, stop_sequence: r.stop_sequence, arrival_time: r.arrival_time, departure_time: r.departure_time });
    },
  });
  flush();

  const out = [];
  let duplicates = 0;
  const kinds = { 701: 0, 202: 0, 201: 0 };
  for (const [id, list] of kept) {
    const trip = trips.get(id);
    const route = routes.get(trip.route_id);
    const mask = cal.mask(trip.service_id);
    if (!mask.includes('1')) continue;
    list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const dep = minutes(list);
    if (!dep) continue;
    const all = list.map((r) => stops.get(r.stop_id));
    const idx = all.map((s, i) => (s?.in ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) continue;
    // Spoj už je v datech z IDZK nebo IDS JMK: většina zastavení v oblasti sedí časem i místem.
    const same = idx.filter((i) => known.has(eventKey(dep[i] % 1440, all[i].lat, all[i].lon))).length;
    if (same >= idx.length * 0.6) {
      duplicates++;
      continue;
    }
    const agency = agencies.get(route.agency_id) ?? '';
    const regional = route.route_type === '701';
    kinds[route.route_type]++;
    out.push({
      ref: route.route_short_name.trim(),
      type: 'bus',
      city: regional ? 'other' : coachNetwork(agency),
      number: (trip.trip_short_name ?? '').trim().split(/\s+/).at(-1) || null,
      mask,
      times: idx.map((i) => dep[i]),
      stops: idx.map((i) => [all[i].name, all[i].lat, all[i].lon]),
      headsign: all.at(-1)?.name ?? null,
      operator: shortAgency(agency),
      international: route.route_type === '201',
    });
  }
  log(`Celostátní data: regionální ${kinds[701]}, dálkové ${kinds[202]}, mezinárodní ${kinds[201]} spojů v oblasti; už v datech (přeskočeno) ${duplicates}${regrouped ? `, rozdělené spoje ${regrouped}` : ''}.`);
  const byOperator = {};
  for (const t of out) byOperator[t.operator] = (byOperator[t.operator] ?? 0) + 1;
  log(`Dopravci: ${Object.entries(byOperator).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(', ')}`);
  return out;
}
