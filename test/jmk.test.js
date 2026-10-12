import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { identifyTrain, completeTrains } from '../src/train-trip.js';
import { parseTrain } from '../src/trains.js';
import { krajOf, regionContains } from '../src/region.js';
import { describe as describeVehicle, matchesFilter, setFilterRegion, normalizeFilter } from '../src/filtering.js';

const region = JSON.parse(readFileSync(new URL('../public/region.json', import.meta.url), 'utf8'));

test('oblast: Zlínský a Jihomoravský kraj, kraj podle polohy', () => {
  assert.ok(regionContains(region, 17.6667, 49.2265)); // Zlín
  assert.ok(regionContains(region, 16.6068, 49.1951)); // Brno
  assert.ok(regionContains(region, 16.0487, 48.8555)); // Znojmo
  assert.ok(!regionContains(region, 17.2509, 49.5938)); // Olomouc
  assert.ok(!regionContains(region, 15.5870, 49.3961)); // Jihlava
  assert.equal(krajOf(region, 17.6667, 49.2265), 'zlk');
  assert.equal(krajOf(region, 16.6068, 49.1951), 'jmk');
  assert.equal(krajOf(region, 17.2509, 49.5938), null);
});

test('filtr Kraj: vlak v Brně patří do Jihomoravského kraje, DSZO do Zlínského', () => {
  setFilterRegion(region);
  const brno = { type: 'train', kind: 'os', operator: { short: 'ČD' }, lat: 49.19, lon: 16.61 };
  assert.equal(describeVehicle(brno).region, 'jmk');
  assert.equal(describeVehicle({ type: 'bus', line: '31', lat: 49.22, lon: 17.66 }).region, 'zlk');
  assert.ok(matchesFilter(brno, normalizeFilter({ regions: ['jmk'] })));
  assert.ok(!matchesFilter(brno, normalizeFilter({ regions: ['zlk'] })));
  setFilterRegion(null);
});

// Malé jízdní řády: linka S3 tam a zpět mezi Tišnovem a Brnem.
const P = {
  startDate: '2026-10-12',
  days: 2,
  stops: [
    { name: 'Tišnov', lat: 49.3487, lon: 16.4206 },
    { name: 'Kuřim', lat: 49.2981, lon: 16.5334 },
    { name: 'Brno hl.n.', lat: 49.1903, lon: 16.6126 },
  ],
  trips: [
    { pattern: { y: 'v', n: '4703', k: 'Os', o: 'České dráhy, a.s.', l: 'S3 Os 4703', s: [0, 1, 2] }, mask: '11', times: [600, 612, 630], arr: [600, 611, 630] },
    { pattern: { y: 'v', n: '4702', k: 'Os', o: 'České dráhy, a.s.', l: 'S3 Os 4702', s: [2, 1, 0] }, mask: '11', times: [600, 618, 630], arr: [600, 617, 630] },
    { pattern: { y: 'v', n: '4801', k: 'Os', o: 'České dráhy, a.s.', l: 'S4 Os 4801', s: [0, 1, 2] }, mask: '11', times: [600, 612, 630], arr: [600, 611, 630] },
  ],
};

test('vlak z mapy IDS JMK: číslo a dopravce podle linky, polohy a cíle', () => {
  // Mezi Tišnovem a Kuřimí v 10:06, se zpožděním 0, směr Brno.
  const v = parseTrain({ lat: 49.323, lon: 16.477, tt: 'Os', tn: '', line: 'S3', ln: 'Hlavní nádraží', d: '', de: 0, a: 135, src: 'jmk', vid: 31011 }, region);
  assert.equal(v.id, 'vlak-jmk-31011');
  assert.equal(v.lineName, 'S3');
  const w = identifyTrain(P, v, '2026-10-12', 606);
  assert.equal(w.number, '4703');
  assert.equal(w.id, 'vlak-Os-4703');
  assert.equal(w.operator.short, 'ČD');
  assert.equal(w.headsign, 'Brno hl.n.');
  // Úplně jinde (Znojmo): jízdu nenajdeme, vlak zůstane bez čísla.
  assert.equal(identifyTrain(P, { ...v, lat: 48.85, lon: 16.05 }, '2026-10-12', 606).number, '');
});

test('vlaky z mapy IDS JMK, které už máme z mapy IDZK, se nezdvojí', () => {
  const idzk = parseTrain({ lat: 49.323, lon: 16.477, tt: 'Os', tn: '4703', d: 'ČD', de: 0, a: 135 }, region);
  const jmk = parseTrain({ lat: 49.3231, lon: 16.4771, tt: 'Os', tn: '', line: 'S3', ln: 'Brno hl.n.', d: '', de: 0, a: 135, src: 'jmk', vid: 1 }, region);
  const other = parseTrain({ lat: 49.25, lon: 16.58, tt: 'Os', tn: '', line: 'S3', ln: 'Tišnov', d: '', de: 0, a: 315, src: 'jmk', vid: 2 }, region);
  const list = completeTrains(P, [idzk, jmk, other], '2026-10-12', 606);
  assert.deepEqual(list.map((v) => v.number), ['4703', '4702']);
  // Bez jízdních řádů: vlak do 400 m od vlaku z mapy IDZK vynecháme, ostatní zůstanou bez čísla.
  assert.equal(completeTrains(null, [idzk, jmk, other], '2026-10-12', 606).length, 2);
});
