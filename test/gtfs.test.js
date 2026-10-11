import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parseCsvLine, buildFromGtfs } from '../scripts/gtfs-lib.mjs';

test('parseCsvLine zvládá uvozovky a čárky', () => {
  assert.deepEqual(parseCsvLine('a,"b,c",,"d ""e"""'), ['a', 'b,c', '', 'd "e"']);
  assert.deepEqual(parseCsvLine('1,2'), ['1', '2']);
});

test('buildFromGtfs vybere linky DSZO v Zlíně a sestaví směry', () => {
  const files = {
    'agency.txt': 'agency_id,agency_name\nD,"Dopravní společnost Zlín - Otrokovice, s.r.o."\nX,Jiný dopravce\n',
    'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_type\nr2,D,2,,11\nr53,D,53,,3\nr9,X,9,,3\n',
    'trips.txt': 'route_id,service_id,trip_id,direction_id,shape_id\nr2,s,t1,0,sh1\nr2,s,t2,1,\nr53,s,t3,0,\nr9,s,t4,0,\n',
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns,1,1,1,1,1,0,0,20260101,20261231\n',
    'calendar_dates.txt': 'service_id,date,exception_type\ns,20261012,2\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\na,"Zlín,Náměstí Míru",49.2265,17.667\nb,"Zlín,Zborovská",49.224,17.66\nc,"Otrokovice,žel.st.",49.21,17.53\n',
    'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,08:00:00,08:00:00,a,1\nt1,08:05:00,08:05:00,b,2\nt1,08:20:00,08:20:00,c,3\nt2,24:10:00,24:10:00,c,1\nt2,24:25:00,24:25:00,a,2\nt3,09:00:00,09:00:00,a,1\nt3,09:04:00,09:04:00,b,2\nt4,10:00:00,10:00:00,a,1\nt4,10:04:00,10:04:00,b,2\n',
    'shapes.txt': 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nsh1,49.21,17.53,2\nsh1,49.2265,17.667,1\n',
  };
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
  const tt = buildFromGtfs(zip, { startDate: '2026-10-11', days: 3 });
  assert.deepEqual(tt.lines.map((l) => l.ref), ['2', '53']);
  const l2 = tt.lines[0];
  assert.equal(l2.type, 'trolleybus');
  assert.equal(tt.lines[1].type, 'bus');
  const a = l2.directions.find((d) => d.id === 'A');
  assert.deepEqual(a.stops.map((i) => tt.stopNames[i]), ['Náměstí Míru', 'Zborovská', 'Otrokovice,žel.st.']);
  // 11. 10. je neděle, 12. 10. výjimka, 13. 10. úterý
  assert.equal(a.masks[a.trips[0].d], '001');
  assert.deepEqual(a.trips[0].t, [480, 485, 500]);
  assert.deepEqual(a.variants[0].shape, [[17.667, 49.2265], [17.53, 49.21]]);
  assert.deepEqual(a.variants[0].coords[0], [49.2265, 17.667]);
  const b = l2.directions.find((d) => d.id === 'B');
  assert.deepEqual(b.trips[0].t, [1450, 1465]);
});
