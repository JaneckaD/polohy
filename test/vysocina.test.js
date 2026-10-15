import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { parseVdvTimetable, vdvConnection } from '../proxy/worker.js';
import { buildPlannerFromTrips } from '../scripts/planner-data.mjs';
import { preparePlanner } from '../src/planner.js';
import { parseVdv } from '../src/idsok.js';
import { krajOf } from '../src/region.js';

const region = JSON.parse(readFileSync(new URL('../public/region.json', import.meta.url)));
const mask = '111';
const stops = [['Jimramov,,Obecní úřad', 49.6369, 16.2256], ['Dalečín', 49.5939, 16.2384], ['Bystřice n.Pern.,,aut.nádr.', 49.5228, 16.2589]];
const P = preparePlanner(
  buildPlannerFromTrips({ startDate: '2026-10-15', days: 3, rawTrips: [{ ref: '841129', type: 'bus', city: 'other', operator: 'ZDAR', number: '24', mask, times: [1134, 1155, 1174], stops }] }),
);

const html = `<span id="currentLineRouteLabel">
    841129 / 24
  </span><span id="nextLineRouteLabel" class="is-hidden">-- / --</span>
  <div class="field" id="timetableCurrentContainer"><table><tbody>
    <tr>
      <td>Jimramov,Obecn&#xED; &#xFA;&#x159;ad</td>
      <td class="has-text-centered">18:54</td>
      <td class="has-text-centered">18:54</td>
    </tr>
    <tr><td>Dale&#x10D;&#xED;n</td><td class="has-text-centered">19:15</td><td class="has-text-centered">19:15</td></tr>
    <tr><td>Byst&#x159;ice n.Pern.,aut.n&#xE1;dr.</td><td class="has-text-centered">19:34</td><td class="has-text-centered"></td></tr>
  </tbody></table></div>
  <div class="field" id="timetableNextContainer"><table><tbody><tr><td>Jinde</td><td>20:00</td><td>20:00</td></tr></tbody></table></div>`;

test('Kraj Vysočina je v oblasti', () => {
  assert.equal(krajOf(region, 15.59, 49.4), 'vys');
  assert.equal(krajOf(region, 16.25, 49.53), 'vys');
  assert.equal(krajOf(region, 15.88, 49.21), 'vys');
});

test('jízdní řád vozu z mapy VDV: licence, spoj a konce spoje', () => {
  assert.deepEqual(parseVdvTimetable(html), { lic: '841129', trip: '24', dep: 'Jimramov,Obecní úřad', depTime: '18:54', dest: 'Bystřice n.Pern.,aut.nádr.', destTime: '19:34' });
  assert.equal(parseVdvTimetable('<span id="currentLineRouteLabel">-- / --</span>'), null);
});

test('spoj z mapy VDV: regionální autobus na Vysočině dohledaný v jízdním řádu', () => {
  const p = { id: 172924, lat: 49.5885, lng: 16.24, text: '841129', delay: 5, finalStopName: 'Bystřice n.Pern.,aut.nádr.', traction: 'BUS' };
  const s = vdvConnection(p, parseVdvTimetable(html));
  const v = parseVdv(s, { P, region, date: '2026-10-15', min: 1160 });
  assert.equal(v.live, 'vdv');
  assert.equal(v.tripNo, '24');
  assert.equal(v.line, '129');
  assert.equal(v.delay, 300);
  assert.ok(v.tripId != null);
  // Bez jízdního řádu: neznámé zpoždění, cíl z mapy, žádné „N/a“.
  const bare = vdvConnection({ ...p, delay: -2147483648, finalStopName: '33826 N/a' }, null);
  assert.equal(bare.delay, null);
  assert.equal(bare.dest, null);
  // Vlaky jdou přes /trains, vozy mimo Vysočinu ukazují jejich vlastní mapy.
  assert.equal(parseVdv(vdvConnection({ id: -570, lat: 49.43, lng: 15.59, text: '663', delay: 2, traction: 'TRAIN' }), { region }), null);
  assert.equal(parseVdv(vdvConnection({ ...p, lat: 49.19, lng: 16.6 }), { region }), null);
});

test('proxy /vdv: vozy se spoji, jízdní řád jen jednou na vůz', async () => {
  const urls = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.endsWith('/Ajax/GetPoints'))
      return Response.json([
        { id: 172924, lat: 49.5885, lng: 16.24, text: '841129', delay: 5, finalStopName: 'Bystřice n.Pern.,aut.nádr.', traction: 'BUS' },
        { id: -212, lat: 49.33, lng: 16.55, text: '301', delay: 1, finalStopName: '-1 N/a', traction: 'UNKNOWN' },
        { id: -589, lat: 49.43, lng: 15.59, text: '1920', delay: 1, finalStopName: '5474882 N/a', traction: 'TRAIN' },
      ]);
    if (u.includes('/Ajax/GetTimetable')) return new Response(html);
    return new Response('?', { status: 404 });
  });
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/vdv'));
  const data = await res.json();
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual(data.list.map((s) => s.id), [172924, -589]);
  assert.equal(data.list[0].serviceNumber, '24');
  assert.equal(data.list[0].dep, 'Jimramov,Obecní úřad');
  assert.equal(data.list[1].sourceType, 'K');
  assert.equal(data.list[1].trainNumber, '1920');
  assert.equal(urls.filter((u) => u.includes('GetTimetable')).length, 1);
  fetchMock.mock.restore();
});
