import test from 'node:test';
import assert from 'node:assert/strict';
import { runsOn, isHoliday, regioJetVehicles, along } from '../src/regiojet.js';

const data = {
  stations: {
    1: ['Zlín - AN', 49.2265, 17.6634],
    2: ['Zlín - Malenovice, křiž.', 49.2063, 17.5872],
    3: ['Kroměříž - AN', 49.2953, 17.3935],
    4: ['Brno - AN u hotelu Grand', 49.1924, 16.6136],
  },
  segs: {},
  conns: [
    // Zlín 11:30 → Malenovice 11:40 → Kroměříž 12:05 → Brno 13:10, denně
    { id: 10, line: 721311, from: 'Zlín', to: 'Brno', valid: ['2026-08-30', '2026-12-12'], sym: [], codes: [], stops: [[1, null, 690], [2, 700, 700], [3, 725, 726], [4, 790, null]] },
    // jen v pracovní dny a v sobotu, navíc 28. 10.
    { id: 11, line: 721311, from: 'Zlín', to: 'Brno', valid: ['2026-08-30', '2026-12-12'], sym: ['x', '6'], codes: [['INCLUDING_ALSO', '2026-10-28', '2026-10-28']], stops: [[1, null, 690], [4, 790, null]] },
  ],
};

test('RegioJet: svátky a dny, kdy spoj jede', () => {
  assert.ok(isHoliday('2026-10-28'));
  assert.ok(isHoliday('2026-04-06')); // Velikonoční pondělí 2026
  assert.ok(!isHoliday('2026-10-12'));
  const c = data.conns[1];
  assert.ok(runsOn(c, '2026-10-12')); // pondělí
  assert.ok(runsOn(c, '2026-10-17')); // sobota
  assert.ok(!runsOn(c, '2026-10-18')); // neděle
  assert.ok(runsOn(c, '2026-10-28')); // svátek, ale jede také
  assert.ok(!runsOn(c, '2026-11-17')); // svátek v úterý
  assert.ok(!runsOn(data.conns[0], '2026-12-20')); // mimo platnost
  assert.ok(runsOn({ sym: ['x', '+'], codes: [['EXCLUDING', '2026-12-24', '2026-12-26']] }, '2026-11-17'));
  assert.ok(!runsOn({ sym: [], codes: [['EXCLUDING', '2026-12-24', '2026-12-26']] }, '2026-12-25'));
});

test('RegioJet: poloha mezi zastávkami a v zastávce podle jízdního řádu', () => {
  const now = 695; // 11:35, půl cesty Zlín → Malenovice
  const list = regioJetVehicles({ ...data, conns: [data.conns[0]] }, null, '2026-10-12', now);
  assert.equal(list.length, 1);
  const v = list[0];
  assert.equal(v.city, 'rj');
  assert.equal(v.estimated, true);
  assert.equal(v.stop, 'Zlín - AN');
  assert.equal(v.next, 'Zlín - Malenovice, křiž.');
  assert.equal(v.headsign, 'Brno - AN u hotelu Grand');
  assert.equal(v.nextIndex, 1);
  assert.equal(v.atStop, false);
  assert.ok(Math.abs(v.lat - (49.2265 + 49.2063) / 2) < 0.001);
  assert.ok(v.bearing > 180 && v.bearing < 270); // na jihozápad
  assert.deepEqual(v.calls.map((c) => c.time), ['11:30', '11:40', '12:06', '13:10']);
  assert.equal(v.segments.length, 3);

  const at = regioJetVehicles({ ...data, conns: [data.conns[0]] }, null, '2026-10-12', 725.5)[0];
  assert.equal(at.atStop, true);
  assert.equal(at.stop, 'Kroměříž - AN');
  assert.equal(at.next, 'Brno - AN u hotelu Grand');
  assert.equal(at.lat, 49.2953);

  // Ještě nevyjel, už dojel, nebo dnes nejede.
  assert.equal(regioJetVehicles(data, null, '2026-10-12', 600).length, 0);
  assert.equal(regioJetVehicles(data, null, '2026-10-12', 800).length, 0);
  assert.equal(regioJetVehicles(data, null, '2026-10-18', 695).length, 1);
});

test('RegioJet: mimo kraj ho neukážeme, spoj přes půlnoc najdeme i druhý den', () => {
  const region = { geometry: { coordinates: [[[17.3, 49.0], [18.0, 49.0], [18.0, 49.5], [17.3, 49.5], [17.3, 49.0]]] } };
  assert.equal(regioJetVehicles(data, region, '2026-10-12', 695).length, 2);
  assert.equal(regioJetVehicles({ ...data, conns: [data.conns[0]] }, region, '2026-10-12', 760).length, 0); // u Brna
  const night = { ...data, conns: [{ ...data.conns[0], id: 12, stops: [[1, null, 1430], [2, 1450, 1450]] }] };
  const list = regioJetVehicles(night, null, '2026-10-13', 5);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'rj-12-2026-10-12');
});

test('RegioJet: bod na lomené čáře podle délky', () => {
  const p = along([[0, 0], [0, 1], [0, 3]], 0.5);
  assert.ok(Math.abs(p.lat - 1.5) < 1e-9);
  assert.equal(Math.round(p.bearing), 0);
});
