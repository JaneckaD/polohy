// Vykreslení trasy vybraného vozu: projetá část šedá, zbývající v barvě linky, zastávky s časy.
import { TYPE_COLORS, trainColors } from './colors.js';
import { isCarrier, isCoach } from './cities.js';
import { trainKind } from './trains.js';
import { findRoute, splitRoute, attachTimes, tripGeometry, splitTrip, currentTripIndex } from './route-match.js';
import { RailNetwork, railGeometry } from './railroute.js';
import { loadRails, styleReady } from './region.js';

let railNetPromise = null;
/** Síť tratí pro trasy vlaků (z rails.json), postavená jednou. */
function railNetwork() {
  railNetPromise ??= loadRails().then((r) => (r?.lines?.length ? new RailNetwork(r.lines) : null));
  return railNetPromise;
}

const SRC_LINE = 'route-line';
const SRC_STOPS = 'route-stops';

let routesPromise = null;

let busRoutesPromise = null;
/** Trasy regionálních autobusů (načtou se až při prvním výběru takového vozu nebo spoje). */
export function loadBusRoutes() {
  busRoutesPromise ??= fetch('./routes-bus.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d) => d?.routes ?? []);
  return busRoutesPromise;
}

export function loadRoutes() {
  routesPromise ??= fetch('./routes.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d) => d ?? { routes: [], stops: {} });
  return routesPromise;
}

const empty = { type: 'FeatureCollection', features: [] };

const SRC_FILTER = 'filter-routes';

/** Trasy linek vybraných ve filtru: tenká čára v barvě linky pod vozy. */
export function drawLineRoutes(map, routes) {
  if (!styleReady(map)) return;
  if (!map.getSource(SRC_FILTER)) {
    map.addSource(SRC_FILTER, { type: 'geojson', data: empty });
    map.addLayer(
      {
        id: 'filter-routes',
        type: 'line',
        source: SRC_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 4], 'line-opacity': 0.6 },
      },
      map.getLayer('route-casing') ? 'route-casing' : undefined,
    );
  }
  map.getSource(SRC_FILTER).setData({
    type: 'FeatureCollection',
    features: routes
      .filter((r) => r.line?.length > 1)
      .map((r) => lineFeature(r.line, (TYPE_COLORS[r.type] ?? TYPE_COLORS.bus).main, false, (TYPE_COLORS[r.type] ?? TYPE_COLORS.bus).casing)),
  });
}

function ensureLayers(map) {
  if (map.getSource(SRC_LINE)) return;
  map.addSource(SRC_LINE, { type: 'geojson', data: empty });
  map.addSource(SRC_STOPS, { type: 'geojson', data: empty });

  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: SRC_LINE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    // Žlutá trolejbusová čára potřebuje na bílé mapě tmavší okraj.
    paint: { 'line-color': ['get', 'casing'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 9] },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: SRC_LINE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 6],
      'line-opacity': 1,
    },
  });
  // Šipky ve směru jízdy na zbývající části trasy.
  map.addLayer({
    id: 'route-arrows',
    type: 'symbol',
    source: SRC_LINE,
    filter: ['!', ['get', 'passed']],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 70,
      'text-field': '›',
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12, 16, 20],
      'text-keep-upright': false,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-offset': [0, -0.1],
    },
    paint: { 'text-color': ['get', 'arrow'] },
  });
  // Zastávka jako plný korálek v barvě linky s malým bílým středem: z dálky nepřerušuje čáru.
  map.addLayer({
    id: 'route-stops',
    type: 'circle',
    source: SRC_STOPS,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 16, 7.5],
      'circle-color': ['get', 'stroke'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 1.5],
    },
  });
  map.addLayer({
    id: 'route-stops-center',
    type: 'circle',
    source: SRC_STOPS,
    minzoom: 13,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.2, 16, 3],
      'circle-color': '#ffffff',
    },
  });
  map.addLayer({
    id: 'route-stop-labels',
    type: 'symbol',
    source: SRC_STOPS,
    minzoom: 10,
    layout: {
      // Když se nevejdou všechny, přednost mají zastávky, kam vůz teprve pojede.
      'symbol-sort-key': ['case', ['get', 'passed'], 1, 0],
      'text-field': ['case', ['has', 'time'], ['concat', ['get', 'time'], '  ', ['get', 'name']], ['get', 'name']],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 11.5],
      'text-anchor': 'left',
      'text-offset': [0.9, 0],
      'text-max-width': 12,
      'text-optional': true,
    },
    paint: {
      'text-color': ['case', ['get', 'passed'], '#9a9a9a', '#333333'],
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
    },
  });
}

function lineFeature(coords, color, passed, casing = '#ffffff') {
  return { type: 'Feature', properties: { color, passed, casing }, geometry: { type: 'LineString', coordinates: coords } };
}

// Kusy trasy, které v předpočítaných trasách chybí, dopočítáme po silnicích (OSRM) a uložíme.
// Zastávka je jen bod, kolem kterého vůz projede (map matching do ~60 m), aby se trasa kvůli zastávce
// na druhé straně silnice neotáčela; když přiřazení selže, trasa přímo mezi zastávkami.
const OSRM = 'https://router.project-osrm.org';
const STORE = 'mhd.osrm2';
const osrmCache = new Map(Object.entries(readStore(STORE) ?? {}));

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

async function osrmJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function roadBetween(a, b) {
  const key = `${a[1].toFixed(5)},${a[0].toFixed(5)};${b[1].toFixed(5)},${b[0].toFixed(5)}`;
  if (osrmCache.has(key)) return osrmCache.get(key);
  let json = await osrmJson(`${OSRM}/match/v1/driving/${key}?overview=full&geometries=geojson&radiuses=20;20&gaps=ignore`);
  let found = json?.code === 'Ok' && json.matchings?.length === 1 ? json.matchings[0] : null;
  if (!found) {
    json = await osrmJson(`${OSRM}/route/v1/driving/${key}?overview=full&geometries=geojson`);
    found = json?.code === 'Ok' ? json.routes[0] : null;
  }
  if (!found && !json) return null; // bez sítě: zkusíme příště
  // Objížďka víc než trojnásobně delší než vzdušná čára je skoro jistě špatně.
  const direct = Math.hypot((a[1] - b[1]) * 72000, (a[0] - b[0]) * 111000);
  const ok = found && found.distance < Math.max(3 * direct, direct + 600) ? found.geometry.coordinates : null;
  osrmCache.set(key, ok);
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries([...osrmCache].slice(-300))));
    localStorage.removeItem('mhd.osrm');
  } catch {
    /* plné úložiště nevadí */
  }
  return ok;
}

const geoCache = new Map(); // klíč spoje -> Promise<geometrie>

async function geometryFor(trip, ref, train = false) {
  const key = `${train ? 'v' : ''}${ref}|${trip.map((s) => s.name).join('|')}`;
  if (!geoCache.has(key)) {
    geoCache.set(
      key,
      (async () => {
        // Vlak: po kolejích mezi stanicemi (mimo kraj koleje nemáme, tam čára není).
        if (train) return railGeometry(await railNetwork(), trip);
        let geo;
        if (trip.segments) {
          // Dálkový autobus: trasu po silnicích pošle dopravce rovnou po úsecích mezi zastávkami.
          geo = { names: trip.map((s) => s.name), coords: trip.map((s) => (s.lat != null ? [s.lat, s.lon] : null)), segments: trip.slice(1).map((s, i) => trip.segments[i] ?? null) };
        } else {
          const data = await loadRoutes();
          // MHD jiného města (ref „km:1“): jen trasy toho města a polohy zastávek ze spoje,
          // názvy zastávek se mezi městy opakují. Zlínské spoje trasy jiných měst nepoužijí.
          const city = /^(\w+):/.exec(ref ?? '')?.[1];
          const own = city && (isCarrier(city) || isCoach(city)) ? await loadBusRoutes() : data.routes;
          geo = city
            ? tripGeometry(trip, own.filter((r) => r.city === city), ref, {})
            : tripGeometry(trip, data.routes.filter((r) => !r.city), ref, data.stops);
          if (city) trip.forEach((s, i) => s.lat != null && (geo.coords[i] = [s.lat, s.lon]));
        }
        // Chybějící kusy (varianty spojů, které předpočítané trasy linek nepokrývají) dopočítáme
        // po silnici všechny, po čtyřech najednou, aby trasa nebyla přerušená. Rovné čáry nekreslíme.
        const missing = geo.segments.map((seg, i) => i).filter((i) => !geo.segments[i] && geo.coords[i] && geo.coords[i + 1]);
        for (let k = 0; k < missing.length; k += 4) {
          await Promise.all(
            missing.slice(k, k + 4).map(async (i) => {
              geo.segments[i] = await roadBetween(geo.coords[i], geo.coords[i + 1]);
            }),
          );
        }
        return geo;
      })(),
    );
    if (geoCache.size > 20) geoCache.delete(geoCache.keys().next().value);
  }
  return geoCache.get(key);
}

/** Spočítá trasu vozu. Vrací null, když ji nejde určit. */
export async function computeRoute(vehicle, trip, current) {
  const train = vehicle.type === 'train';
  if (trip?.length > 1) {
    // MHD jiných měst: trasy linek DSZO nepoužijeme (stejná čísla linek), jen silnice mezi zastávkami.
    const geo = await geometryFor(trip, vehicle.city ? `${vehicle.city}:${vehicle.line}` : vehicle.line, train);
    if (geo.segments.some(Boolean)) {
      return splitTrip(geo, { lat: vehicle.rawLat ?? vehicle.lat, lon: vehicle.rawLon ?? vehicle.lon }, current ?? currentTripIndex(trip, vehicle.stop), trip);
    }
  }
  if (train || vehicle.city) return null;
  // Než dorazí jízdní řád spoje (nebo když ho nemáme): trasa linky podle polohy a směru vozu.
  const data = await loadRoutes();
  const match = findRoute(data.routes, vehicle, trip);
  if (!match) return null;
  const split = splitRoute(match.route, match.proj);
  return { passedLines: [split.passedLine], upcomingLines: [split.upcomingLine], stops: attachTimes(split.stops, trip) };
}

export function drawRoute(map, route, type, colors = null) {
  if (!styleReady(map)) return; // styl mapy ještě není načtený, trasu nakreslíme při další obnově
  ensureLayers(map);
  const { main, passed, casing, stop, stopPassed } = colors ?? TYPE_COLORS[type] ?? TYPE_COLORS.bus;
  const lines = [];
  for (const l of route.passedLines) if (l.length > 1) lines.push(lineFeature(l, passed, true, '#ffffff'));
  for (const l of route.upcomingLines) if (l.length > 1) lines.push({ ...lineFeature(l, main, false, casing), properties: { color: main, passed: false, casing, arrow: type === 'trolleybus' ? '#1c1c1e' : '#ffffff' } });
  map.getSource(SRC_LINE).setData({ type: 'FeatureCollection', features: lines });
  map.getSource(SRC_STOPS).setData({
    type: 'FeatureCollection',
    features: route.stops.map((s) => ({
      type: 'Feature',
      properties: { name: s.name, passed: s.passed, color: s.passed ? passed : main, stroke: s.passed ? stopPassed : stop, ...(s.time ? { time: s.time } : {}) },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  });
}

export function clearRoute(map) {
  if (!map.getSource(SRC_LINE)) return;
  map.getSource(SRC_LINE).setData(empty);
  map.getSource(SRC_STOPS).setData(empty);
}

// --- Spojení z vyhledávání na mapě -------------------------------------------------
const SRC_JOURNEY = 'journey';

function ensureJourneyLayers(map) {
  if (map.getSource(SRC_JOURNEY)) return;
  map.addSource(SRC_JOURNEY, { type: 'geojson', data: empty });
  map.addLayer({
    id: 'journey-casing',
    type: 'line',
    source: SRC_JOURNEY,
    filter: ['==', ['get', 'kind'], 'ride'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'casing'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 10] },
  });
  map.addLayer({
    id: 'journey-line',
    type: 'line',
    source: SRC_JOURNEY,
    filter: ['==', ['get', 'kind'], 'ride'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 7] },
  });
  map.addLayer({
    id: 'journey-walk',
    type: 'line',
    source: SRC_JOURNEY,
    filter: ['==', ['get', 'kind'], 'walk'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#ff9500', 'line-width': 4, 'line-dasharray': [0.1, 2] },
  });
  map.addLayer({
    id: 'journey-stops',
    type: 'circle',
    source: SRC_JOURNEY,
    filter: ['==', ['get', 'kind'], 'stop'],
    paint: {
      'circle-radius': ['case', ['get', 'main'], 8, 4.5],
      'circle-color': ['get', 'stroke'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'journey-stops-center',
    type: 'circle',
    source: SRC_JOURNEY,
    filter: ['==', ['get', 'kind'], 'stop'],
    paint: { 'circle-radius': ['case', ['get', 'main'], 3.5, 1.5], 'circle-color': '#ffffff' },
  });
  map.addLayer({
    id: 'journey-labels',
    type: 'symbol',
    source: SRC_JOURNEY,
    filter: ['all', ['==', ['get', 'kind'], 'stop'], ['get', 'main']],
    layout: {
      'text-field': ['concat', ['get', 'time'], '  ', ['get', 'name']],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-anchor': 'left',
      'text-offset': [1, 0],
      'text-max-width': 14,
    },
    paint: { 'text-color': '#1c1c1e', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
}

const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;

/** Nakreslí spojení (jízdy po trasách linek, pěší přestupy tečkovaně). Vrací hranice pro přiblížení. */
export async function drawJourney(map, journey, P) {
  if (!styleReady(map)) return null;
  ensureJourneyLayers(map);
  const features = [];
  const pts = [];
  const point = (s, props) => {
    if (s.lat == null) return;
    pts.push([s.lon, s.lat]);
    features.push({ type: 'Feature', properties: { kind: 'stop', name: s.name, ...props }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } });
  };
  for (const leg of journey.legs) {
    if (leg.type === 'walk') {
      const a = leg.from >= 0 ? P.stops[leg.from] : null;
      const b = P.stops[leg.to];
      if (a?.lat != null && b.lat != null) {
        features.push({ type: 'Feature', properties: { kind: 'walk' }, geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } });
      }
      continue;
    }
    const pat = leg.trip.pattern;
    const type = pat.y === 'v' ? 'train' : pat.y === 't' ? 'trolleybus' : 'bus';
    const colors = type === 'train' ? trainColors(trainKind(pat.k)) : TYPE_COLORS[pat.c ?? type];
    const { main, casing } = colors;
    const stops = [];
    for (let k = leg.fromK; k <= leg.toK; k++) {
      const s = P.stops[pat.s[k]];
      const times = k === leg.toK ? leg.trip.arr : leg.trip.times;
      stops.push({ name: s.name, lat: s.lat, lon: s.lon, time: hhmm(times[k] - leg.shift) });
    }
    const geo = await geometryFor(stops, pat.c ? `${pat.c}:${pat.r}` : pat.r, type === 'train');
    for (const seg of geo.segments) {
      if (seg?.length > 1) {
        features.push({ type: 'Feature', properties: { kind: 'ride', color: main, casing: type === 'trolleybus' ? casing : '#ffffff' }, geometry: { type: 'LineString', coordinates: seg } });
        pts.push(...seg);
      }
    }
    const stroke = colors.stop;
    stops.forEach((s, i) => point(s, { main: i === 0 || i === stops.length - 1, stroke, time: s.time }));
  }
  map.getSource(SRC_JOURNEY).setData({ type: 'FeatureCollection', features });
  if (!pts.length) return null;
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

export function clearJourney(map) {
  map.getSource(SRC_JOURNEY)?.setData(empty);
}
