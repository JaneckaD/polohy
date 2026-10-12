// Autobusy celé oblasti mimo IDZK, pro vyhledávání spojení (a mapu):
//  - všechny linky IDS JMK z otevřených dat KORDIS JMK (GTFS): regionální, MHD Brna i ostatních měst,
//  - ostatní regionální, dálkové a mezinárodní linky s aspoň dvěma zastávkami v oblasti z celostátních
//    jízdních řádů CIS JŘ převedených do GTFS (data.jr.ggu.cz). Spoje, které už jsou v datech z IDZK
//    nebo IDS JMK (stejné časy na stejných místech), se přeskočí.
// Výstup jsou rawTrips pro buildPlannerFromTrips: { ref, type: 'bus', city, number, mask, times, stops, headsign, operator }.
import { readGtfsFiles } from './gtfs-lib.mjs';
import { regionContains, krajOf } from '../src/region.js';
import { CARRIERS } from '../src/cities.js';

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
  // V cílové zastávce příjezd: odjezd tam bývá až další jízda vozu (tramvaj čeká na konečné).
  const dep = rows.map((r, i) => (i === rows.length - 1 ? toMinutes(r.arrival_time) ?? toMinutes(r.departure_time) : toMinutes(r.departure_time) ?? toMinutes(r.arrival_time)));
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
// Druhy linek v GTFS KORDIS: 0 tramvaj, 800 trolejbus, 3 autobus (2 vlaky a 4 lodě nebereme, vlaky jsou z dat SŽ).
const KORDIS_TYPES = { 0: 'tram', 800: 'trolleybus', 11: 'trolleybus', 3: 'bus' };

/** Uzel zastávky KORDIS („U1234Z2“ → 1234): stejné číslo posílají živé polohy IDS JMK (LastStopID). */
export const kordisNode = (stopId) => Number(/^U(\d+)/.exec(stopId ?? '')?.[1]) || null;

/**
 * Všechny linky IDS JMK (GTFS KORDIS JMK): regionální autobusy (síť jmk), MHD Brna – tramvaje, trolejbusy
 * a autobusy (síť brno) a MHD ostatních měst (síť jmkmhd, „MHD Znojmo“ jako dopravce). MHD Brna se pozná
 * podle druhu a čísla linky, MHD jiného města tak, že všechny zastávky linky jsou v jedné obci.
 */
export function kordisTrips(zipBytes, { startDate, days, log = () => {} }) {
  const routes = new Map();
  const trips = new Map();
  const stops = new Map();
  const agencies = new Map();
  const cal = calendars(startDate, days);
  readGtfsFiles(zipBytes, {
    'agency.txt': (r) => agencies.set(r.agency_id, shortAgency(r.agency_name)),
    'routes.txt': (r) => KORDIS_TYPES[r.route_type] && routes.set(r.route_id, r),
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
  const brnoLine = (route) => KORDIS_TYPES[route.route_type] !== 'bus' || BRNO_MHD.test(route.route_short_name.trim());

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
    const agency = agencies.get(route.agency_id);
    out.push({
      route: route.route_id,
      ref: route.route_short_name.trim(),
      type: KORDIS_TYPES[route.route_type],
      city: brnoLine(route) ? 'brno' : 'jmk',
      number: null,
      mask,
      times: dep,
      stops: st.map((s, i) => [stopName(s) || list[i].stop_id, s ? Number(s.stop_lat) : null, s ? Number(s.stop_lon) : null]),
      nodes: list.map((r) => kordisNode(r.stop_id)),
      ...(agency && !/KORDIS/i.test(agency) ? { operator: agency } : {}),
    });
  }
  // MHD ostatních měst: všechny zastávky linky v jedné obci (Brno je síť brno).
  const cityTown = new Map([...towns].filter(([, t]) => t.size === 1 && !t.has('Brno')).map(([r, t]) => [r, [...t][0]]));
  for (const t of out) {
    if (t.city === 'jmk' && cityTown.has(t.route)) {
      t.city = 'jmkmhd';
      t.operator = `MHD ${cityTown.get(t.route)}`;
    }
    delete t.route;
  }
  const count = (c) => out.filter((t) => t.city === c);
  const lines = (list) => new Set(list.map((t) => t.ref)).size;
  const [reg, br, mhd] = ['jmk', 'brno', 'jmkmhd'].map(count);
  log(`IDS JMK: ${reg.length} spojů regionálních linek (${lines(reg)} linek), MHD Brno ${br.length} spojů (${lines(br)} linek: tramvaje ${br.filter((t) => t.type === 'tram').length}, trolejbusy ${br.filter((t) => t.type === 'trolleybus').length} spojů), MHD dalších měst ${mhd.length} spojů (${[...new Set(mhd.map((t) => t.operator))].join(', ') || '—'}).`);
  log(`IDS JMK dopravci: ${[...new Set(out.map((t) => t.operator).filter(Boolean))].slice(0, 40).join(', ')}`);
  return out;
}

// Klíč „čas + místo“ zastavení spoje (místo jako čtverec asi 2 × 2 km), podle něj poznáme spoj,
// který už v datech je z jiného zdroje (názvy zastávek se mezi zdroji liší).
export const eventKey = (time, lat, lon) => `${time}|${Math.round(lat * 50)}|${Math.round(lon * 30)}`;

/** Zastavení spojů, které už v datech jsou (pro vynechání duplicit). */
export function knownEvents(rawTrips) {
  const set = new Set();
  for (const t of rawTrips) {
    // Jen regionální linky: MHD jezdí tak hustě, že by „časem a místem“ sedělo i na dálkové autobusy.
    if (t.type === 'train' || !(t.city in CARRIERS)) continue;
    t.stops.forEach(([, lat, lon], i) => lat != null && set.add(eventKey(t.times[i] % 1440, lat, lon)));
  }
  return set;
}

// Druhy linek v celostátních datech (GTFS route_type): 701 regionální, 202 dálková, 201 mezinárodní,
// 704 městská (autobus), 800 trolejbus, 900 tramvaj. MHD bereme jen v krajích bez vlastních dat
// (Olomoucký a Moravskoslezský kraj); MHD Zlínského kraje je z IDZK a DSZO, Jihomoravského z KORDIS.
const NATIONAL_TYPES = new Set(['701', '202', '201', '704', '800', '900']);
const MHD_TYPES = { 704: 'bus', 800: 'trolleybus', 900: 'tram' };
const MHD_KRAJE = new Set(['olk', 'msk']);
// Městské dopravní podniky: jejich MHD (i tramvaje a trolejbusy) je ze Spojenky, ostatní MHD a regionální
// linky z celostátních dat (licence a čísla spojů sedí na živé polohy ODIS).
const CITY_DP = /dopravní podnik/i;

/** Síť dálkového spoje podle dopravce (FlixBus a RegioJet mají na mapě vlastní vozy). */
function coachNetwork(agency) {
  if (/flixbus/i.test(agency)) return 'flix';
  if (/student agency|regiojet/i.test(agency)) return 'rj';
  return 'coach';
}

/** Město linky MHD: „MHD Krnov nemocnice…“ → Krnov; první obec v názvu linky, která je mezi obcemi zastávek; jinak nejčastější obec. */
export function mhdTown(longName, towns) {
  const name = String(longName ?? '').trim();
  const mhd = /^MHD\s+(.+?)(?:\s+[a-zá-ž].*)?$/u.exec(name)?.[1];
  if (mhd && towns.includes(mhd)) return mhd;
  if (mhd) return towns.find((t) => mhd.startsWith(t)) ?? mhd.split(/\s+/)[0];
  // Název linky začíná obcí („Frýdek-Místek-Staré Město-…“, „Havířov,Šumbark,…“): nejdelší taková obec.
  const first = towns.filter((t) => name.startsWith(t)).sort((a, b) => b.length - a.length)[0];
  return first ?? towns[0] ?? null;
}

/**
 * Ostatní regionální, dálkové a mezinárodní autobusy z celostátních dat. Velký balík (přes 1 GB
 * zastavení) se čte proudově: spoje se drží jen, pokud mají aspoň dvě zastávky v oblasti.
 * Spoje se zkrátí na zastávky v oblasti, cíl (headsign) zůstane skutečný.
 */
export function nationalTrips(zipBytes, { startDate, days, region, known = new Set(), skipKraje = null, coords = null, log = () => {} }) {
  const agencies = new Map();
  const routes = new Map();
  const trips = new Map();
  const stops = new Map();
  let filled = 0;
  const cal = calendars(startDate, days);
  readGtfsFiles(zipBytes, {
    'agency.txt': (r) => agencies.set(r.agency_id, r.agency_name),
    'routes.txt': (r) => NATIONAL_TYPES.has(r.route_type) && routes.set(r.route_id, r),
    'stops.txt': (r) => {
      const name = jdfStopName(r.stop_name);
      let lat = Number(r.stop_lat);
      let lon = Number(r.stop_lon);
      // Zastávky bez polohy (část Olomouckého kraje) podle stejně pojmenované zastávky Spojenky.
      if ((!Number.isFinite(lat) || lat === 0) && coords?.has(name)) {
        [lat, lon] = coords.get(name);
        filled++;
      }
      const ok = Number.isFinite(lat) && lat !== 0;
      const inside = ok && regionContains(region, lon, lat);
      stops.set(r.stop_id, { name, lat: ok ? lat : null, lon: ok ? lon : null, in: inside, kraj: inside ? krajOf(region, lon, lat) : null });
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
  let otherMhd = 0;
  let skipped = 0;
  const skippedBy = {};
  const kinds = { 701: 0, 202: 0, 201: 0, 704: 0, 800: 0, 900: 0 };
  const routeTowns = new Map(); // route_id → četnost obcí zastávek (MHD: „MHD Ostrava“)
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
    const mhd = MHD_TYPES[route.route_type];
    const agency = agencies.get(route.agency_id) ?? '';
    // MHD dopravních podniků (Ostrava, Olomouc, Opava) je z dat Spojenky (spojenkaTrips) i s tramvajemi.
    if (skipKraje && mhd && CITY_DP.test(agency) && idx.filter((i) => skipKraje.has(all[i].kraj)).length * 2 >= idx.length) {
      skipped++;
      skippedBy[agency] = (skippedBy[agency] ?? 0) + 1;
      continue;
    }
    if (mhd) {
      // MHD jen v Olomouckém a Moravskoslezském kraji (jinde ji máme z IDZK, DSZO a KORDIS).
      if (idx.filter((i) => MHD_KRAJE.has(all[i].kraj)).length * 2 < idx.length) {
        otherMhd++;
        continue;
      }
      if (!routeTowns.has(route.route_id)) routeTowns.set(route.route_id, new Map());
      const towns = routeTowns.get(route.route_id);
      for (const i of idx) {
        const town = all[i].name.split(',')[0].trim();
        towns.set(town, (towns.get(town) ?? 0) + 1);
      }
    } else {
      // Spoj už je v datech z IDZK nebo IDS JMK: většina zastavení v oblasti sedí časem i místem.
      const same = idx.filter((i) => known.has(eventKey(dep[i] % 1440, all[i].lat, all[i].lon))).length;
      if (same >= idx.length * 0.6) {
        duplicates++;
        continue;
      }
    }
    const regional = route.route_type === '701';
    kinds[route.route_type]++;
    out.push({
      ...(mhd ? { route: route.route_id } : {}),
      ref: route.route_short_name.trim(),
      type: mhd ?? 'bus',
      city: mhd ? 'town' : regional ? 'other' : coachNetwork(agency),
      number: (trip.trip_short_name ?? '').trim().split(/\s+/).at(-1) || null,
      mask,
      times: idx.map((i) => dep[i]),
      stops: idx.map((i) => [all[i].name, all[i].lat, all[i].lon]),
      headsign: all.at(-1)?.name ?? null,
      operator: shortAgency(agency),
      international: route.route_type === '201',
    });
  }
  // MHD: město podle názvu linky („MHD Krnov …“, „Havířov,Podlesí,aut.nádr.-Těrlicko…“), jinak podle
  // nejčastější obce zastávek linky („MHD Ostrava“).
  for (const t of out) {
    if (!t.route) continue;
    const towns = [...(routeTowns.get(t.route) ?? [])].sort((a, b) => b[1] - a[1]);
    const town = mhdTown(routes.get(t.route)?.route_long_name, towns.map(([name]) => name));
    if (town) t.operator = `MHD ${town}`;
    delete t.route;
  }
  log(`Celostátní data: regionální ${kinds[701]}, dálkové ${kinds[202]}, mezinárodní ${kinds[201]} spojů v oblasti; už v datech (přeskočeno) ${duplicates}${regrouped ? `, rozdělené spoje ${regrouped}` : ''}${skipKraje ? `, MHD dopravních podniků ze Spojenky přeskočeno ${skipped} (${Object.entries(skippedBy).map(([a, n]) => `${a} ${n}`).join(', ')})` : ''}${coords ? `, polohy zastávek ze Spojenky ${filled}` : ''}.`);
  const mhdOut = out.filter((t) => t.city === 'town');
  log(`MHD Olomouckého a Moravskoslezského kraje: ${mhdOut.length} spojů (autobusy ${kinds[704]}, trolejbusy ${kinds[800]}, tramvaje ${kinds[900]}); MHD jinde přeskočeno ${otherMhd}. Města: ${[...new Set(mhdOut.map((t) => t.operator))].join(', ')}`);
  const byOperator = {};
  for (const t of out) byOperator[t.operator] = (byOperator[t.operator] ?? 0) + 1;
  log(`Dopravci: ${Object.entries(byOperator).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(', ')}`);
  return out;
}

// --- Olomoucký a Moravskoslezský kraj: jízdní řády Spojenky ---------------------------------------------
// Celostátní data CIS JŘ (data.jr.ggu.cz) v těchto krajích nemají polohy části zastávek (celá MHD Olomouc)
// a vůbec v nich nejsou tramvaje Ostravy a Olomouce. Spojenka (MFF UK, www.spojenka.cz/jrdata, volně pro
// nekomerční užití) spojuje CIS JŘ s daty dopravních podniků a má polohy skoro všech zastávek.
export const SPOJENKA_GTFS_URL = 'https://www.spojenka.cz/jrdata/jizdnirady-gtfs.zip';
const SPOJENKA_TYPES = { 0: 'tram', 11: 'trolleybus', 800: 'trolleybus', 3: 'bus', 700: 'bus', 704: 'bus' };

/** Licence linky a číslo spoje z vazby na CIS JŘ („DPO:3870|SCC:915007:3870“ → ['915007', '3870']). */
export function cisRelation(relations) {
  const m = /(?:^|\|)SCC:(\d{6}):(\d+)/.exec(relations ?? '');
  return m ? [m[1], m[2]] : [null, null];
}

/** Název zastávky Spojenky jako v ostatních datech: „Ostrava, Přívoz, Palackého ul.“ → „Ostrava,Přívoz,Palackého ul.“. */
const spojenkaStopName = (name) => jdfStopName(String(name ?? '').replace(/\s*,\s*/g, ','));

/**
 * Autobusy, trolejbusy a tramvaje Olomouckého a Moravskoslezského kraje (regionální linky i MHD měst) ze Spojenky.
 * Bere spoje, jejichž zastávky v oblasti jsou většinou v krajích `kraje`; spoje, které už v datech jsou
 * (dálkové linky z celostátních dat, linky IDZK do kraje), se poznají podle časů a míst a přeskočí.
 */
export function spojenkaTrips(zipBytes, { startDate, days, region, kraje = MHD_KRAJE, log = () => {} }) {
  const agencies = new Map();
  const routes = new Map();
  const trips = new Map();
  const stops = new Map();
  const cal = calendars(startDate, days);
  readGtfsFiles(zipBytes, {
    'agency.txt': (r) => agencies.set(r.agency_id, r.agency_name),
    'routes.txt': (r) => SPOJENKA_TYPES[r.route_type] && routes.set(r.route_id, r),
    'stops.txt': (r) => {
      const lat = Number(r.stop_lat);
      const lon = Number(r.stop_lon);
      const ok = Number.isFinite(lat) && lat !== 0;
      const inside = ok && regionContains(region, lon, lat);
      stops.set(r.stop_id, { name: spojenkaStopName(r.stop_name), lat: ok ? lat : null, lon: ok ? lon : null, in: inside, kraj: inside ? krajOf(region, lon, lat) : null });
    },
    ...cal.handlers,
  });
  readGtfsFiles(zipBytes, {
    'trips.txt': (r) => routes.has(r.route_id) && trips.set(r.trip_id, r),
  });
  // Zastavení se čtou proudově po spojích; drží se jen spoje s aspoň dvěma zastávkami v krajích.
  const rows = new Map();
  let current = null;
  let buffer = [];
  const flush = () => {
    if (!current) return;
    let inside = 0;
    for (const r of buffer) if (kraje.has(stops.get(r.stop_id)?.kraj)) inside++;
    if (inside >= 2) {
      if (rows.has(current)) rows.get(current).push(...buffer);
      else rows.set(current, buffer);
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
  const routeTowns = new Map();
  let others = 0;
  let outside = 0;
  for (const [id, list] of rows) {
    const trip = trips.get(id);
    const route = routes.get(trip.route_id);
    const mask = cal.mask(trip.service_id);
    if (!mask.includes('1')) continue;
    list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const dep = minutes(list);
    if (!dep) continue;
    const all = list.map((r) => stops.get(r.stop_id));
    const idx = all.map((st, i) => (st?.in ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2 || idx.filter((i) => kraje.has(all[i].kraj)).length * 2 < idx.length) {
      outside++;
      continue;
    }
    const type = SPOJENKA_TYPES[route.route_type];
    const agency = agencies.get(route.agency_id) ?? '';
    // Jen MHD dopravních podniků (tramvaje, trolejbusy, autobusy DPO, DPMO, MDPO); ostatní linky jsou
    // z celostátních dat (příznak is_regional má Spojenka u všech linek 0, k rozlišení nejde použít).
    if (type === 'bus' && !CITY_DP.test(agency) && !/(?:^|\|)DPO:/.test(trip.relations ?? '')) {
      others++;
      continue;
    }
    const [licence, number] = cisRelation(trip.relations);
    if (!routeTowns.has(route.route_id)) routeTowns.set(route.route_id, new Map());
    const counts = routeTowns.get(route.route_id);
    for (const i of idx) {
      const town = all[i].name.split(',')[0].trim();
      counts.set(town, (counts.get(town) ?? 0) + 1);
    }
    out.push({
      route: route.route_id,
      ref: licence ?? route.route_short_name.trim(),
      type,
      city: 'town',
      number: number ?? ((trip.trip_short_name ?? '').trim() || null),
      mask,
      times: idx.map((i) => dep[i]),
      stops: idx.map((i) => [all[i].name, all[i].lat, all[i].lon]),
      headsign: (trip.trip_headsign ? spojenkaStopName(trip.trip_headsign) : null) ?? all.at(-1)?.name ?? null,
      operator: shortAgency(agency),
    });
  }
  for (const t of out) {
    // Město podle nejčastější obce zastávek linky (linky DPO mají v názvu jen části Ostravy).
    const towns = [...(routeTowns.get(t.route) ?? [])].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    if (towns[0]) t.operator = `MHD ${towns[0]}`;
    delete t.route;
  }
  const count = (f) => out.filter(f).length;
  log(`Spojenka (MHD dopravních podniků Olomouckého a Moravskoslezského kraje): ${out.length} spojů (tramvaje ${count((t) => t.type === 'tram')}, trolejbusy ${count((t) => t.type === 'trolleybus')}); ostatní linky (z celostátních dat) ${others}, mimo kraje ${outside}; s číslem spoje CIS JŘ ${count((t) => /^\d{6}$/.test(t.ref))}.`);
  const byOp = {};
  for (const t of out) byOp[t.operator] = (byOp[t.operator] ?? 0) + 1;
  log(`Spojenka dopravci a města: ${Object.entries(byOp).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(', ')}`);
  return out;
}

/** Polohy zastávek Spojenky v oblasti podle názvu (průměr nástupišť) pro zastávky celostátních dat bez polohy. */
export function spojenkaStopCoords(zipBytes, region) {
  const sum = new Map();
  readGtfsFiles(zipBytes, {
    'stops.txt': (r) => {
      const lat = Number(r.stop_lat);
      const lon = Number(r.stop_lon);
      if (!Number.isFinite(lat) || lat === 0 || !regionContains(region, lon, lat)) return;
      const name = spojenkaStopName(r.stop_name);
      const e = sum.get(name) ?? [0, 0, 0];
      sum.set(name, [e[0] + lat, e[1] + lon, e[2] + 1]);
    },
  });
  return new Map([...sum].map(([name, [la, lo, n]]) => [name, [Math.round((la / n) * 1e6) / 1e6, Math.round((lo / n) * 1e6) / 1e6]]));
}
