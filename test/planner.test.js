import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerData } from '../scripts/planner-data.mjs';
import { preparePlanner, searchJourneys, earliestJourney, findStops, nearbyStops, rideStops } from '../src/planner.js';

// Linka 1: A → B → C. Linka 2: C → D. Linka 3: E → F, kde E je 300 m od C (pěší přestup).
const line = (ref, type, stops, coords, starts, step = 3) => ({
  ref,
  type,
  directions: [{
    id: 'A',
    headsign: stops.at(-1),
    stops,
    variants: [{ stops, count: starts.length, coords }],
    masks: ['111'],
    trips: starts.map((t0) => ({ d: 0, t: stops.map((_, i) => t0 + i * step) })),
  }],
});
const tt = {
  startDate: '2026-10-11',
  days: 3,
  lines: [
    line('1', 'trolleybus', ['A', 'B', 'C'], [[49.0, 17.0], [49.0, 17.01], [49.0, 17.02]], [600, 630]),
    line('2', 'bus', ['C', 'D'], [[49.0, 17.02], [49.0, 17.03]], [605, 615, 640]),
    line('3', 'bus', ['E', 'F'], [[49.0027, 17.02], [49.01, 17.02]], [612, 650]),
  ],
};

test('planner.json: sloučené zastávky, vzory a časy jako rozdíly', () => {
  const d = buildPlannerData(tt);
  assert.deepEqual(d.stops.map((s) => s[0]), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(d.patterns.length, 3);
  assert.deepEqual(d.trips[0], [0, 0, 600, 3, 3]);
});

const P = preparePlanner(buildPlannerData(tt));
const stop = (name) => P.stops.find((s) => s.name === name).i;

test('přímý spoj a přestup na stejné zastávce', () => {
  const j = earliestJourney(P, { origins: [{ stop: stop('A'), walk: 0 }], target: stop('D'), date: '2026-10-11', time: 590 });
  assert.equal(j.transfers, 1);
  assert.deepEqual(j.legs.map((l) => l.type), ['ride', 'ride']);
  assert.equal(j.legs[0].dep, 600);
  assert.equal(j.legs[1].dep, 615); // 605 ujede (přijedu v 606), další v 615
  assert.equal(j.arr, 618);
  assert.deepEqual(rideStops(P, j.legs[0]).map((s) => s.name), ['A', 'B', 'C']);
});

test('pěší přestup na blízkou zastávku je v úsecích označený', () => {
  const j = earliestJourney(P, { origins: [{ stop: stop('A'), walk: 0 }], target: stop('F'), date: '2026-10-11', time: 590 });
  assert.deepEqual(j.legs.map((l) => l.type), ['ride', 'walk', 'ride']);
  assert.equal(j.walkTransfers, 1);
  assert.equal(j.legs[1].from, stop('C'));
  assert.equal(j.legs[1].to, stop('E'));
  assert.ok(j.legs[1].min >= 5 && j.legs[1].min <= 6);
  assert.equal(j.legs[2].dep, 612);
});

test('víc spojení po sobě a nic po posledním spoji', () => {
  const list = searchJourneys(P, { origins: [{ stop: stop('A'), walk: 0 }], target: stop('C'), date: '2026-10-11', time: 590 });
  assert.deepEqual(list.map((j) => j.dep), [600, 630]);
  assert.equal(earliestJourney(P, { origins: [{ stop: stop('A'), walk: 0 }], target: stop('C'), date: '2026-10-11', time: 700 }), null);
  assert.equal(earliestJourney(P, { origins: [{ stop: stop('A'), walk: 0 }], target: stop('C'), date: '2026-10-20', time: 590 }), null);
});

test('hledání zastávek a okolí polohy', () => {
  assert.deepEqual(findStops(P, 'a').map((s) => s.name), ['A']);
  const near = nearbyStops(P, 49.0, 17.0201);
  assert.equal(P.stops[near[0].stop].name, 'C');
  assert.ok(near.some((n) => P.stops[n.stop].name === 'E'));
});

test('vozy spojení: linka, směr a poloha podle jízdního řádu', async () => {
  const { matchJourneyVehicles } = await import('../src/journey-vehicles.js');
  const j = earliestJourney(P, { origins: [{ stop: stop('A'), walk: 0 }], target: stop('D'), date: '2026-10-11', time: 590 });
  const vehicles = [
    { id: '1', line: '1', stop: 'B', headsign: 'C', delay: 0 }, // jede podle jízdního řádu (B v 603)
    { id: '2', line: '1', stop: 'B', headsign: 'C', delay: 0 },
    { id: '9', line: '2', stop: 'C', headsign: 'D', delay: 0 },
  ];
  // Ve 603 je spoj linky 1 u zastávky B, spoj linky 2 (C v 615) ještě nevyjel ke C.
  const ids = matchJourneyVehicles(j, P, vehicles, 603);
  assert.equal(ids[0], '1');
  assert.equal(ids[1], null);
  assert.deepEqual(matchJourneyVehicles(j, P, vehicles, 700), [null, null]);
});

test('cíl celé město: první dosažená ze zastávek města', () => {
  const j = earliestJourney(P, { origins: [{ stop: stop('A'), walk: 0 }], target: [stop('D'), stop('C')], date: '2026-10-11', time: 590 });
  assert.equal(P.stops[j.legs.at(-1).to].name, 'C');
  assert.equal(j.arr, 606);
  assert.equal(j.transfers, 0);
});

test('obce a druhy dopravy na zastávkách', async () => {
  const { findTowns } = await import('../src/planner.js');
  const t2 = {
    ...tt,
    lines: [
      line('1', 'bus', ['Kroměříž, Hulínská', 'Kroměříž, náměstí', 'Bílany'], [[49.3, 17.39], [49.3, 17.4], [49.31, 17.41]], [600]),
      line('2', 'bus', ['Kroměříž', 'Kroměříž, náměstí'], [[49.29, 17.38], [49.3, 17.4]], [610]),
    ],
  };
  const Q = preparePlanner(buildPlannerData(t2));
  const town = findTowns(Q, 'krom')[0];
  assert.equal(town.name, 'Kroměříž');
  assert.deepEqual(town.stops.map((i) => Q.stops[i].name).sort(), ['Kroměříž', 'Kroměříž, Hulínská', 'Kroměříž, náměstí']);
  assert.ok(Q.stops[0].kinds.has('mhd'));
});
