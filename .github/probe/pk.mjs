import { preparePlanner } from '../../src/planner.js';
import { parseJih } from '../../src/jihlava.js';
const LIVE = 'https://janeckad.github.io/polohy/';
const P = preparePlanner(await (await fetch(LIVE + 'tt/planner.json')).json());
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
const ctx = { P, date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
for (let round = 0; round < 3; round++) {
  const r = await (await fetch('https://gis.jihlava-city.cz/server1/rest/services/verejnost/Ji_MHD_aktualni/MapServer/47/query?where=1%3D1&outFields=*&returnGeometry=false&f=json')).json();
  const list = r.features.map((f) => f.attributes);
  const vs = list.map((a) => parseJih(a, ctx)).filter(Boolean);
  console.log(`round ${round} at ${ctx.min}: ${list.length} vozů, se spojem ${vs.filter((v) => v.tripId != null).length}`);
  for (const v of vs) { const a = list.find((x) => `jih-${x.carnum}` === v.id); console.log(' ', v.tripId != null ? 'OK ' : 'BEZ', v.type, v.line, v.licence, '|', a.posledni, '→', v.next, '|', a.konecna, '| zp', a.delayinmins, v.operatorName); }
  await new Promise((r) => setTimeout(r, 40000));
  ctx.min += 0; const p2 = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value])); ctx.min = Number(p2.hour) * 60 + Number(p2.minute);
}
