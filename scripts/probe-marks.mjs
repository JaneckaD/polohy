// Dočasná diagnostika písmen spojů DSZO (spouští jen probe workflow).
import { unzipSync } from 'fflate';
import { dszoMarks, normStop } from './dszo-notes.mjs';
const files = unzipSync(new Uint8Array(await (await fetch('https://www.dszo.cz/jr/dszo_jr_2026-10-01.zip?foo=20260930')).arrayBuffer()));
const d = dszoMarks(files);
const P = await (await fetch('https://janeckad.github.io/polohy/tt/planner.json')).json();
for (const line of ['38', '1', '3', '4', '9', '31']) {
  console.log('== line', line, JSON.stringify(d.notes[line]));
  const keys = [...d.marks.keys()].filter((k) => k.startsWith(`${line}|`));
  console.log('pdf keys', keys.length, keys.slice(0, 12).join(' ; '));
  const stopsPdf = new Set(keys.map((k) => k.split('|')[1]));
  const pats = P.patterns.map((p, i) => [p, i]).filter(([p]) => p.r === line && !p.c && p.y !== 'v');
  const stopsPl = new Set(pats.flatMap(([p]) => p.s.map((s) => normStop(P.stops[s][0]))));
  console.log('pdf stops', [...stopsPdf].join(','));
  console.log('planner stops', [...stopsPl].slice(0, 60).join(','));
  // časy plánovače na první zastávce z PDF
  const s0 = [...stopsPdf][0];
  const times = [];
  for (const t of P.trips) {
    const p = P.patterns[t[0]];
    if (p.r !== line || p.c) continue;
    let m = t[2];
    p.s.forEach((si, k) => {
      if (k > 0) m += t[2 + k];
      if (normStop(P.stops[si][0]) === s0) times.push(`${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    });
  }
  console.log('planner times at', s0, [...new Set(times)].sort().slice(0, 40).join(' '));
}
