import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { kordisTrips, nationalTrips, knownEvents, jdfStopName, shortAgency, spojenkaTrips, spojenkaStopCoords, mhdTown } from '../scripts/area-buses.mjs';
import { buildPlannerFromTrips } from '../scripts/planner-data.mjs';

const region = JSON.parse(readFileSync(new URL('../public/region.json', import.meta.url), 'utf8'));
const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([n, rows]) => [n, strToU8(rows.join('\n'))])));
const CAL = ['service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date', 'S,1,1,1,1,1,1,1,20260101,20271231'];

test('názvy zastávek a dopravců z celostátních dat', () => {
  assert.equal(jdfStopName('Brno,,ÚAN Zvonařka'), 'Brno,ÚAN Zvonařka');
  assert.equal(jdfStopName('Zlín,,aut.nádr.'), 'aut.nádr.');
  assert.equal(jdfStopName('Mikulov,,'), 'Mikulov');
  assert.equal(shortAgency('ČSAD Hodonín a.s.'), 'ČSAD Hodonín');
  assert.equal(shortAgency('Znojemská dopravní společnost - PSOTA, s.r.o.'), 'Znojemská dopravní společnost - PSOTA');
  assert.equal(shortAgency('D.M.D-GROUP, spol. s r.o.'), 'D.M.D-GROUP');
});

test('IDS JMK: regionální linky, MHD Brna (i tramvaje) a MHD jiných měst', () => {
  const bytes = zip({
    'routes.txt': ['route_id,agency_id,route_short_name,route_long_name,route_type', 'L44,99,44,Brno MHD,3', 'L104,99,104,Brno - Pohořelice,3', 'L801,99,801,Znojmo MHD,3', 'L1,99,1,Tramvaj,0'],
    'trips.txt': ['route_id,service_id,trip_id,trip_short_name', 'L44,S,T1,', 'L104,S,T2,5', 'L801,S,T3,', 'L1,S,T4,'],
    'stops.txt': ['stop_id,stop_name,stop_lat,stop_lon,zone_id', 'U1Z1,Mendlovo náměstí,49.19,16.59,100', 'B,"Pohořelice, nám.",48.98,16.52,510', 'C,"Znojmo, Náměstí",48.85,16.05,800', 'D,"Znojmo, Nádraží",48.86,16.06,800'],
    'agency.txt': ['agency_id,agency_name', '99,KORDIS JMK'],
    'stop_times.txt': [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
      'T1,08:00:00,08:00:00,U1Z1,1', 'T1,08:10:00,08:10:00,U1Z1,2',
      'T2,08:00:00,08:00:00,U1Z1,1', 'T2,08:40:00,09:05:00,B,2',
      'T3,08:00:00,08:00:00,C,1', 'T3,08:05:00,08:05:00,D,2',
      'T4,08:00:00,08:00:00,U1Z1,1', 'T4,08:05:00,08:05:00,U1Z1,2',
    ],
    'calendar.txt': CAL,
  });
  const trips = kordisTrips(bytes, { startDate: '2026-10-12', days: 3 });
  const by = Object.fromEntries(trips.map((t) => [t.ref, t]));
  assert.deepEqual(Object.keys(by).sort(), ['1', '104', '44', '801']);
  assert.equal(by['104'].city, 'jmk');
  assert.deepEqual(by['104'].stops.map((s) => s[0]), ['Brno, Mendlovo náměstí', 'Pohořelice, nám.']);
  assert.deepEqual(by['104'].nodes, [1, null], 'uzel zastávky z U1Z1');
  assert.equal(by['104'].mask, '111');
  assert.deepEqual(by['104'].times, [480, 520], 'v cíli příjezd, ne odjezd další jízdy');
  assert.equal(by['104'].operator, undefined, 'KORDIS není dopravce');
  assert.equal(by['44'].city, 'brno');
  assert.equal(by['1'].city, 'brno');
  assert.equal(by['1'].type, 'tram');
  assert.equal(by['801'].city, 'jmkmhd');
  assert.equal(by['801'].operator, 'MHD Znojmo');
  // Uzly zastávek se dostanou do dat vyhledávání (živé polohy podle nich najdou zastávku).
  const P = buildPlannerFromTrips({ startDate: '2026-10-12', days: 3, rawTrips: trips });
  assert.equal(P.stops[P.nodes[1]][0], 'Brno, Mendlovo náměstí');
  assert.equal(P.patterns.find((p) => p.r === '1').y, 'r');
});

test('celostátní data: dálkový spoj zkrácený na oblast, duplicita a MHD vynechané', () => {
  const bytes = zip({
    'agency.txt': ['agency_id,agency_name', 'A1,STUDENT AGENCY k.s.', 'A2,ČSAD Hodonín a.s.', 'A3,DPMB a.s.'],
    'routes.txt': ['route_id,agency_id,route_short_name,route_type', 'R1,A1,000032,201', 'R2,A2,726504,701', 'R3,A3,999999,704'],
    'trips.txt': ['route_id,service_id,trip_id,trip_short_name', 'R1,S,T1,000032 1', 'R2,S,T2,726504 3', 'R3,S,T3,999999 1'],
    'stops.txt': [
      'stop_id,stop_name,stop_lat,stop_lon',
      'P,"Praha,,ÚAN Florenc",50.09,14.44', 'B,"Brno,,ÚAN Zvonařka",49.186,16.618', 'M,"Mikulov,,žel.st.",48.802,16.626', 'W,"Wien,,Erdberg",48.19,16.41',
      'R,"Rajhrad,,nám.",49.09,16.60',
    ],
    'stop_times.txt': [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
      'T1,08:00:00,08:00:00,P,1', 'T1,10:30:00,10:30:00,B,2', 'T1,11:10:00,11:10:00,M,3', 'T1,12:00:00,12:00:00,W,4',
      'T2,07:00:00,07:00:00,B,1', 'T2,07:30:00,07:30:00,R,2',
      'T3,07:00:00,07:00:00,B,1', 'T3,07:10:00,07:10:00,R,2',
    ],
    'calendar.txt': CAL,
  });
  // Spoj T2 už je v datech IDS JMK (stejné časy na stejných místech).
  const known = knownEvents([{ type: 'bus', city: 'jmk', times: [420, 450], stops: [['Brno, Zvonařka', 49.1862, 16.6183], ['Rajhrad, nám.', 49.0901, 16.6004]] }]);
  const trips = nationalTrips(bytes, { startDate: '2026-10-12', days: 2, region, known });
  assert.equal(trips.length, 1);
  const [t] = trips;
  assert.equal(t.city, 'rj');
  assert.equal(t.international, true);
  assert.equal(t.operator, 'STUDENT AGENCY');
  assert.equal(t.headsign, 'Wien,Erdberg');
  assert.deepEqual(t.stops.map((s) => s[0]), ['Brno,ÚAN Zvonařka', 'Mikulov,žel.st.']);
  assert.deepEqual(t.times, [630, 670]);
  assert.equal(t.number, '1');

  const P = buildPlannerFromTrips({ startDate: '2026-10-12', days: 2, rawTrips: trips });
  assert.deepEqual(P.patterns[0], { r: '000032', y: 'b', h: 'Wien,Erdberg', s: [0, 1], c: 'rj', o: 'STUDENT AGENCY', i: 1 });
});

test('Spojenka: MHD dopravních podniků (tramvaje, trolejbusy), regionální linky ne', () => {
  const bytes = zip({
    'agency.txt': ['agency_id,agency_name', 'A1,"Dopravní podnik města Olomouce, a.s."', 'A2,Transdev Slezsko a.s.', 'A3,"Městský dopravní podnik Opava, a.s."'],
    'routes.txt': ['agency_id,route_id,route_short_name,route_long_name,route_type,is_night,is_regional', 'A1,R1,2,Neředín - Hlavní nádraží,0,0,0', 'A2,R2,533,Havířov - Karviná,3,0,1', 'A3,R3,201,Opava - Kylešovice,11,0,0', 'A1,R9,S1,Vlak,2,0,1'],
    'trips.txt': ['route_id,trip_id,service_id,trip_short_name,trip_headsign,relations', 'R1,T1,S,,"Olomouc, Hlavní nádraží",SCC:895002:12', 'R2,T2,S,,,SCC:912533:48', 'R3,T3,S,,,', 'R9,T9,S,,,'],
    'stops.txt': ['stop_id,stop_name,stop_lat,stop_lon', 'O1,"Olomouc, Neředín, krematorium",49.5953,17.2272', 'O2,"Olomouc, Hlavní nádraží",49.5925,17.2770', 'H1,"Havířov, Podlesí, aut.nádr.",49.7766,18.4258', 'K1,"Karviná, Fryštát, aut.nádr.",49.8568,18.5485', 'P1,"Opava, Kylešovice, Bílovecká",49.9207,17.9127', 'P2,"Opava, Městský hřbitov",49.9400,17.8800', 'Z1,"Zlín, Náměstí Míru",49.2265,17.6667', 'Z2,"Zlín, Malenovice",49.2093,17.5303'],
    'stop_times.txt': [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
      'T1,10:00:00,10:00:00,O1,1', 'T1,10:12:00,10:12:00,O2,2',
      'T2,10:00:00,10:00:00,H1,1', 'T2,10:25:00,10:25:00,K1,2',
      'T3,10:00:00,10:00:00,P1,1', 'T3,10:10:00,10:10:00,P2,2',
      'T9,10:00:00,10:00:00,O1,1', 'T9,10:10:00,10:10:00,O2,2',
    ],
    'calendar.txt': CAL,
  });
  const trips = spojenkaTrips(bytes, { startDate: '2026-10-12', days: 2, region });
  const by = Object.fromEntries(trips.map((t) => [t.ref, t]));
  assert.deepEqual(Object.keys(by).sort(), ['201', '895002'], 'regionální linky a vlaky ne');
  assert.equal(by['895002'].type, 'tram');
  assert.equal(by['895002'].city, 'town');
  assert.equal(by['895002'].operator, 'MHD Olomouc');
  assert.equal(by['895002'].number, '12');
  assert.equal(by['895002'].headsign, 'Olomouc,Hlavní nádraží');
  assert.deepEqual(by['895002'].stops[0], ['Olomouc,Neředín,krematorium', 49.5953, 17.2272]);
  assert.equal(by['201'].type, 'trolleybus');
  assert.equal(by['201'].operator, 'MHD Opava');
  // Polohy zastávek podle názvu pro celostátní data.
  const coords = spojenkaStopCoords(bytes, region);
  assert.deepEqual(coords.get('Olomouc,Hlavní nádraží'), [49.5925, 17.277]);
});

test('město linky MHD', () => {
  assert.equal(mhdTown('MHD Krnov nemocnice hlavní brána', ['Krnov', 'Guntramovice']), 'Krnov');
  assert.equal(mhdTown('Havířov,Šumbark,točna Lidická-Šenov', ['Šenov', 'Havířov']), 'Havířov');
  assert.equal(mhdTown('Frýdek-Místek-Staré Město-Baška', ['Baška', 'Frýdek-Místek']), 'Frýdek-Místek');
  assert.equal(mhdTown('Ladova - Tržnice', ['Olomouc']), 'Olomouc');
});
