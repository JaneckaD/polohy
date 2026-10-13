import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerFromTrips } from '../scripts/planner-data.mjs';
import { preparePlanner } from '../src/planner.js';
import { parseIdsok, idsokNumbers } from '../src/idsok.js';
import { describe } from '../src/filtering.js';

const mask = '111';
const tramStops = [['Olomouc,Neředín,krematorium', 49.5953, 17.2272], ['Olomouc,Náměstí Hrdinů', 49.5946, 17.2502], ['Olomouc,Hlavní nádraží', 49.5925, 17.277]];
const busStops = [['Litovel,aut.st.', 49.7012, 17.0763], ['Červenka,žel.st.', 49.7168, 17.0812], ['Uničov,aut.st.', 49.7709, 17.1213]];
const raw = [
  { ref: '895002', type: 'tram', city: 'town', operator: 'MHD Olomouc', number: '12', mask, times: [600, 607, 612], stops: tramStops },
  { ref: '780402', type: 'bus', city: 'other', operator: 'FTL', number: '5', mask, times: [600, 610, 625], stops: busStops },
];
const P = preparePlanner(buildPlannerFromTrips({ startDate: '2026-10-13', days: 3, rawTrips: raw }));

test('IDSOK: čísla linky a spoje z názvu', () => {
  assert.deepEqual(idsokNumbers('895002 / 12'), { licence: '895002', trip: '12', line: '2' });
  assert.deepEqual(idsokNumbers('Bus 780402, spoj 5'), { licence: '780402', trip: '5', line: '402' });
});

test('IDSOK: vůz podle licence a čísla spoje, jinak podle odjezdu z výchozí zastávky', () => {
  const s = { id: 77, name: '895002 / 12', dep: 'Olomouc,Neředín,krematorium', depTime: '10:00', dest: 'Olomouc,Hlavní nádraží', destTime: '10:12', delay: 2, vehicleType: 'TRAMVAJ', operator: 'Dopravní podnik města Olomouce, a.s.', lat: 49.5940, lon: 17.2600 };
  const v = parseIdsok(s, { P, date: '2026-10-13', min: 608 });
  assert.equal(v.type, 'tram');
  assert.equal(v.city, 'town');
  assert.equal(v.operatorName, 'MHD Olomouc');
  assert.equal(v.delay, 120);
  assert.equal(v.calls.length, 3);
  assert.equal(v.nextIndex, 1, 'zpoždění 2 min: jede k Náměstí Hrdinů');
  assert.equal(describe(v).kind, 'tram');
  // Bez čísla spoje: licence a odjezd z výchozí zastávky.
  const b = parseIdsok({ id: 78, name: '780402', dep: 'Litovel,aut.st.', depTime: '10:00', dest: 'Uničov,aut.st.', delay: 0, vehicleType: 'AUTOBUS', operator: 'FTL', lat: 49.71, lon: 17.08 }, { P, date: '2026-10-13', min: 605 });
  assert.equal(b.city, 'other');
  assert.equal(b.tripId, P.trips.find((t) => t.pattern.r === '780402').id);
  assert.equal(b.nextIndex, 1);
});

test('IDSOK: vlaky a vozy bez polohy se přeskočí', () => {
  assert.equal(parseIdsok({ name: 'Os 3105', vehicleType: 'VLAK', lat: 49.6, lon: 17.2 }), null);
  assert.equal(parseIdsok({ name: '895002 / 12', lat: 0, lon: 0 }), null);
});
