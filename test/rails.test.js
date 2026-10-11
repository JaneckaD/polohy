import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRails, mergeLines, simplify } from '../scripts/rails-lib.mjs';

const way = (id, pts) => ({ type: 'way', id, geometry: pts.map(([lon, lat]) => ({ lon, lat })) });

test('navazující úseky trati se spojí do jedné čáry, odbočka zůstane zvlášť', () => {
  const r = buildRails({
    elements: [
      way(1, [[17.5, 49.2], [17.51, 49.2]]),
      way(2, [[17.52, 49.2], [17.51, 49.2]]), // opačný směr
      way(3, [[17.52, 49.2], [17.53, 49.2]]),
      way(3, [[17.52, 49.2], [17.53, 49.2]]), // duplicita
    ],
  });
  assert.equal(r.ways, 3);
  assert.equal(r.lines.length, 1);
  assert.deepEqual(r.lines[0][0], [17.5, 49.2]);
  assert.deepEqual(r.lines[0].at(-1), [17.53, 49.2]);
  const branched = mergeLines([
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
    [[1, 0], [1, 1]],
  ]);
  assert.equal(branched.length, 3);
});

test('zjednodušení vynechá body na přímce', () => {
  const line = [[17.5, 49.2], [17.505, 49.2], [17.51, 49.2], [17.51, 49.21]];
  assert.deepEqual(simplify(line), [[17.5, 49.2], [17.51, 49.2], [17.51, 49.21]]);
});

test('poloha zastávky z jízdního řádu se opraví na místo zastavení v OSM se stejným názvem', async () => {
  const { stopCorrector } = await import('../scripts/routes-lib.mjs');
  const correct = stopCorrector([
    ['Zlín, náměstí Míru', 49.22610, 17.66500, 'p'],
    ['Zlín, náměstí Míru', 49.22600, 17.66520, 's'],
    ['Dlouhá', 49.22605, 17.66510, 's'], // jiný název
    ['náměstí Míru', 49.23500, 17.66500, 's'], // moc daleko
  ]);
  assert.deepEqual(correct('náměstí Míru', 49.22546, 17.66479), [49.226, 17.6652]);
  assert.deepEqual(correct('Prštné', 49.21996, 17.64071), [49.21996, 17.64071]);
  assert.equal(correct.stats.moved, 1);
});

test('zastávka na obou stranách silnice: jeden bod uprostřed pro oba směry', async () => {
  const { stopCorrector } = await import('../scripts/routes-lib.mjs');
  const correct = stopCorrector([
    ['Zborovská', 49.2266, 17.7017, 's'], // severní strana
    ['Zborovská', 49.2263, 17.7017, 's'], // jižní strana
    ['Školní', 49.2215, 17.685, 's'], // jen jedna strana
  ]);
  assert.deepEqual(correct('Zborovská', 49.22648, 17.7017), [49.22645, 17.7017]);
  assert.deepEqual(correct('Školní', 49.2222, 17.685), [49.2215, 17.685]);
  // Daleko od nástupišť se stejným názvem zůstane poloha z jízdního řádu.
  assert.deepEqual(correct('Školní', 49.24, 17.685), [49.24, 17.685]);
});

test('otočka do protisměru na trase se pozná', async () => {
  const { uTurns } = await import('../scripts/routes-lib.mjs');
  // Rovně, kruhový objezd (smyčka bez návratu po stejné silnici) a otočka zpět po stejné silnici.
  assert.equal(uTurns([[17.70, 49.2], [17.701, 49.2], [17.702, 49.2], [17.705, 49.2]]).length, 0);
  assert.equal(uTurns([[17.70, 49.2], [17.703, 49.2], [17.7033, 49.2002], [17.703, 49.2004], [17.7027, 49.2002], [17.703, 49.2], [17.706, 49.2]]).length, 0);
  assert.equal(uTurns([[17.70, 49.2], [17.704, 49.2], [17.702, 49.20005], [17.702, 49.205]]).length, 1);
});

test('klička jen kvůli otočení se z trasy odstraní, zajížďka na zastávku zůstane', async () => {
  const { removeDetours } = await import('../scripts/routes-lib.mjs');
  // Na východ, 300 m dál otočka zpět o 200 m po stejné silnici (o 5 m vedle) a odbočka na sever.
  const line = [[17.70, 49.2], [17.704, 49.2], [17.70675, 49.20005], [17.704, 49.20005], [17.704, 49.205]];
  const stops = [['A', 49.2, 17.70], ['B', 49.2, 17.704], ['C', 49.205, 17.704]];
  const out = removeDetours(line, stops);
  assert.ok(out.length < line.length, JSON.stringify(out));
  assert.ok(!out.some(([x]) => x > 17.705));
  // Stejná klička se zastávkou na konci zajížďky zůstane.
  const kept = removeDetours(line, [...stops, ['D', 49.20005, 17.70675]]);
  assert.deepEqual(kept, line);
});
