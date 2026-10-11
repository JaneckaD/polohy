import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJdfFile, buildTimetables, runsOn, czechHolidays } from '../scripts/jdf-lib.mjs';

const f = (rows) => parseJdfFile(rows.map((r) => r.map((x) => `"${x}"`).join(',') + ';').join('\r\n'));

// Linka 2 (trolejbus), tři zastávky, spoj 1 tam v pracovní dny, spoj 2 zpět denně, spoj 3 nejede 28. 10.
const JDF = {
  'zastavky.txt': f([
    ['1', 'Zlín', '', 'Bartošova Čtvrť', '', 'CZ', '', '', '', '', '', ''],
    ['2', 'Zlín', '', 'Zborovská', '', 'CZ', '', '', '', '', '', ''],
    ['3', 'Otrokovice', '', 'žel.st.', '', 'CZ', '', '', '', '', '', ''],
  ]),
  'linky.txt': f([['785002', 'Zlín MHD 2', '1', 'M', 'T', '0', '0', '0', '0', '', '', '', '', '01092026', '31122026', '1', '1']]),
  'pevnykod.txt': f([['1', 'X', ''], ['2', '+', '']]),
  'spoje.txt': f([
    ['785002', '1', '1', '', '', '', '', '', '', '', '', '', '', '1'],
    ['785002', '2', '', '', '', '', '', '', '', '', '', '', '', '1'],
    ['785002', '3', '', '', '', '', '', '', '', '', '', '', '', '1'],
  ]),
  'caskody.txt': f([['785002', '3', '1', '1', '4', '28102026', '', '', '1']]),
  'zasspoje.txt': f([
    ['785002', '1', '1', '1', '', '', '', '', '', '0', '', '0550', '1'],
    ['785002', '1', '2', '2', '', '', '', '', '', '1', '', '0552', '1'],
    ['785002', '1', '3', '3', '', '', '', '', '', '9', '0610', '', '1'],
    ['785002', '2', '1', '1', '', '', '', '', '', '9', '2359', '', '1'],
    ['785002', '2', '2', '2', '', '', '', '', '', '8', '', '|', '1'],
    ['785002', '2', '3', '3', '', '', '', '', '', '0', '', '2340', '1'],
    ['785002', '3', '1', '1', '', '', '', '', '', '0', '', '1200', '1'],
    ['785002', '3', '2', '2', '', '', '', '', '', '1', '', '1202', '1'],
    ['785002', '3', '3', '3', '', '', '', '', '', '9', '1220', '', '1'],
  ]),
};

test('builds line timetable from JDF', () => {
  // 26. 10. 2026 je pondělí, 28. 10. svátek (středa).
  const tt = buildTimetables(JDF, { startDate: '2026-10-26', days: 7 });
  assert.equal(tt.lines.length, 1);
  const line = tt.lines[0];
  assert.equal(line.ref, '2');
  assert.equal(line.type, 'trolleybus');
  const [a, b] = line.directions;
  assert.equal(a.id, 'A');
  assert.deepEqual(a.stops.map((i) => tt.stopNames[i]), ['Bartošova Čtvrť', 'Zborovská', 'Otrokovice,žel.st.']);
  assert.equal(a.headsign, 'Otrokovice,žel.st.');
  assert.deepEqual(a.trips[0].t, [350, 352, 370]);
  // spoj 1 jen v pracovní dny: po, út, (st svátek ne), čt, pá
  assert.equal(a.masks[a.trips[0].d], '1101100');
  // spoj 3 denně kromě 28. 10.
  assert.equal(a.masks[a.trips[1].d], '1101111');
  // zpětný směr: 23:40 -> přes půlnoc 23:59 (projetá zastávka vynechána)
  assert.equal(b.headsign, 'Bartošova Čtvrť');
  assert.deepEqual(b.trips[0].t, [1420, 1439]);
});

test('czech holidays include Easter', () => {
  const h = czechHolidays(2026);
  assert.ok(h.has('2026-04-03') && h.has('2026-04-06') && h.has('2026-12-24'));
  assert.equal(runsOn('2026-04-06', ['X'], [], h), false);
  assert.equal(runsOn('2026-04-06', ['+'], [], h), true);
});

test('assembleLines řadí zastávky spojů z vozovny před první společnou zastávku', async () => {
  const { assembleLines } = await import('../scripts/jdf-lib.mjs');
  const names = ['A', 'B', 'C', 'D', 'X'];
  const trip = (stops) => ({ stops, times: stops.map((_, i) => 600 + i), mask: '1' });
  const result = new Map([['2', { ref: '2', type: 'bus', name: '', dirs: { A: [trip([0, 1, 2, 3]), trip([0, 1, 2, 3]), trip([4, 2, 3])], B: [] } }]]);
  const [line] = assembleLines(result, names);
  assert.deepEqual(line.directions[0].stops.map((i) => names[i]), ['A', 'B', 'X', 'C', 'D']);
});
