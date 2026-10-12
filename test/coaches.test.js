import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlixBus, coachTrip, coachPosition, decodePolyline } from '../src/coaches.js';
import { parseKmBus, parseKmDelay, networkLabel, isCoach } from '../src/cities.js';

const ride = {
  id: '11111111-1111-1111-1111-111111111111',
  code: '856',
  name: 'Brno - Zlín',
  dir: 'Zlín (aut. nádr.)',
  no: 3,
  lat: 49.29,
  lon: 17.3,
  at: '2026-10-12T07:41:00Z',
  dev: 300,
  next: 2,
  arrived: false,
  calls: [
    { seq: 1, name: 'Brno (Hotel Grand)', lat: 49.19, lon: 16.61, arr: null, dep: '2026-10-12T06:50:00Z' },
    { seq: 2, name: 'Kroměříž (aut. nádr.)', lat: 49.3, lon: 17.39, arr: '2026-10-12T07:40:00Z', dep: '2026-10-12T07:45:00Z' },
    { seq: 3, name: 'Zlín (aut. nádr.)', lat: 49.22, lon: 17.66, arr: '2026-10-12T08:15:00Z', dep: null },
  ],
};

test('FlixBus: vůz mezi zastávkami, zpoždění a cíl', () => {
  const v = parseFlixBus(ride);
  assert.equal(v.id, `flix-${ride.id}`);
  assert.equal(v.city, 'flix');
  assert.equal(v.line, '856');
  assert.equal(v.stop, 'Brno (Hotel Grand)');
  assert.equal(v.next, 'Kroměříž (aut. nádr.)');
  assert.equal(v.headsign, 'Zlín (aut. nádr.)');
  assert.equal(v.delay, 300);
  assert.deepEqual(coachPosition(v), { current: 0, atStop: false });
  assert.deepEqual(
    coachTrip(v).map((s) => s.time),
    ['08:50', '09:45', '10:15'],
  );
  assert.equal(networkLabel('flix'), 'FlixBus');
  assert.ok(isCoach('flix') && !isCoach('km'));
});

test('FlixBus: vůz stojící v zastávce', () => {
  const v = parseFlixBus({ ...ride, arrived: true });
  assert.equal(v.stop, 'Kroměříž (aut. nádr.)');
  assert.equal(v.next, 'Zlín (aut. nádr.)');
  assert.deepEqual(coachPosition(v), { current: 1, atStop: true });
});

test('FlixBus: mimo kraj se vůz neukáže', () => {
  const region = { geometry: { coordinates: [[[17, 49], [18, 49], [18, 49.5], [17, 49.5], [17, 49]]] } };
  assert.ok(parseFlixBus(ride, region));
  assert.equal(parseFlixBus({ ...ride, lat: 50.08, lon: 14.43 }, region), null);
});

test('lomená čára FlixBusu se rozbalí na [lon, lat]', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC'), [[-120.2, 38.5], [-120.95, 40.7]]);
});

test('MHD Kroměříž z vlastní mapy: linka, spoj, zpoždění', () => {
  const v = parseKmBus({ vid: 2702678, state_dtime: '2026-10-12T06:20:17.000Z', line_number: 4, destination_number: 16534, current_stop_number: 55662, time_difference: '-00:05:55', connection_no: 23, gps_latitude: 49.29541, gps_longitude: 17.3869, air_conditioning: true, current_stop_name: 'Hygienická stanice', destination_name: 'Nádraží' });
  assert.equal(v.id, 'km-2702678');
  assert.equal(v.city, 'km');
  assert.equal(v.line, '4');
  assert.equal(v.tripNo, '23');
  assert.equal(v.delay, 355);
  assert.equal(v.stop, 'Hygienická stanice');
  assert.equal(v.headsign, 'Nádraží');
  assert.equal(v.aircon, true);
  assert.equal(parseKmDelay('00:01:00'), -60);
  assert.equal(parseKmDelay(null), null);
  assert.equal(parseKmBus({ vid: 1, line_number: 4, gps_latitude: null, gps_longitude: 17 }), null);
});

test('MHD města: poloha podle jízdního řádu, když název zastávky nesedí', async () => {
  const { timeTripPosition } = await import('../src/cities.js');
  const trip = [{ name: 'aut.nádr.', time: '08:00' }, { name: 'Bělidla', time: '08:01' }, { name: 'Kaufland', time: '08:05' }, { name: 'aut.nádr.', time: '08:30' }];
  assert.deepEqual(timeTripPosition(trip, 120, 8 * 60 + 4), { current: 1, atStop: false });
  assert.deepEqual(timeTripPosition(trip, 0, 7 * 60 + 58), { current: 0, atStop: true });
  assert.deepEqual(timeTripPosition(trip, 0, 8 * 60 + 31), { current: 3, atStop: true });
});
