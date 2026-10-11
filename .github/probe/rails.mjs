// Dočasná sonda: proč mezi stanicemi u odboček (Hulín, Valašské Meziříčí, Vsetín) není cesta po kolejích.
import { readFileSync } from 'node:fs';
import { RailNetwork } from '../../src/railroute.js';
const lines = JSON.parse(readFileSync(process.argv[2], 'utf8')).lines;
const net = new RailNetwork(lines);
const comp = new Array(net.pts.length).fill(-1);
let c = 0;
for (let s = 0; s < net.pts.length; s++) {
  if (comp[s] >= 0) continue;
  const stack = [s];
  comp[s] = c;
  while (stack.length) for (const [v] of net.adj[stack.pop()]) if (comp[v] < 0) { comp[v] = c; stack.push(v); }
  c++;
}
const size = {};
comp.forEach((x) => (size[x] = (size[x] ?? 0) + 1));
console.log(`body ${net.pts.length}, komponent ${c}, velikosti ${Object.values(size).sort((a, b) => b - a).slice(0, 15).join(',')}`);
const m = (a, b) => Math.hypot((a[0] - b[0]) * 72700, (a[1] - b[1]) * 111200);
for (const [name, lat, lon] of [['Hulín', 49.3155, 17.4648], ['Kroměříž', 49.2932, 17.3893], ['Valašské Meziříčí', 49.4703, 17.9608], ['Vsetín', 49.3386, 17.9939], ['Krhová', 49.4845, 17.989], ['Ústí u Vsetína', 49.3529, 18.0129], ['Třebětice', 49.304, 17.502], ['Holešov', 49.3317, 17.5718]]) {
  const p = [lon, lat];
  const hit = net.nearest(p, 400);
  const near = net.pts.map((q, i) => [i, m(p, q)]).filter(([, d]) => d < 1500);
  const comps = {};
  for (const [i, d] of near) comps[comp[i]] = Math.min(comps[comp[i]] ?? 1e9, Math.round(d));
  console.log(`${name}: přichycení ${hit ? `${Math.round(hit.dist)} m, komponenta ${comp[net.segs[hit.seg][0]]}` : 'žádné'}; komponenty do 1,5 km: ${JSON.stringify(comps)}`);
  // nejbližší body různých komponent u stanice
  const keys = Object.keys(comps).map(Number);
  for (let a = 0; a < keys.length; a++)
    for (let b = a + 1; b < keys.length; b++) {
      let best = 1e9;
      for (const [i] of near) if (comp[i] === keys[a]) for (const [j] of near) if (comp[j] === keys[b]) best = Math.min(best, m(net.pts[i], net.pts[j]));
      console.log(`   mezera komponent ${keys[a]}–${keys[b]}: ${Math.round(best)} m`);
    }
}
