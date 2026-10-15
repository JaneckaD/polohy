// Ověření Pardubického kraje na skutečných datech: IREDO a MHD Pardubice proti nasazeným jízdním řádům.
import { preparePlanner } from '../../src/planner.js';
import { parseIredo } from '../../src/idsok.js';
import { parsePce } from '../../src/pardubice.js';
const LIVE = 'https://janeckad.github.io/polohy/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/129';
const P = preparePlanner(await (await fetch(LIVE + 'tt/planner.json')).json());
const region = await (await fetch(LIVE + 'region.json')).json();
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
const ctx = { P, region, date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
console.log('ctx', ctx.date, ctx.min, 'planner trips', P.trips.length);
const tally = (list, f) => JSON.stringify(Object.entries(list.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]));

const ired = (await (await fetch('https://iredo.online/map/mapData', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, body: JSON.stringify({ w: 15.25, s: 49.5, e: 16.95, n: 50.3, zoom: 13, showStops: false, mapFilterId: null }) })).json()).connections;
const iv = ired.map((s) => parseIredo(s, ctx)).filter(Boolean);
console.log(`IREDO: ${ired.length} spojů, ${iv.length} vozů v kraji, se spojem ${iv.filter((v) => v.tripId != null).length}`);
console.log('IREDO city/type', tally(iv, (v) => `${v.city}/${v.type}`));
for (const v of iv.filter((v) => v.tripId == null).slice(0, 12)) console.log('  bez spoje', v.line, v.licence, v.tripNo, v.from, '→', v.headsign, v.operatorName);
for (const v of iv.slice(0, 4)) console.log('  vzor', JSON.stringify({ line: v.line, city: v.city, type: v.type, next: v.next, headsign: v.headsign, op: v.operatorName, delay: v.delayText, stops: v.trip?.length }));

const pr = await fetch('https://api.mhdonline.cz/pardubice/vehicles', { headers: { Accept: 'application/json', Origin: 'https://online.dpmp.cz', Referer: 'https://online.dpmp.cz/', 'x-app-protocol': '26dc2897acef979d863df737827fc1ca8e88c389fba00a253a6d1ee7fe4ecabe', 'User-Agent': UA } });
console.log('DPMP status', pr.status);
const pl = (await pr.json()).vehicles ?? [];
const pv = pl.map((b) => parsePce(b, ctx)).filter(Boolean);
console.log(`MHD Pardubice: ${pl.length} vozů, se spojem ${pv.filter((v) => v.tripId != null).length}`, tally(pv, (v) => v.type));
for (const v of pv.filter((v) => v.tripId == null).slice(0, 12)) console.log('  bez spoje', v.line, v.tripNo, v.rawStop, '→', JSON.stringify(pl.find((b) => `pce-${b.vid}` === v.id)?.nextStopName), v.headsign);
for (const v of pv.slice(0, 4)) console.log('  vzor', JSON.stringify({ line: v.line, type: v.type, next: v.next, headsign: v.headsign, op: v.operatorName, delay: v.delayText, stops: v.trip?.length }));
const pat = P.trips.filter((t) => t.pattern.o === 'MHD Pardubice');
console.log('MHD Pardubice v jízdních řádech', pat.length, 'linky', [...new Set(pat.map((t) => t.pattern.r))].slice(0, 40).join(' '), 'čísla spojů', pat.slice(0, 10).map((t) => t.no).join(' '), 'trolejbusy', pat.filter((t) => t.pattern.y === 't').length);
