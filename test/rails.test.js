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
