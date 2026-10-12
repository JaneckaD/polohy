import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerFromTrips } from '../scripts/planner-data.mjs';
import { preparePlanner } from '../src/planner.js';
import { parseOdis, matchOdisTrip } from '../src/odis.js';
import { estimatedVehicles, setLiveTrips } from '../src/estimated.js';
import { describe } from '../src/filtering.js';

const mask = '111';
const tramStops = [['Ostrava,Hranečník', 49.8253, 18.3203], ['Ostrava,Hrabůvka,Poliklinika', 49.7857, 18.2634], ['Ostrava,Dubina', 49.7816, 18.2207]];
const busStops = [['Havířov,Podlesí,aut.nádr.', 49.7766, 18.4258], ['Karviná,Nové Město,ČSAD', 49.857, 18.5401], ['Karviná,Fryštát,aut.nádr.', 49.8568, 18.5485]];
const raw = [
  { ref: '915012', type: 'tram', city: 'town', operator: 'MHD Ostrava', number: '132', mask, times: [1100, 1115, 1122], stops: tramStops },
  { ref: '912533', type: 'bus', city: 'other', operator: 'Transdev Slezsko', number: '48', mask, times: [1100, 1125, 1128], stops: busStops },
];
const P = preparePlanner(buildPlannerFromTrips({ startDate: '2026-10-12', days: 3, rawTrips: raw }));

test('ODIS: tramvaj MHD Ostrava podle čísla linky a spoje (licence 915…)', () => {
  const t = { t: 'H', cat: 3, cr: 'DPO', cn: '12|12|132|||Hrabůvka,Poliklinika|157|1119|Hranečník|Dubina|1|Ev. č. 1721', x: 49.80, y: 18.29, ico: 'a_180.png', ds: '$z2~min.~37~s' };
  const v = parseOdis(t, { P, date: '2026-10-12', min: 1110 });
  assert.equal(v.type, 'tram');
  assert.equal(v.city, 'town');
  assert.equal(v.line, '12');
  assert.equal(v.operatorName, 'MHD Ostrava');
  assert.equal(v.plate, 'ev. č. 1721');
  assert.equal(v.delay, 157);
  assert.equal(v.calls.length, 3);
  assert.equal(v.nextIndex, 1, 'jede k Poliklinice');
  assert.equal(v.atStop, false);
  assert.equal(v.next, 'Ostrava,Hrabůvka,Poliklinika'.replace(/,\s*/, ', '));
  assert.equal(describe(v).kind, 'tram');
  // Číslo spoje nesedí (MHD Ostrava posílá pořadí vozu): spoj podle linky, příští zastávky a cíle.
  const other = parseOdis({ ...t, cn: t.cn.replace('|132|', '|999|') }, { P, date: '2026-10-12', min: 1110 });
  assert.equal(other.tripId, v.tripId);
  // Názvy na mapě bez obce a části („Poliklinika“) i s jinou obcí v cíli.
  const short = parseOdis({ ...t, cn: '12|12|999|||Poliklinika|157|1119|Hranečník|Ostrava, Dubina|1|Ev. č. 1721' }, { P, date: '2026-10-12', min: 1110 });
  assert.equal(short.tripId, v.tripId);
  assert.equal(parseOdis({ ...t, cn: t.cn.replace('|132|', '|999|').replace('|Dubina|', '|Hranečník|') }, { P, date: '2026-10-12', min: 1110 }).calls, undefined, 'jiný cíl');
  // Bez dat vyhledávání: druh podle čísla linky.
  assert.equal(parseOdis(t).type, 'tram');
  assert.equal(parseOdis({ ...t, cn: '102|102|52|||Hlavní nádraží|0|1122|Hlavní nádraží|Hulváky|1|Ev. č. 3746' }).type, 'trolleybus');
});

test('ODIS: regionální autobus podle licence a čísla spoje, živý spoj se neukáže odhadem', () => {
  const t = { t: 'H', cat: 2, cr: 'Transdev Slezsko pr. Havířov', cn: '912533|533|48|Karviná,Nové Město,stadion házené|1|Karviná,Nové Město,ČSAD|0|1118|Havířov,Podlesí,aut.nádr.|Karviná,Fryštát,aut.nádr.|1|1TY6420', x: 49.85, y: 18.53, ico: 'a_210.png', ds: '$z0~min.~01~s' };
  const v = parseOdis(t, { P, date: '2026-10-12', min: 1120 });
  assert.equal(v.city, 'other');
  assert.equal(v.line, '533');
  assert.equal(v.operatorName, 'Transdev Slezsko');
  assert.equal(v.nextIndex, 1);
  assert.equal(describe(v).kind, 'regional');
  assert.ok(matchOdisTrip(P, '912533', '48', '2026-10-12', 1120));
  assert.equal(matchOdisTrip(P, '912533', '49', '2026-10-12', 1120), null);
  // Odhad podle jízdního řádu ukáže oba spoje, dokud nejedou živě.
  setLiveTrips([]);
  assert.equal(estimatedVehicles(P, null, '2026-10-12', 1110).length, 2);
  setLiveTrips([v.tripId]);
  const est = estimatedVehicles(P, null, '2026-10-12', 1110);
  assert.equal(est.length, 1);
  assert.equal(est[0].type, 'tram');
  assert.equal(est[0].operatorName, 'MHD Ostrava');
  setLiveTrips([]);
});

test('ODIS: vlaky a záznamy jiných systémů se přeskočí', () => {
  assert.equal(parseOdis({ t: 'T', cat: 1, cn: 'Os 3319|S3|3319', x: 49.9, y: 18.3 }), null);
  assert.equal(parseOdis({ t: 'E', cat: 0, cn: 1066, x: 49.5, y: 18.2 }), null);
});
