import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlannerFromTrips } from '../scripts/planner-data.mjs';
import { preparePlanner } from '../src/planner.js';
import { parseIredo } from '../src/idsok.js';
import { parsePce, isoDelay } from '../src/pardubice.js';
import { krajOf } from '../src/region.js';

const region = JSON.parse(readFileSync(new URL('../public/region.json', import.meta.url)));
const mask = '111';
const trolleyStops = [['Pardubice,,Jesničánky,točna', 50.0154, 15.7717], ['Pardubice,,Zborovské nám.', 50.0221, 15.7712], ['Pardubice,,Gorkého', 50.0253, 15.7709]];
const busStops = [['Vysoké Mýto,,aut.nádr.', 49.9531, 16.1614], ['Zádolí', 49.9, 16.13], ['Proseč,,nám.', 49.8073, 16.1165]];
const raw = [
  { ref: '655002', type: 'trolleybus', city: 'town', operator: 'MHD Pardubice', number: '15', mask, times: [600, 603, 605], stops: trolleyStops },
  { ref: '700923', type: 'bus', city: 'other', operator: 'BusLine', number: '13', mask, times: [1035, 1050, 1076], stops: busStops },
];
const P = preparePlanner(buildPlannerFromTrips({ startDate: '2026-10-15', days: 3, rawTrips: raw }));

test('Pardubický kraj je v oblasti', () => {
  assert.equal(krajOf(region, 15.78, 50.04), 'pak');
  assert.equal(krajOf(region, 16.16, 49.95), 'pak');
  assert.equal(krajOf(region, 17.66, 49.22), 'zlk');
});

test('zpoždění MHD Pardubice ve tvaru ISO 8601', () => {
  assert.equal(isoDelay('PT4M53S'), 293);
  assert.equal(isoDelay('-PT1M11S'), -71);
  assert.equal(isoDelay('-PT4S'), -4);
  assert.equal(isoDelay(null), null);
});

test('vůz MHD Pardubice: trolejbus podle jízdního řádu', () => {
  const v = parsePce(
    { vid: '101', lineId: '2', destinationName: 'Gorkého', lastStopName: 'Jesničánky,točna', nextStopName: 'Zborovské náměstí', gpsLat: 50.019, gpsLon: 15.7714, currentDelay: 'PT1M', connectionId: 999, airConditioning: true },
    { P, date: '2026-10-15', min: 603 },
  );
  assert.equal(v.type, 'trolleybus');
  assert.equal(v.line, '2');
  assert.equal(v.delay, 60);
  assert.equal(v.live, 'pce');
  assert.ok(v.tripId != null, 'spoj dohledaný podle příští zastávky');
  assert.deepEqual(v.features, ['ac']);
});

test('spoj z mapy IREDO: regionální autobus v Pardubickém kraji', () => {
  const s = { id: 'S-700923-13', name: '700923 13', vehicleType: 'A', sourceType: 'S', delay: 2, operator: 'BusLine Pardubicko s.r.o.', dep: 'Vysoké Mýto,,aut.nádr.', dest: 'Proseč,,nám.', depTime: '17:15', destTime: '17:56', lat: 49.86067, lon: 16.11545, lineNumber: 700923, angle: 133, lineType: 'V' };
  const v = parseIredo({ ...s, serviceNumber: 13 }, { P, region, date: '2026-10-15', min: 1061 });
  assert.equal(v.live, 'iredo');
  assert.equal(v.city, 'other');
  assert.equal(v.line, '923');
  assert.equal(v.bearing, 133);
  assert.ok(v.tripId != null);
  // Vlaky z mapy IREDO jdou přes /trains, ne mezi autobusy.
  assert.equal(parseIredo({ id: 'K-15311', name: 'Os 15311', vehicleType: 'V', sourceType: 'K', lat: 49.72, lon: 16.33 }, { region }), null);
  // Spoje v Královéhradeckém kraji (mimo oblast) se neukážou.
  assert.equal(parseIredo({ ...s, lat: 50.21, lon: 15.83 }, { region }), null);
});
