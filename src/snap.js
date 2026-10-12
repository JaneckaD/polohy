// Přichycení vozů na silnici: GPS z DSZO občas ujede o pár metrů vedle.
// 1) Na trasu jeho linky (z routes.json), když je do 40 m.
// 2) Jinak na nejbližší silnici z mapových dlaždic, když je do 25 m.
import { findRoute, projectOnLine } from './route-match.js';
import { styleReady } from './region.js';

const ROUTE_SNAP_M = 40;
const ROAD_SNAP_M = 25;
const ROAD_LAYERS = ['roads-major', 'roads-minor'];

function snapToRoads(map, v) {
  if (!styleReady(map) || map.getZoom() < 13) return null;
  const p = map.project([v.lon, v.lat]);
  const box = [
    [p.x - 30, p.y - 30],
    [p.x + 30, p.y + 30],
  ];
  let best = null;
  let features;
  try {
    features = map.queryRenderedFeatures(box, { layers: ROAD_LAYERS });
  } catch {
    return null;
  }
  for (const f of features) {
    const g = f.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      const proj = projectOnLine(line, v.lon, v.lat);
      if (proj && (!best || proj.dist < best.dist)) best = proj;
    }
  }
  return best && best.dist <= ROAD_SNAP_M ? best : null;
}

/**
 * Vrátí vůz s upravenou polohou (lat/lon) a původní polohou v rawLat/rawLon.
 * routes = trasy z routes.json.
 */
export function snapVehicle(map, routes, v) {
  const raw = { ...v, rawLat: v.lat, rawLon: v.lon };
  const match = routes?.length ? findRoute(routes, v, null) : null;
  if (match && match.proj.dist <= ROUTE_SNAP_M) {
    const [lon, lat] = match.proj.point;
    return { ...raw, lat, lon, snapped: 'route' };
  }
  const road = snapToRoads(map, v);
  if (road) {
    const [lon, lat] = road.point;
    return { ...raw, lat, lon, snapped: 'road' };
  }
  return raw;
}
