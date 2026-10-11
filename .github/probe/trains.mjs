// Dočasná sonda: které živé vlaky nemají jízdní řád nebo trasu po kolejích.
import { readFileSync } from 'node:fs';
import { parseTrain } from '../../src/trains.js';
import { trainTrip, trainPosition } from '../../src/train-trip.js';
import { RailNetwork, railGeometry } from '../../src/railroute.js';
import { preparePlanner } from '../../src/planner.js';
import { regionContains } from '../../src/region.js';

const [trainsFile, plannerFile, railsFile, regionFile] = process.argv.slice(2);
const region = JSON.parse(readFileSync(regionFile, 'utf8'));
const P = preparePlanner(JSON.parse(readFileSync(plannerFile, 'utf8')));
const net = new RailNetwork(JSON.parse(readFileSync(railsFile, 'utf8')).lines);
const raw = JSON.parse(readFileSync(trainsFile, 'utf8')).trains ?? [];
const now = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
const [date, hm] = now.split(' ');
const min = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const trains = raw.map((t) => parseTrain(t, region)).filter(Boolean);
console.log(`živé vlaky v kraji: ${trains.length} (z ${raw.length}), ${date} ${hm}`);
for (const v of trains) {
  const trip = trainTrip(P, v.number, date, min);
  if (!trip?.length) {
    console.log(`BEZ JŘ  ${v.code} ${v.number} ${v.operator?.short} | ${v.from} → ${v.headsign} | u ${v.stop}`);
    continue;
  }
  const pos = trainPosition(trip, v, min);
  const geo = railGeometry(net, trip);
  const inKraj = (s) => s.lat != null && regionContains(region, s.lon, s.lat);
  const missing = [];
  geo.segments.forEach((seg, i) => {
    if (!seg && inKraj(trip[i]) && inKraj(trip[i + 1])) missing.push(`${trip[i].name}→${trip[i + 1].name}`);
  });
  console.log(`${missing.length ? 'DÍRY  ' : 'OK    '} ${v.code} ${v.number} | ${trip[0].name} → ${trip.at(-1).name} | poloha ${pos.current} ${pos.atStop ? 'stojí' : 'jede'} | ${missing.join('; ')}`);
}
