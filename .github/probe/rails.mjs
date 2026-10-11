// Dočasná sonda: proč mezi stanicemi u odboček není cesta po kolejích.
import { readFileSync } from 'node:fs';
import { RailNetwork } from '../../src/railroute.js';
const lines = JSON.parse(readFileSync(process.argv[2], 'utf8')).lines;
const P = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const st = (n) => P.stops.find((s) => s[0] === n);
const m = (a, b) => Math.hypot((a[0] - b[0]) * 72700, (a[1] - b[1]) * 111200);
for (const [x, y] of [['Kroměříž', 'Hulín'], ['Hulín', 'Třebětice'], ['Hulín', 'Holešov'], ['Valašské Meziříčí', 'Krhová'], ['Valašské Meziříčí', 'Branky na Moravě'], ['Valašské Meziříčí', 'Zašová'], ['Vsetín', 'Ústí u Vsetína zastávka'], ['Hulín', 'Otrokovice']]) {
  const net = new RailNetwork(lines);
  const A = st(x), B = st(y);
  if (!A || !B) { console.log('chybí stanice', x, y); continue; }
  const ha = net.nearest([A[2], A[1]], 400), hb = net.nearest([B[2], B[1]], 400);
  const a = net.snap(A[1], A[2]), b = net.snap(B[1], B[2]);
  // Dijkstra bez limitu
  const dist = new Map([[a, 0]]); const todo = [[0, a]]; const done = new Set();
  while (todo.length) { todo.sort((p, q) => p[0] - q[0]); const [d, u] = todo.shift(); if (done.has(u)) continue; done.add(u); if (u === b) break; for (const [v, w] of net.adj[u]) if (d + w < (dist.get(v) ?? Infinity)) { dist.set(v, d + w); todo.push([d + w, v]); } }
  const direct = m([A[2], A[1]], [B[2], B[1]]);
  console.log(`${x} (${A[1]},${A[2]}) → ${y} (${B[1]},${B[2]}): přímo ${Math.round(direct)} m, přichycení ${ha ? Math.round(ha.dist) : '-'} / ${hb ? Math.round(hb.dist) : '-'} m, body ${a}/${b}, po kolejích ${dist.has(b) ? Math.round(dist.get(b)) : 'NEDOSTUPNÉ'} m, limit ${Math.round(direct * 3 + 2000)}, path ${net.path([A[1], A[2]], [B[1], B[2]]) ? 'ok' : 'null'}`);
  if (a >= 0) console.log(`   okolí A: stupně ${[...new Set(net.adj[a].map(([v]) => net.adj[v].length))].join(',')}, sousedé ${net.adj[a].length}`);
}
// v2
// v3
