import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerFromTrips, packTrips } from '../scripts/planner-data.mjs';
import { preparePlanner, unpackTrips } from '../src/planner.js';
import { parseJmk, matchJmkTrip } from '../src/jmk.js';
import { matchesFilter, describe } from '../src/filtering.js';
import { EMPTY_FILTER } from '../src/filtering.js';

const mask = '111';
const brnoStops = [['Brno, Hlavní nádraží', 49.1906, 16.6126], ['Brno, Malinovského náměstí', 49.1954, 16.6136], ['Brno, Moravské náměstí', 49.1985, 16.6085]];
const raw = [
  { ref: '4', type: 'tram', city: 'brno', mask, times: [600, 603, 606], stops: brnoStops, nodes: [1146, 1200, 1300] },
  { ref: '4', type: 'tram', city: 'brno', mask, times: [610, 613, 616], stops: brnoStops, nodes: [1146, 1200, 1300] },
  { ref: '801', type: 'bus', city: 'jmkmhd', operator: 'MHD Znojmo', mask, times: [600, 610], stops: [['Znojmo, Náměstí', 48.85, 16.05], ['Znojmo, Nádraží', 48.86, 16.06]], nodes: [18001, 18038] },
];
const data = buildPlannerFromTrips({ startDate: '2026-10-12', days: 3, rawTrips: raw });
const P = preparePlanner(data);

const msg = (a) => ({ ID: 1, VType: 0, LineName: '4', Lat: 49.1930, Lng: 16.6131, Bearing: 10, Course: '40401', LF: 'true', Delay: 1, LastStopID: 1146, FinalStopID: 1300, IsInactive: 'false', TimeUpdated: Date.parse('2026-10-12T08:12:00Z'), ...a });

test('zkrácené spoje: stejné rozestupy se nepřenáší, v prohlížeči se doplní', () => {
  const copy = structuredClone(data);
  const full = structuredClone(copy.trips);
  assert.equal(packTrips(copy), 1);
  assert.deepEqual(copy.trips[1].length, 3);
  assert.deepEqual(unpackTrips(copy.trips), full);
});

test('živá tramvaj IDS JMK: spoj podle linky, poslední a cílové zastávky a času', () => {
  // 10:12, zpoždění 1 min: druhý spoj (odjezd z Hlavního nádraží 10:10 + 1).
  const m = matchJmkTrip(P, msg(), '2026-10-12', 612);
  assert.equal(m.trip.times[0], 610);
  assert.equal(m.k, 0);
  const v = parseJmk(msg(), { P, date: '2026-10-12', min: 612 });
  assert.equal(v.type, 'tram');
  assert.equal(v.city, 'brno');
  assert.equal(v.line, '4');
  assert.equal(v.headsign, 'Moravské náměstí', 'brněnské zastávky bez „Brno,“');
  assert.equal(v.stop, 'Hlavní nádraží');
  assert.equal(v.delay, 60);
  assert.equal(v.lowFloor, true);
  assert.equal(v.atStop, false);
  assert.equal(v.nextIndex, 1);
  assert.equal(v.next, 'Malinovského náměstí');
  assert.equal(v.calls.length, 3);
  assert.equal(v.segments.length, 2, 'tramvaj rovně mezi zastávkami');
  assert.equal(describe(v).kind, 'tram');
  assert.ok(matchesFilter(v, { ...EMPTY_FILTER, kinds: ['tram'] }));
  assert.ok(!matchesFilter(v, { ...EMPTY_FILTER, kinds: ['mhd'] }));
});

test('živý vůz IDS JMK: MHD jiného města, bez dat, vlak a neaktivní', () => {
  const bus = parseJmk(msg({ VType: 4, LineName: '801', LastStopID: 18001, FinalStopID: 18038, Lat: 48.8502, Lng: 16.0502 }), { P, date: '2026-10-12', min: 600 });
  assert.equal(bus.city, 'jmkmhd');
  assert.equal(bus.operatorName, 'MHD Znojmo');
  assert.equal(bus.atStop, true);
  assert.equal(describe(bus).kind, 'mhd');
  const bare = parseJmk(msg({ VType: 1, LineName: '25' }));
  assert.equal(bare.type, 'trolleybus');
  assert.equal(bare.calls, undefined);
  assert.equal(parseJmk(msg({ VType: 5 })), null, 'vlaky jsou z jiného zdroje');
  assert.equal(parseJmk(msg({ IsInactive: 'true' })), null);
});
