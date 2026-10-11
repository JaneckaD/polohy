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

test('zastávka na obou stranách silnice: vybere se ta vpravo ve směru jízdy', async () => {
  const { stopCorrector } = await import('../scripts/routes-lib.mjs');
  // Silnice vede z východu na západ; severní nástupiště je pro jízdu na východ vlevo.
  const correct = stopCorrector([
    ['Zborovská', 49.22660, 17.70170, 's'], // severní strana
    ['Zborovská', 49.22630, 17.70170, 's'], // jižní strana
  ]);
  const west = [49.2265, 17.695];
  const east = [49.2265, 17.708];
  // Na východ: vpravo je jih.
  assert.deepEqual(correct('Zborovská', 49.22648, 17.7017, west, east), [49.2263, 17.7017]);
  // Na západ: vpravo je sever.
  assert.deepEqual(correct('Zborovská', 49.22648, 17.7017, east, west), [49.2266, 17.7017]);
});

test('otočka do protisměru na trase se pozná', async () => {
  const { uTurns } = await import('../scripts/routes-lib.mjs');
  assert.equal(uTurns([[17.70, 49.2], [17.701, 49.2], [17.702, 49.2]]).length, 0);
  assert.equal(uTurns([[17.70, 49.2], [17.701, 49.2], [17.7002, 49.20001]]).length, 1);
});
