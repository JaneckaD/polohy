import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerFromTrips } from '../scripts/planner-data.mjs';
import { preparePlanner } from '../src/planner.js';
import { estimatedVehicles, setBusRoutes, setJmkDown } from '../src/estimated.js';
import { lineLabel } from '../src/cities.js';

const stops = [['Pohořelice, nám.', 48.98, 16.52], ['Vlasatice, obecní úřad', 48.95, 16.55], ['Mikulov, žel.st.', 48.8, 16.63]];
const mask = '1'.repeat(3);
const raw = [
  { ref: '104', type: 'bus', city: 'jmk', number: '5', mask, times: [600, 610, 640], stops },
  // Spoj RegioJetu ve Zlínském kraji má vlastní zdroj, ten tady nebude.
  { ref: '000032', type: 'bus', city: 'coach', mask, times: [600, 610, 640], stops, headsign: 'Wien,Erdberg', operator: 'Bus Co', international: true },
  // Spoj sítě, která má živou polohu, tady není.
  { ref: '371', type: 'bus', city: 'csad', mask, times: [600, 610, 640], stops },
];
const P = preparePlanner(buildPlannerFromTrips({ startDate: '2026-10-12', days: 3, rawTrips: raw }));

test('číslo linky z šestimístné licence', () => {
  assert.equal(lineLabel('726504'), '504');
  assert.equal(lineLabel('000032'), '32');
  assert.equal(lineLabel('371'), '371');
  assert.equal(lineLabel('S3'), 'S3');
});

test('linky IDS JMK jedou živě: odhad jen když živý proud nefunguje', () => {
  setBusRoutes([]);
  setJmkDown(false);
  assert.deepEqual(estimatedVehicles(P, null, '2026-10-12', 605).map((v) => v.city), ['coach']);
  setJmkDown(true);
});

test('odhadovaný autobus: mezi zastávkami, v zastávce, mimo provoz, jen sítě bez živé polohy', () => {
  setBusRoutes([]);
  setJmkDown(true);
  const between = estimatedVehicles(P, null, '2026-10-12', 605);
  assert.deepEqual(between.map((v) => v.city).sort(), ['coach', 'jmk']);
  const jmk = between.find((v) => v.city === 'jmk');
  assert.equal(jmk.estimated, true);
  assert.equal(jmk.line, '104');
  assert.equal(jmk.tripNo, '5');
  assert.equal(jmk.atStop, false);
  assert.equal(jmk.nextIndex, 1);
  assert.equal(jmk.stop, 'Pohořelice, nám.');
  assert.equal(jmk.next, 'Vlasatice, obecní úřad');
  assert.ok(jmk.lat < 48.98 && jmk.lat > 48.95, 'uprostřed úseku');
  assert.equal(jmk.calls.length, 3);
  assert.equal(jmk.segments.length, 2);

  const intl = between.find((v) => v.city === 'coach');
  assert.equal(intl.international, true);
  assert.equal(intl.operatorName, 'Bus Co');
  assert.equal(intl.line, '32');
  assert.equal(intl.headsign, 'Wien,Erdberg');

  const at = estimatedVehicles(P, null, '2026-10-12', 610).find((v) => v.city === 'jmk');
  assert.equal(at.atStop, true);
  assert.equal(at.nextIndex, 1);
  assert.equal(estimatedVehicles(P, null, '2026-10-12', 700).length, 0);
  assert.equal(estimatedVehicles(P, null, '2026-10-20', 605).length, 0, 'mimo platnost dat');
});

test('odhad jede po trase po silnici, když ji máme', () => {
  setJmkDown(true);
  setBusRoutes([
    {
      ref: 'jmk:104',
      city: 'jmk',
      stops: stops.map(([n, la, lo]) => [n, la, lo]),
      line: [[16.52, 48.98], [16.6, 48.97], [16.55, 48.95], [16.63, 48.8]],
    },
  ]);
  const v = estimatedVehicles(P, null, '2026-10-12', 605).find((x) => x.city === 'jmk');
  assert.ok(v.segments[0]?.length > 1, 'úsek má trasu');
  assert.ok(v.lon > 16.54 || v.lat < 48.98);
  setBusRoutes([]);
});
