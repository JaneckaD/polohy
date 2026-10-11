// Vykreslení trasy vybraného vozu: projetá část šedá, zbývající v barvě linky, zastávky s časy.
import { TYPE_COLORS } from './colors.js';
import { findRoute, splitRoute, attachTimes, tripGeometry, splitTrip, currentTripIndex } from './route-match.js';

const SRC_LINE = 'route-line';
const SRC_STOPS = 'route-stops';

let routesPromise = null;

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
  if (!map.isStyleLoaded()) return;
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
  map.addLayer({
    id: 'route-stops',
    type: 'circle',
    source: SRC_STOPS,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 6],
      'circle-color': ['case', ['get', 'passed'], ['get', 'color'], '#ffffff'],
      'circle-stroke-color': ['get', 'stroke'],
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'route-stop-labels',
    type: 'symbol',
    source: SRC_STOPS,
    minzoom: 12.5,
    layout: {
      'text-field': ['case', ['has', 'time'], ['concat', ['get', 'time'], '  ', ['get', 'name']], ['get', 'name']],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
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
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const osrmCache = new Map(Object.entries(readStore('mhd.osrm') ?? {}));

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

async function roadBetween(a, b) {
  const key = `${a[1].toFixed(5)},${a[0].toFixed(5)};${b[1].toFixed(5)},${b[0].toFixed(5)}`;
  if (osrmCache.has(key)) return osrmCache.get(key);
  try {
    const res = await fetch(`${OSRM}${key}?overview=full&geometries=geojson`);
    const json = res.ok ? await res.json() : null;
    const line = json?.code === 'Ok' ? json.routes[0].geometry.coordinates : null;
    // Objížďka víc než dvakrát delší než vzdušná čára je skoro jistě špatně (zastávka na druhé straně ulice).
    const direct = Math.hypot((a[1] - b[1]) * 72000, (a[0] - b[0]) * 111000);
    const ok = line && json.routes[0].distance < Math.max(2.2 * direct, direct + 300) ? line : null;
    osrmCache.set(key, ok);
    try {
      localStorage.setItem('mhd.osrm', JSON.stringify(Object.fromEntries([...osrmCache].slice(-300))));
    } catch {
      /* plné úložiště nevadí */
    }
    return ok;
  } catch {
    return null;
  }
}

const geoCache = new Map(); // klíč spoje -> Promise<geometrie>

async function geometryFor(trip, ref) {
  const key = `${ref}|${trip.map((s) => s.name).join('|')}`;
  if (!geoCache.has(key)) {
    geoCache.set(
      key,
      (async () => {
        const data = await loadRoutes();
        const geo = tripGeometry(trip, data.routes, ref, data.stops);
        // Nejvýš pár chybějících kusů dopočítáme, zbytek zůstane bez čáry (rovné čáry nekreslíme).
        let budget = 6;
        for (let i = 0; i < geo.segments.length && budget > 0; i++) {
          if (geo.segments[i] || !geo.coords[i] || !geo.coords[i + 1]) continue;
          budget--;
          geo.segments[i] = await roadBetween(geo.coords[i], geo.coords[i + 1]);
        }
        return geo;
      })(),
    );
    if (geoCache.size > 20) geoCache.delete(geoCache.keys().next().value);
  }
  return geoCache.get(key);
}

/** Spočítá trasu vozu. Vrací null, když ji nejde určit. */
export async function computeRoute(vehicle, trip) {
  if (trip?.length > 1) {
    const geo = await geometryFor(trip, vehicle.line);
    if (geo.segments.some(Boolean)) {
      return splitTrip(geo, { lat: vehicle.rawLat ?? vehicle.lat, lon: vehicle.rawLon ?? vehicle.lon }, currentTripIndex(trip, vehicle.stop), trip);
    }
  }
  // Než dorazí jízdní řád spoje (nebo když ho nemáme): trasa linky podle polohy a směru vozu.
  const data = await loadRoutes();
  const match = findRoute(data.routes, vehicle, trip);
  if (!match) return null;
  const split = splitRoute(match.route, match.proj);
  return { passedLines: [split.passedLine], upcomingLines: [split.upcomingLine], stops: attachTimes(split.stops, trip) };
}

export function drawRoute(map, route, type) {
  if (!map.isStyleLoaded()) return; // podklad mapy ještě není (nebo se nenačetl), trasu nakreslíme při další obnově
  ensureLayers(map);
  const { main, passed, casing } = TYPE_COLORS[type] ?? TYPE_COLORS.bus;
  const lines = [];
  for (const l of route.passedLines) if (l.length > 1) lines.push(lineFeature(l, passed, true, '#ffffff'));
  for (const l of route.upcomingLines) if (l.length > 1) lines.push(lineFeature(l, main, false, casing));
  map.getSource(SRC_LINE).setData({ type: 'FeatureCollection', features: lines });
  map.getSource(SRC_STOPS).setData({
    type: 'FeatureCollection',
    features: route.stops.map((s) => ({
      type: 'Feature',
      properties: { name: s.name, passed: s.passed, color: s.passed ? passed : main, stroke: s.passed ? passed : casing, ...(s.time ? { time: s.time } : {}) },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  });
}

export function clearRoute(map) {
  if (!map.getSource(SRC_LINE)) return;
  map.getSource(SRC_LINE).setData(empty);
  map.getSource(SRC_STOPS).setData(empty);
}
