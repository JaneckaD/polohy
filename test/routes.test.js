import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutes } from '../scripts/routes-lib.mjs';
import { nameSimilarity } from '../src/names.js';
import { findRoute, splitRoute, routeFromTrip, currentTripIndex } from '../src/route-match.js';

// Malá syntetická odpověď Overpass: linka 2 tam a zpět po třech zastávkách.
const n = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) });
const OVERPASS = {
  elements: [
    n(1, 49.220, 17.650, { public_transport: 'stop_position', name: 'Náměstí Míru' }),
    n(2, 49.222, 17.660, { public_transport: 'stop_position', name: 'Zborovská' }),
    n(3, 49.224, 17.670, { public_transport: 'stop_position', name: 'Otrokovice, železniční stanice' }),
    n(4, 49.2201, 17.6501, { public_transport: 'platform', name: 'Náměstí Míru' }),
    { type: 'way', id: 10, nodes: [2, 1] }, // první cesta schválně obráceně
    { type: 'way', id: 11, nodes: [2, 3] },
    {
      type: 'relation', id: 100,
      tags: { type: 'route', route: 'trolleybus', ref: '2', operator: 'DSZO', from: 'Náměstí Míru', to: 'Otrokovice, železniční stanice' },
      members: [
        { type: 'node', ref: 1, role: 'stop' }, { type: 'node', ref: 4, role: 'platform' },
        { type: 'node', ref: 2, role: 'stop' }, { type: 'node', ref: 3, role: 'stop' },
        { type: 'way', ref: 10, role: '' }, { type: 'way', ref: 11, role: '' },
      ],
    },
    {
      type: 'relation', id: 101,
      tags: { type: 'route', route: 'trolleybus', ref: '2', operator: 'DSZO', to: 'Náměstí Míru' },
      members: [
        { type: 'node', ref: 3, role: 'stop' }, { type: 'node', ref: 2, role: 'stop' }, { type: 'node', ref: 1, role: 'stop' },
        { type: 'way', ref: 11, role: '' }, { type: 'way', ref: 10, role: '' },
      ],
    },
    { type: 'relation', id: 102, tags: { type: 'route', route: 'bus', ref: '773165', operator: 'ARRIVA' }, members: [] },
  ],
};

test('builds DSZO routes from Overpass data', () => {
  const { routes, stops } = buildRoutes(OVERPASS);
  assert.equal(routes.length, 2);
  const [there, back] = routes;
  assert.deepEqual(there.stops.map((s) => s[0]), ['Náměstí Míru', 'Zborovská', 'Otrokovice, železniční stanice']);
  assert.deepEqual(there.line[0], [17.65, 49.22]);
  assert.deepEqual(there.line.at(-1), [17.67, 49.224]);
  assert.deepEqual(back.line[0], [17.67, 49.224]);
  assert.ok(stops['zborovska']);
});

test('name similarity copes with DSZO abbreviations', () => {
  assert.ok(nameSimilarity('Otrokovice,žel.st.', 'Otrokovice, železniční stanice') > 0.9);
  assert.ok(nameSimilarity('Otrokovice,žel.st.', 'Náměstí Míru') < 0.2);
});

test('picks the direction by headsign and bearing, splits at the vehicle', () => {
  const { routes } = buildRoutes(OVERPASS);
  const v = { line: '2', lat: 49.2211, lon: 17.6555, bearing: 75, headsign: 'Otrokovice,žel.st.' };
  const match = findRoute(routes, v, []);
  assert.equal(match.route.to, 'Otrokovice, železniční stanice');

  const back = findRoute(routes, { ...v, headsign: null, bearing: 255 }, []);
  assert.equal(back.route.to, 'Náměstí Míru');

  const split = splitRoute(match.route, match.proj);
  assert.deepEqual(split.stops.map((s) => s.passed), [true, false, false]);
  assert.deepEqual(split.passedLine[0], [17.65, 49.22]);
  assert.deepEqual(split.upcomingLine.at(-1), [17.67, 49.224]);
});

test('ignores vehicles far from any route of the line', () => {
  const { routes } = buildRoutes(OVERPASS);
  assert.equal(findRoute(routes, { line: '2', lat: 49.3, lon: 17.9 }, []), null);
  assert.equal(findRoute(routes, { line: '5', lat: 49.221, lon: 17.655 }, []), null);
});

test('falls back to stops from the trip timetable', () => {
  const { stops } = buildRoutes(OVERPASS);
  const trip = [
    { time: '11:48', name: 'Náměstí Míru A' },
    { time: '11:50', name: 'Zborovská B' },
    { time: '11:55', name: 'Otrokovice,žel.st. C' },
  ];
  const r = routeFromTrip(trip, stops, 'Zborovská');
  assert.equal(r.stops.length, 3);
  assert.deepEqual(r.stops.map((s) => s.passed), [true, true, false]);
  assert.equal(currentTripIndex(trip, 'Zborovská'), 1);
});

test('reads the compact "out geom" Overpass format', () => {
  const nodes = OVERPASS.elements.filter((e) => e.type === 'node');
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const ways = new Map(OVERPASS.elements.filter((e) => e.type === 'way').map((w) => [w.id, w]));
  const relations = OVERPASS.elements
    .filter((e) => e.type === 'relation')
    .map((r) => ({
      ...r,
      members: r.members.map((m) =>
        m.type === 'way' ? { ...m, geometry: ways.get(m.ref).nodes.map((id) => ({ lat: byId.get(id).lat, lon: byId.get(id).lon })) } : m,
      ),
    }));
  const { routes } = buildRoutes({ elements: [...relations, ...nodes] });
  assert.equal(routes.length, 2);
  assert.deepEqual(routes[0].line, buildRoutes(OVERPASS).routes[0].line);
});

test('trasa podle spoje: skládá kusy tras, dělí v místě vozu a nekreslí rovné čáry přes mezery', async () => {
  const { tripGeometry, splitTrip } = await import('../src/route-match.js');
  const routes = [
    // Linka 2: A → B → C po ulici se zalomením
    { ref: '2', stops: [['A', 49.0, 17.0], ['B', 49.0, 17.01], ['C', 49.01, 17.01]], line: [[17.0, 49.0], [17.005, 49.0], [17.01, 49.0], [17.01, 49.005], [17.01, 49.01]] },
    // Jiná linka pokrývá C → D
    { ref: '7', stops: [['C', 49.01, 17.01], ['D', 49.01, 17.02]], line: [[17.01, 49.01], [17.02, 49.01]] },
  ];
  const trip = [{ time: '10:00', name: 'A A' }, { time: '10:02', name: 'B' }, { time: '10:04', name: 'C' }, { time: '10:06', name: 'D' }, { time: '10:09', name: 'E' }];
  const geo = tripGeometry(trip, routes, '2', { e: [49.02, 17.03] });
  assert.equal(geo.segments.length, 4);
  assert.deepEqual(geo.segments[0], [[17.0, 49.0], [17.005, 49.0], [17.01, 49.0]]);
  assert.deepEqual(geo.segments[1], [[17.01, 49.0], [17.01, 49.005], [17.01, 49.01]]);
  assert.deepEqual(geo.segments[2], [[17.01, 49.01], [17.02, 49.01]]);
  assert.equal(geo.segments[3], null);
  assert.deepEqual(geo.coords[4], [49.02, 17.03]);

  // Vůz mezi B a C, aktuální zastávka B (index 1).
  const r = splitTrip(geo, { lat: 49.003, lon: 17.0101 }, 1, trip);
  assert.equal(r.passedLines.length, 1);
  assert.deepEqual(r.passedLines[0][0], [17.0, 49.0]);
  assert.ok(Math.abs(r.passedLines[0].at(-1)[1] - 49.003) < 1e-6);
  assert.equal(r.upcomingLines.length, 1); // B–C a C–D navazují, D–E chybí (žádná rovná čára)
  assert.deepEqual(r.upcomingLines[0].at(-1), [17.02, 49.01]);
  assert.deepEqual(r.stops.map((s) => s.passed), [true, true, false, false, false]);
  assert.equal(r.stops[0].name, 'A');
  assert.equal(r.stops[2].time, '10:04');

  // Bez známé zastávky se aktuální kus najde podle polohy vozu.
  const r2 = splitTrip(geo, { lat: 49.01, lon: 17.015 }, -1, trip);
  assert.deepEqual(r2.stops.map((s) => s.passed), [true, true, true, false, false]);
});
