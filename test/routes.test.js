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
