// Vykreslení trasy vybraného vozu: projetá část tmavší, zbývající v barvě linky, zastávky s časy.
import { TYPE_COLORS } from './colors.js';
import { findRoute, splitRoute, routeFromTrip, attachTimes } from './route-match.js';

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

function ensureLayers(map) {
  if (map.getSource(SRC_LINE)) return;
  map.addSource(SRC_LINE, { type: 'geojson', data: empty });
  map.addSource(SRC_STOPS, { type: 'geojson', data: empty });

  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: SRC_LINE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 10] },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: SRC_LINE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 6],
      'line-opacity': ['case', ['get', 'passed'], 0.75, 0.9],
    },
  });
  map.addLayer({
    id: 'route-stops',
    type: 'circle',
    source: SRC_STOPS,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 6],
      'circle-color': ['case', ['get', 'passed'], ['get', 'color'], '#ffffff'],
      'circle-stroke-color': ['get', 'color'],
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

function lineFeature(coords, color, passed) {
  return { type: 'Feature', properties: { color, passed }, geometry: { type: 'LineString', coordinates: coords } };
}

/** Spočítá trasu vozu. Vrací null, když ji nejde určit. */
export async function computeRoute(vehicle, trip) {
  const data = await loadRoutes();
  const match = findRoute(data.routes, vehicle, trip);
  if (match) {
    const split = splitRoute(match.route, match.proj);
    return { ...split, stops: attachTimes(split.stops, trip) };
  }
  if (trip?.length) return routeFromTrip(trip, data.stops, vehicle.stop);
  return null;
}

export function drawRoute(map, route, type) {
  ensureLayers(map);
  const { main, dark } = TYPE_COLORS[type] ?? TYPE_COLORS.bus;
  const lines = [];
  if (route.passedLine.length > 1) lines.push(lineFeature(route.passedLine, dark, true));
  if (route.upcomingLine.length > 1) lines.push(lineFeature(route.upcomingLine, main, false));
  map.getSource(SRC_LINE).setData({ type: 'FeatureCollection', features: lines });
  map.getSource(SRC_STOPS).setData({
    type: 'FeatureCollection',
    features: route.stops.map((s) => ({
      type: 'Feature',
      properties: { name: s.name, passed: s.passed, color: s.passed ? dark : main, ...(s.time ? { time: s.time } : {}) },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  });
}

export function clearRoute(map) {
  if (!map.getSource(SRC_LINE)) return;
  map.getSource(SRC_LINE).setData(empty);
  map.getSource(SRC_STOPS).setData(empty);
}
