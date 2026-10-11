import test from 'node:test';
import assert from 'node:assert/strict';
import { railCode } from '../scripts/rail-gtfs.mjs';
import { buildPlannerFromTrips } from '../scripts/planner-data.mjs';
import { preparePlanner, searchJourneys } from '../src/planner.js';
import { RailNetwork } from '../src/railroute.js';
import { trainTrip, trainPosition } from '../src/train-trip.js';

test('druh vlaku podle linky a dopravce', () => {
  assert.equal(railCode('S11', 'České dráhy, a.s.'), 'Os');
  assert.equal(railCode('Sp5', 'České dráhy, a.s.'), 'Sp');
  assert.equal(railCode('R18 Slovácký expres', 'České dráhy, a.s.'), 'R');
  assert.equal(railCode('Ex4 Porta Moravica', 'České dráhy, a.s.', true), 'EC');
  assert.equal(railCode('', 'Leo Express s.r.o. - žadatel'), 'LE');
  assert.equal(railCode('RegioJet', 'RegioJet a.s.', true), 'RJ');
});

test('trasa po kolejích přes odbočku bez společného bodu', () => {
  // Hlavní trať západ–východ, odbočka na sever končí 10 m od ní (zjednodušení ztratilo společný bod).
  const main = [[17.5, 49.2], [17.6, 49.2]];
  const branch = [[17.55, 49.20009], [17.55, 49.25]];
  const net = new RailNetwork([main, branch]);
  const path = net.path([49.2, 17.51], [49.24, 17.55]);
  assert.ok(path && path.length >= 3, 'cesta existuje');
  assert.ok(Math.abs(path.at(-1)[1] - 49.24) < 0.001);
  assert.equal(net.path([49.2, 17.51], [49.5, 18.5]), null, 'mimo koleje žádná čára');
});

const mask = '1'.repeat(10);
const plannerData = () =>
  buildPlannerFromTrips({
    startDate: '2026-10-12',
    days: 10,
    rawTrips: [
      // Vlak Zlín střed → Otrokovice, v Malenovicích stojí 3 minuty.
      {
        ref: 'Os 14244', type: 'train', number: '14244', code: 'Os', operator: 'České dráhy, a.s.', line: 'S11', mask,
        times: [600, 610, 618], arr: [600, 607, 618],
        stops: [['Zlín střed', 49.2265, 17.6585], ['Zlín-Malenovice', 49.2098, 17.5997], ['Otrokovice', 49.2038, 17.5309]],
      },
      // Autobus se dvěma přestupy, který přijede jen o 2 minuty dřív.
      { ref: '1', type: 'bus', mask, times: [602, 605], stops: [['Zlín střed', 49.2265, 17.6585], ['A', 49.22, 17.63]] },
      { ref: '2', type: 'bus', mask, times: [606, 610], stops: [['A', 49.22, 17.63], ['B', 49.21, 17.56]] },
      { ref: '3', type: 'bus', mask, times: [611, 616], stops: [['B', 49.21, 17.56], ['Otrokovice', 49.2038, 17.5309]] },
    ],
  });

test('vlak: příjezd do stanice před odjezdem a jednodušší spojení má přednost', () => {
  const P = preparePlanner(plannerData());
  const zlin = P.stops.find((s) => s.name === 'Zlín střed').i;
  const otr = P.stops.find((s) => s.name === 'Otrokovice').i;
  const js = searchJourneys(P, { origins: [{ stop: zlin, walk: 0 }], target: otr, date: '2026-10-12', time: 595 });
  assert.equal(js.length, 1, 'kombinace tří autobusů o 2 minuty rychlejší se nenabízí');
  assert.equal(js[0].legs[0].trip.pattern.k, 'Os');
  assert.equal(js[0].legs[0].trip.pattern.l, 'S11');
  assert.deepEqual(js[0].legs[0].trip.arr, [600, 607, 618]);
});

test('jízdní řád vlaku a jeho poloha mezi zastávkami', () => {
  const P = preparePlanner(plannerData());
  const trip = trainTrip(P, '14244', '2026-10-12', 605);
  assert.deepEqual(trip.map((s) => s.name), ['Zlín střed', 'Zlín-Malenovice', 'Otrokovice']);
  assert.equal(trip[1].arr, '10:07');
  assert.equal(trip[1].time, '10:10');
  assert.equal(trip.line, 'S11');
  // Jede (má směr) a naposledy projel Zlín střed → mezi Zlínem a Malenovicemi.
  assert.deepEqual(trainPosition(trip, { stop: 'Zlín střed', stopPlanned: '10:00', bearing: 250, delay: 0 }, 605), { current: 0, atStop: false });
  // Stojí v Malenovicích.
  assert.deepEqual(trainPosition(trip, { stop: 'Zlín-Malenovice', stopPlanned: '10:10', bearing: null, delay: 0 }, 608), { current: 1, atStop: true });
  // Poslední bod je výhybna (není v jízdním řádu): podle času se zpožděním.
  assert.deepEqual(trainPosition(trip, { stop: 'Výh Lípa', bearing: 90, delay: 120 }, 613), { current: 1, atStop: false });
});

test('trasa po kolejích přes odbočku, kde se čáry po zjednodušení nedotýkají', () => {
  // Odbočka začíná 150 m od hlavní trati (ve stanici se ztratilo spojení), konec je dál než 30 m.
  const main = [[17.4, 49.3], [17.5, 49.3]];
  const branch = [[17.452, 49.301], [17.47, 49.35]];
  const net = new RailNetwork([main, branch]);
  const path = net.path([49.3, 17.41], [49.349, 17.4695]);
  assert.ok(path, 'cesta existuje');
  // Úplně oddělené tratě (kilometry od sebe) se nespojí.
  const far = new RailNetwork([main, [[17.45, 49.4], [17.5, 49.45]]]);
  assert.equal(far.path([49.3, 17.41], [49.449, 17.499]), null);
});

test('odbočka končící kus od hlavní trati se napojí, i když je síť jinudy propojená', () => {
  // Hlavní trať a odbočka, která se s ní potká až 20 km daleko; ve stanici končí 150 m od hlavní trati.
  const main = [[17.4, 49.3], [17.5, 49.3], [17.7, 49.3]];
  const branch = [[17.452, 49.3014], [17.46, 49.35], [17.7, 49.35], [17.7, 49.3]];
  const net = new RailNetwork([main, branch]);
  const path = net.path([49.3, 17.41], [49.349, 17.46]);
  assert.ok(path, 'cesta existuje');
  const len = path.reduce((s, p, i) => (i ? s + Math.hypot((p[0] - path[i - 1][0]) * 72700, (p[1] - path[i - 1][1]) * 111200) : 0), 0);
  assert.ok(len < 12000, `krátká cesta přes stanici (${Math.round(len)} m)`);
});
