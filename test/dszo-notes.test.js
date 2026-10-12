import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePage, normStop, applyMarks } from '../scripts/dszo-notes.mjs';

// Výřez textu z PDF jízdního řádu DSZO (pdftotext -layout), linka 8.
const PAGE = [
  '       8                                                                                                 Platnost od 1.9.2026 do 12.12.2026',
  '                 Zlín,Jižní Svahy,Kocanda - Zlín,Jižní Svahy,Kocanda',
  ' Čas   Název zastávky                                 Pracovní dny                    Školní prázdniny       Víkend      INFORMACE PRO CESTUJÍCÍ:',
  '        Valachův žleb                   00                                                                                Všechny spoje jsou zajištěny',
  ' 0     Česká                      ',
  ' 9     U Zámku                                                                                                      SMS jízdenka: číslo 902 06',
  ' 13    Dlouhá                         07    00 10 13L 24 36 53d                 08 23 38 53            08 33 53     DSZO - 30 Kč / 70 min.',
  '                                       16    03 18 29d 33 48                     04 19 34 49            12 32 52',
  ' Poznámky u zastávek:                   Poznámky u spojů:                                                             Na lince platí tarif a smluvní přepravní',
  '   - automat na jízdenky                d - končí v zast. Baťova nem.                                                     podmínky MHD Zlín-Otrokovice',
  '  x - na znamení                         L - ze zast. Školní jede na Lesní Čtvrť',
].join('\n');

test('písmena spojů DSZO z textu PDF', () => {
  const p = parsePage(PAGE);
  assert.equal(p.line, '8');
  assert.equal(p.stop, 'Česká');
  assert.deepEqual(p.marks, [['07:13', 'L'], ['07:53', 'd'], ['16:29', 'd']]);
  assert.deepEqual(p.notes, { d: 'končí v zast. Baťova nem.', L: 'ze zast. Školní jede na Lesní Čtvrť' });
  assert.equal(normStop('Zlín, Jižní Svahy, Kocanda'), normStop('Jižní Svahy,Kocanda'));
});

test('písmena se přiřadí spojům podle zastávky a času', () => {
  const planner = {
    stops: [['Česká'], ['Dlouhá'], ['Baťova nem.']],
    patterns: [{ r: '8', y: 't', h: 'Baťova nem.', s: [0, 1, 2] }, { r: '8', y: 'b', c: 'km', h: 'x', s: [0, 1] }],
    trips: [[0, 0, 7 * 60 + 53, 3, 5], [0, 0, 7 * 60 + 40, 3, 5], [1, 0, 7 * 60 + 53, 1]],
  };
  const marks = new Map([['8|ceska|07:53', 'd'], ['8|ceska|07:13', 'L']]);
  applyMarks(planner, { marks, notes: { 8: { d: 'končí v zast. Baťova nem.', L: '…' } } });
  assert.deepEqual(planner.marks, { 0: 'd' });
  assert.deepEqual(planner.notes, { 8: { d: 'končí v zast. Baťova nem.' } });
});

test('vůz DSZO dostane písmeno spoje, kterým právě jede', async () => {
  const { vehicleMark } = await import('../src/dszo-marks.js');
  const pat = { r: '8', y: 't', h: 'Baťova nem.', s: [0, 1, 2] };
  const P = {
    startDate: '2026-10-12',
    days: 2,
    notes: { 8: { d: 'končí v zast. Baťova nem.' } },
    stops: [{ name: 'Česká' }, { name: 'Dlouhá' }, { name: 'Baťova nem.' }],
    trips: [
      { pattern: pat, mask: '11', times: [473, 476, 481], mark: 'd' },
      { pattern: { ...pat, h: 'Jižní Svahy, Kocanda' }, mask: '11', times: [473, 476, 481], mark: null },
    ],
  };
  const v = { line: '8', type: 'trolleybus', stop: 'Dlouhá', headsign: 'Baťova nem.', delay: 60 };
  assert.deepEqual(vehicleMark(P, v, '2026-10-12', 478), { mark: 'd', note: 'končí v zast. Baťova nem.' });
  assert.equal(vehicleMark(P, { ...v, headsign: 'Jižní Svahy,Kocanda' }, '2026-10-12', 478), null);
  assert.equal(vehicleMark(P, { ...v, line: '2' }, '2026-10-12', 478), null);
});
