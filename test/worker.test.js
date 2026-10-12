import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/worker.js';

test('proxy forwards allowed DSZO paths with CORS', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url) =>
    new Response(`body of ${url}`, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }),
  );
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/online/tabs2.php'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(await res.text(), 'body of https://www.dszo.cz/online/tabs2.php');
  fetchMock.mock.restore();
});

test('proxy refuses other paths', async () => {
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/admin'));
  assert.equal(res.status, 404);
});

test('proxy /trains: vlaky Správy železnic jen z okolí Zlínského kraje, jen potřebná pole', async () => {
  const feature = (x, y, tn) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: { tt: 'Os', tn, d: 'České dráhy, a.s.', de: 2, a: 90, zst_sr70: 'x' } });
  let called = null;
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    called = String(url);
    return Response.json({ success: true, result: [feature(-524630, -1187194, '891'), feature(-745140, -1030061, '9643')] });
  });
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/trains'));
  assert.ok(called.startsWith('https://mapy.spravazeleznic.cz/serverside/request2.php?module=Layers%5COsVlaky'));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const data = await res.json();
  assert.equal(data.trains.length, 1);
  assert.equal(data.trains[0].tn, '891');
  assert.equal(data.trains[0].de, 2);
  assert.equal(data.trains[0].zst_sr70, undefined);
  fetchMock.mock.restore();
});

test('proxy /trains: když mapa vlaků neodpoví, zkusí to znovu a pak pošle poslední úspěšnou odpověď', async () => {
  const store = new Map();
  globalThis.caches = {
    default: {
      put: async (key, res) => store.set(String(key), await res.text()),
      match: async (key) => (store.has(String(key)) ? new Response(store.get(String(key))) : undefined),
    },
  };
  const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-524630, -1187194] }, properties: { tt: 'Os', tn: '891' } };
  let calls = 0;
  let ok = true;
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    calls++;
    return ok ? Response.json({ result: [feature] }) : new Response('busy', { status: 503 });
  });
  const first = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/trains'));
  assert.equal((await first.json()).trains.length, 1);
  ok = false;
  calls = 0;
  const stale = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/trains'));
  assert.equal(calls, 2);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('X-Stale'), '1');
  assert.equal((await stale.json()).trains[0].tn, '891');
  store.clear();
  const none = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/trains'));
  assert.equal(none.status, 502);
  fetchMock.mock.restore();
  delete globalThis.caches;
});

test('proxy /mhd: vozy MHD měst a regionálních autobusů vybraných dopravců z mapy IDZK', async () => {
  let req = null;
  let km = null;
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('kromeriz')) {
      km = { url: String(url), init };
      return Response.json({ success: true, data: [{ vid: 2702678, line_number: 4, connection_no: 23, time_difference: '-00:05:55', gps_latitude: 49.29, gps_longitude: 17.38, current_stop_name: 'Hygienická stanice', destination_name: 'Nádraží' }] });
    }
    req = { url: String(url), init };
    return Response.json({
      transmitters: [
        { cn: '946001|1|58|Valašské Meziříčí,Tesla I|130|Valašské Meziříčí,sklárny|94|1116|Valašské Meziříčí,stan.MHD u náměstí|Krhová,točna|1|2TD5812', x: 49.47, y: 17.98, ico: 'a_0.png', ds: '$z1~min.~34~s', tm: '18:36:45', cr: 'TQM–MHDVM', cat: 2 },
        { cn: '823150|150|234|Kroměříž,Bílany,rozc.', x: 49.3, y: 17.4, ico: 'a_0.png', ds: '', tm: '', cr: 'ZDS-Psota', cat: 2 },
        { cn: '805302|302|12|Uherské Hradiště,Mařatice', x: 49.07, y: 17.46, ico: 'a_0.png', ds: '', tm: '', cr: 'ZDS-Psota', cat: 2 },
        { cn: '802371|371|202|Tupesy|-19|Velehrad,náměstí|0|1317|Buchlovice,náměstí|Uherské Hradiště,aut.nádr.|1|7Z50806|0|0|0|0', x: 49.1, y: 17.39, ico: 'a_60.png', ds: '$p-0~min.~19~s', tm: '21:55:02', cr: 'ČSAD BUS UH', cat: 2 },
        { cn: '773165|165|267|Napajedla,Chmelnice', x: 49.17, y: 17.51, ico: 'a_210.png', ds: '', tm: '', cr: 'ARRIVA, pr. Zlín', cat: 2 },
        { cn: '4|4|58|Dlouhá', x: 49.2, y: 17.6, ico: 'a_0.png', ds: '', tm: '', cr: 'DSZO', cat: 3 },
        { cn: '1|2|3', x: 49.2, y: 17.6, ico: 'a_0.png', ds: '', tm: '', cr: 'ARRIVA vlaky s.r.o.', cat: 1 },
      ],
    });
  });
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/mhd'));
  assert.equal(req.url, 'https://mpvnet.cz/zlin/map/mapData');
  assert.equal(req.init.method, 'POST');
  assert.equal(req.init.headers.Origin, 'https://mpvnet.cz');
  const data = await res.json();
  assert.deepEqual(data.vehicles.map((v) => v.cn.split('|')[0]), ['946001', '805302', '802371', '773165']);
  assert.equal(data.vehicles[2].cn, '802371|371|202|Tupesy|-19|Velehrad,náměstí|0|1317|Buchlovice,náměstí|Uherské Hradiště,aut.nádr.|1|7Z50806');
  assert.equal(data.vehicles[2].cr, 'ČSAD BUS UH');
  // MHD Kroměříž z vlastní mapy: klíč v těle, tělo jako prostý text.
  assert.equal(km.url, 'https://kromeriz.mhdonline.cz/api/buses');
  assert.equal(km.init.method, 'POST');
  assert.match(km.init.headers['Content-Type'], /^text\/plain/);
  assert.equal(JSON.parse(km.init.body).key.length, 36);
  assert.equal(data.km.length, 1);
  assert.equal(data.km[0].line_number, 4);
  fetchMock.mock.restore();
});

test('proxy /mhd: výpadek mapy Kroměříže neshodí ostatní města', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url) =>
    String(url).includes('kromeriz') ? new Response('Internal Server Error', { status: 500 }) : Response.json({ transmitters: [] }),
  );
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/mhd'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { vehicles: [], km: [] });
  fetchMock.mock.restore();
});

test('proxy /flix: jen jedoucí spoje FlixBusu, které jsou v kraji', async () => {
  const ride = (id, lat, lon, progress = 'IN_PROGRESS') => ({
    id,
    status: { progress, next_stop_sequence: 2, has_arrived_at_next_stop: false, deviation: { deviation_seconds: 300 } },
    line: { code: '856', direction: 'Zlín', name: 'Brno - Zlín', trip_number: 3, brand: null },
    location: { coordinates: { latitude: lat, longitude: lon }, updated_at: '2026-10-12T08:00:00Z' },
    calls: [
      { sequence: 1, stop: { name: 'Brno', location: { latitude: 49.19, longitude: 16.61 } }, arrival: null, departure: { scheduled: '2026-10-12T06:50:00Z' } },
      { sequence: 2, stop: { name: 'Kroměříž', location: { latitude: 49.29, longitude: 17.39 } }, arrival: { scheduled: '2026-10-12T07:40:00Z' }, departure: { scheduled: '2026-10-12T07:40:00Z' } },
    ],
  });
  const a = '11111111-1111-1111-1111-111111111111';
  const b = '22222222-2222-2222-2222-222222222222';
  const c = '33333333-3333-3333-3333-333333333333';
  const urls = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/v2/timetable/')) return Response.json({ rides: [{ id: a }, { id: b }, { id: c }, { id: 'nesmysl' }] });
    if (u.includes(a)) return Response.json(ride(a, 49.3, 17.2));
    if (u.includes(b)) return Response.json(ride(b, 50.08, 14.43)); // Praha
    return Response.json(ride(c, 49.2, 17.6, 'BEFORE_DEPARTURE'));
  });
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/flix'));
  const data = await res.json();
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual(data.buses.map((x) => x.id), [a]);
  assert.equal(data.buses[0].code, '856');
  assert.equal(data.buses[0].dev, 300);
  assert.deepEqual(data.buses[0].calls[1], { seq: 2, name: 'Kroměříž', lat: 49.29, lon: 17.39, arr: '2026-10-12T07:40:00Z', dep: '2026-10-12T07:40:00Z' });
  assert.equal(urls.filter((u) => u.includes('/v2/timetable/')).length, 12);
  assert.ok(!urls.some((u) => u.includes('nesmysl')));
  fetchMock.mock.restore();
});

test('proxy /flix/route: trasa spoje jen pro platné id', async () => {
  const bad = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/flix/route?id=../../x'));
  assert.equal(bad.status, 400);
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ segments: [{ segment_sequence: 1, polyline: '_p~iF~ps|U_ulLnnqC' }] }));
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/flix/route?id=11111111-1111-1111-1111-111111111111'));
  assert.deepEqual(await res.json(), { segments: [{ seq: 1, line: '_p~iF~ps|U_ulLnnqC' }] });
  fetchMock.mock.restore();
});
