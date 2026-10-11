import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCityBus, parseDelay, cityTrip } from '../src/cities.js';
import { buildPlannerFromTrips } from '../scripts/planner-data.mjs';
import { preparePlanner } from '../src/planner.js';

const record = {
  cn: '946001|1|58|Valašské Meziříčí,Tesla I|130|Valašské Meziříčí,sklárny|94|1116|Valašské Meziříčí,stan.MHD u náměstí|Krhová,točna|1|2TD5812',
  x: 49.47568,
  y: 17.98134,
  ico: 'a_0.png',
  ds: '$z1~min.~34~s',
};

test('zpoždění z mapy IDZK', () => {
  assert.equal(parseDelay('$z1~min.~34~s'), 94);
  assert.equal(parseDelay('$p0~min.~40~s'), -40);
  assert.equal(parseDelay(''), null);
});

test('vůz MHD Valašského Meziříčí z mapy IDZK', () => {
  const v = parseCityBus(record);
  assert.equal(v.city, 'vm');
  assert.equal(v.line, '1');
  assert.equal(v.id, 'vm-2TD5812');
  assert.equal(v.stop, 'Tesla I');
  assert.equal(v.headsign, 'Krhová, točna');
  assert.equal(v.delayText, '1:34');
  assert.equal(v.bearing, 0);
  assert.equal(parseCityBus({ ...record, cn: '800123|5|1' }), null, 'jiné linky ne');
});

test('regionální autobus vybraného dopravce z mapy IDZK', () => {
  const t = { cn: '802371|371|202|Tupesy|-19|Velehrad,náměstí|0|1317|Buchlovice,náměstí|Uherské Hradiště,aut.nádr.|1|7Z50806', x: 49.1, y: 17.39, ico: 'a_60.png', ds: '$p-0~min.~19~s', cr: 'ČSAD BUS UH' };
  const v = parseCityBus(t);
  assert.equal(v.city, 'csad');
  assert.equal(v.line, '371');
  assert.equal(v.tripNo, '202');
  assert.equal(v.id, 'csad-7Z50806');
  assert.equal(v.delay, -19);
  assert.equal(v.headsign, 'Uherské Hradiště, aut.nádr.');
  assert.equal(parseCityBus({ ...t, cr: 'ARRIVA, pr. Zlín' }).city, 'arriva');
  assert.equal(parseCityBus({ ...t, cr: 'Z-Group bus, pr. Kroměříž' }).city, 'zgroup');
  assert.equal(parseCityBus({ ...t, cr: 'Transdev Morava, pr. Vsetín' }), null, 'ostatní dopravce zatím ne');
});

test('dopravce regionální linky podle route_id GTFS IDZK', async () => {
  const { carrierOfRoute } = await import('../src/cities.js');
  assert.equal(carrierOfRoute('BUS_MHD:802180_263_2019-12-15'), 'csad');
  assert.equal(carrierOfRoute('BUS_MHD:771155_312_2021-03-07'), 'zgroup');
  assert.equal(carrierOfRoute('BUS_MHD:773165_88_2022-12-11'), 'arriva');
  assert.equal(carrierOfRoute('BUS_MHD:947101_1425_2021-01-01'), 'tdm');
  assert.equal(carrierOfRoute('BUS_MHD:999999_5_2021-01-01'), 'reg');
});

test('spoj vozu MHD jiného města podle linky, cíle a poslední zastávky', () => {
  const mask = '1'.repeat(5);
  const stops = [
    ['Valašské Meziříčí, stan.MHD u náměstí', 49.471, 17.971],
    ['Valašské Meziříčí, Tesla I', 49.475, 17.981],
    ['Krhová, točna', 49.5, 17.993],
  ];
  const P = preparePlanner(
    buildPlannerFromTrips({
      startDate: '2026-10-11',
      days: 5,
      rawTrips: [
        { ref: '1', type: 'bus', city: 'vm', number: '58', mask, times: [1110, 1114, 1124], stops },
        { ref: '1', type: 'bus', city: 'vm', number: '60', mask, times: [1170, 1174, 1184], stops },
        // Spoj 57 ve stejný čas jen jinou trasou: číslo spoje z mapy IDZK rozhodne.
        { ref: '1', type: 'bus', city: 'vm', number: '57', mask, times: [1111, 1114, 1120], stops: [stops[0], stops[1], ['Valašské Meziříčí, sklárny', 49.48, 17.99]] },
        // Zlínská linka 1 se stejným číslem se nesmí splést.
        { ref: '1', type: 'trolleybus', mask, times: [1110, 1114, 1124], stops: [['Zlín, náměstí Míru', 49.226, 17.666], ['Tesla', 49.22, 17.6], ['Krhová', 49.21, 17.59]] },
      ],
    }),
  );
  const trip = cityTrip(P, parseCityBus(record), '2026-10-11', 1116);
  assert.deepEqual(trip.map((s) => s.time), ['18:30', '18:34', '18:44']);
  assert.equal(trip[1].name, 'Tesla I');
  assert.equal(cityTrip(P, { ...parseCityBus(record), tripNo: '57' }, '2026-10-11', 1116).at(-1).name, 'sklárny');
  assert.equal(trip[2].name, 'Krhová, točna');
});
