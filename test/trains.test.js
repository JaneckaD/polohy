import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { krovakToWgs } from '../src/krovak.js';
import { parseTrain, trainKind, trainOperator } from '../src/trains.js';

const region = JSON.parse(readFileSync(new URL('../public/region.json', import.meta.url)));

test('S-JTSK → WGS84 sedí na metr (porovnáno s PROJ)', () => {
  const [lon, lat] = krovakToWgs(-524630.2005866765, -1187194.2690372884);
  assert.ok(Math.abs(lon - 17.6466) < 2e-5 && Math.abs(lat - 49.0251) < 2e-5, `${lon} ${lat}`);
});

test('vlak v kraji: druh, dopravce, zpoždění, směr', () => {
  const v = parseTrain(
    { x: -524630.2, y: -1187194.27, tt: 'R', tn: '891', na: 'Slovácký expres', fn: 'Praha jih', ln: 'Luhačovice', cna: 'Hradčovice', nsn: 'Uherský Brod', nst: '16:56', nsp: '17:02', cp: '16:50', cr: '16:56', de: 6, d: 'České dráhy, a.s.', a: 116.6 },
    region,
  );
  assert.equal(v.type, 'train');
  assert.equal(v.line, 'R 891');
  assert.equal(v.kind, 'r');
  assert.equal(v.operator.short, 'ČD');
  assert.equal(v.delay, 360);
  assert.equal(v.headsign, 'Luhačovice');
  assert.equal(Math.round(v.bearing), 117);
});

test('vlak mimo kraj (Prostějov) se neukáže, prázdný směr = neznámý', () => {
  assert.equal(parseTrain({ x: -558584.2, y: -1133949.6, tt: 'Os', tn: '3734', de: 0, d: 'České dráhy, a.s.', a: '' }, region), null);
  const v = parseTrain({ x: -524630.2, y: -1187194.27, tt: 'Os', tn: '4313', de: '', d: 'ARRIVA vlaky s.r.o.', a: '' }, region);
  assert.equal(v.bearing, null);
  assert.equal(v.delay, null);
  assert.equal(v.operator.short, 'Arriva');
});

test('druhy vlaků a dopravci', () => {
  assert.equal(trainKind('Os'), 'os');
  assert.equal(trainKind('Sp'), 'sp');
  assert.equal(trainKind('RJ'), 'r');
  assert.equal(trainKind('LE'), 'r');
  assert.equal(trainKind('EC'), 'int');
  assert.equal(trainKind('rj'), 'int');
  assert.equal(trainOperator('RegioJet ÚK a.s.').short, 'RegioJet');
  assert.equal(trainOperator('Leo Express Tenders s.r.o.').short, 'Leo Express');
  assert.equal(trainOperator('Gepard Express, SE').short, 'Gepard Express');
});
