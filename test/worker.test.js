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

test('proxy /trains: když mapa vlaků neodpoví, vezme vlaky z map IDZK a IDS JMK, pak poslední úspěšnou odpověď', async () => {
  const store = new Map();
  globalThis.caches = {
    default: {
      put: async (key, res) => store.set(String(key), await res.text()),
      match: async (key) => (store.has(String(key)) ? new Response(store.get(String(key))) : undefined),
    },
  };
  const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-524630, -1187194] }, properties: { tt: 'Os', tn: '891' } };
  const idzk = { transmitters: [
    { t: 'T', dm: 3, n: 'Os 3912', cr: 'ČD', x: 49.34574, y: 17.305443, ico: 'a_180.png', cn: 'Os 3912|S4|3912|Bezměrov|180|||||Kojetín|1|', cat: 1 },
    { cn: '4|4|58|Dlouhá', x: 49.2, y: 17.6, cr: 'DSZO', cat: 3 },
  ] };
  const urls = [];
  let sz = true;
  let mpv = true;
  const jmk = { Vehicles: [
    { ID: 30155, VType: 5, Lat: 49.305824, Lng: 17.085648, Bearing: 45, LineName: 'R12', Delay: 3, FinalStopName: 'Hlavní nádraží', IsInactive: false },
    { ID: 31030, VType: 5, Lat: 49.324982, Lng: 16.46002, Bearing: -1, LineName: 'xS3', Delay: 0, FinalStopName: 'Tišnov, žel.st.', IsInactive: false },
    { ID: 1848, VType: 0, Lat: 49.19, Lng: 16.61, Bearing: 45, LineName: '1', Delay: 4, FinalStopName: 'Řečkovice', IsInactive: false },
  ] };
  let jmkTokenAsked = 0;
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    urls.push(String(url));
    if (String(url).includes('spravazeleznic')) return sz ? Response.json({ result: [feature] }) : new Response('busy', { status: 503 });
    if (String(url) === 'https://mapa.idsjmk.cz/') {
      jmkTokenAsked++;
      return new Response("<script type=\"module\">initializeApplication('dG9rZW4=');</script>");
    }
    if (String(url).startsWith('https://mapa.idsjmk.cz/api/vehicles')) {
      if (!mpv) return new Response('busy', { status: 503 });
      return init?.headers?.['X-Access-Token'] === 'dG9rZW4=' ? Response.json(jmk) : new Response('no', { status: 401 });
    }
    return mpv ? Response.json(idzk) : new Response('busy', { status: 503 });
  });
  const get = () => worker.fetch(new Request('https://dszo-proxy.example.workers.dev/trains'));
  assert.equal((await (await get()).json()).trains[0].tn, '891');

  // SŽ neodpoví: vlaky z mapy IDZK (a SŽ pak chvíli nezkoušíme).
  sz = false;
  const fallback = await (await get()).json();
  assert.equal(fallback.source, 'idzk');
  assert.deepEqual(fallback.trains, [
    { lat: 49.34574, lon: 17.305443, tt: 'Os', tn: '3912', na: '', fn: '', ln: 'Kojetín', cna: 'Bezměrov', d: 'ČD', de: 3, a: 180 },
    { lat: 49.305824, lon: 17.085648, tt: 'R', tn: '', line: 'R12', na: '', fn: '', ln: 'Hlavní nádraží', cna: '', d: '', de: 3, a: 45, src: 'jmk', vid: 30155 },
    { lat: 49.324982, lon: 16.46002, tt: 'Os', tn: '', line: 'S3', na: '', fn: '', ln: 'Tišnov, žel.st.', cna: '', d: '', de: 0, a: '', src: 'jmk', vid: 31030 },
  ]);
  assert.equal(jmkTokenAsked, 1);
  urls.length = 0;
  await get();
  assert.ok(urls.every((u) => !u.includes('spravazeleznic')));

  // Klíč mapy IDS JMK se pamatuje (stránku mapy stáhneme jen jednou).
  assert.equal(jmkTokenAsked, 1);

  // Neodpoví ani IDZK, ani IDS JMK: poslední úspěšná odpověď SŽ, bez ní chyba.
  mpv = false;
  const stale = await get();
  assert.equal(stale.headers.get('X-Stale'), '1');
  assert.equal((await stale.json()).trains[0].tn, '891');
  store.clear();
  assert.equal((await get()).status, 502);
  fetchMock.mock.restore();
  delete globalThis.caches;
});

test('proxy /mhd: vozy MHD měst a regionálních autobusů vybraných dopravců z mapy IDZK', async () => {
  let req = null;
  let km = null;
  let odis = null;
  let pce = null;
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/odis/')) {
      odis = { url: String(url), init };
      return Response.json({
        transmitters: [
          { t: 'H', c: 0, cn: '12|12|132|||Hrabůvka,Poliklinika|157|1119|Hranečník|Dubina|1|Ev. č. 1721|0|0|0|0|0|0|0|0|0|0', x: 49.78, y: 18.26, ico: 'a_180.png', ds: '$z2~min.~37~s', cr: 'DPO', cat: 3 },
          { t: 'T', c: 681, cn: 'Os 3319|S3|3319|Bohumín|360|||||Bohumín|1|', x: 49.9, y: 18.36, ico: 'a_30.png', ds: '', cr: 'České dráhy', cat: 1 },
          { t: 'E', cn: 1066, x: 49.5, y: 18.2, cat: 0 },
        ],
      });
    }
    if (String(url).includes('mhdonline.cz/pardubice')) {
      pce = { url: String(url), init };
      return Response.json({ time: '2026-10-15T15:44:19Z', vehicles: [{ vid: '102', lineId: '28', destinationName: 'Hostovice', nextStopName: 'Černá za Bory,silo', gpsLat: 50.0267, gpsLon: 15.8104, currentDelay: '-PT4S' }] });
    }
    if (String(url).includes('kromeriz')) {
      km = { url: String(url), init };
      return Response.json({ success: true, data: [{ vid: 2702678, line_number: 4, connection_no: 23, time_difference: '-00:05:55', gps_latitude: 49.29, gps_longitude: 17.38, current_stop_name: 'Hygienická stanice', destination_name: 'Nádraží' }] });
    }
    req = { url: String(url), init };
    return Response.json({
      transmitters: [
        { cn: '946001|1|58|Valašské Meziříčí,Tesla I|130|Valašské Meziříčí,sklárny|94|1116|Valašské Meziříčí,stan.MHD u náměstí|Krhová,točna|1|2TD5812', x: 49.47, y: 17.98, ico: 'a_0.png', ds: '$z1~min.~34~s', tm: '18:36:45', cr: 'TQM–MHDVM', cat: 2 },
        { cn: '823150|150|234|Kroměříž,Bílany,rozc.', x: 49.3, y: 17.4, ico: 'a_0.png', ds: '', tm: '', cr: 'Neznámý dopravce', cat: 2 },
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
  // Mapa ODIS: jen autobusy, trolejbusy a tramvaje (ne vlaky a cizí systémy), kód zkrácený na 12 polí.
  assert.equal(odis.url, 'https://mpvnet.cz/odis/map/mapData');
  assert.equal(odis.init.headers.Origin, 'https://mpvnet.cz');
  assert.equal(data.odis.length, 1);
  assert.equal(data.odis[0].cn, '12|12|132|||Hrabůvka,Poliklinika|157|1119|Hranečník|Dubina|1|Ev. č. 1721');
  assert.equal(data.odis[0].cat, 3);
  // MHD Pardubice z mapy dopravního podniku (s hlavičkou x-app-protocol).
  assert.equal(pce.url, 'https://api.mhdonline.cz/pardubice/vehicles');
  assert.equal(pce.init.headers['x-app-protocol'].length, 64);
  assert.equal(data.pce.length, 1);
  assert.equal(data.pce[0].lineId, '28');
  fetchMock.mock.restore();
});

test('proxy /mhd: výpadek mapy Kroměříže neshodí ostatní města', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url) =>
    String(url).includes('kromeriz') || String(url).includes('mhdonline.cz/pardubice') ? new Response('Internal Server Error', { status: 500 }) : Response.json({ transmitters: [] }),
  );
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/mhd'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { vehicles: [], km: [], odis: [], pce: [] });
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

test('proxy /jmk: poslední dávka proudu IDS JMK, zprávy beze změny', async () => {
  const listeners = {};
  const sent = [];
  const ws = {
    accept() {},
    send: (m) => sent.push(m),
    close() {},
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe');
    assert.equal(init.headers.Upgrade, 'websocket');
    // Potvrzení filtru hned, vozy až po chvíli (dřív se dávka uzavřela jen s potvrzením).
    setTimeout(() => listeners.message({ data: '{"filter":{"outFields":"ID"}}' }), 5);
    setTimeout(() => {
      listeners.message({ data: '{"attributes":{"ID":1,"LineName":"4"}}' });
      listeners.message({ data: '{"attributes":{"ID":2,"LineName":"12"}}' });
    }, 1400);
    return { status: 101, webSocket: ws };
  });
  // Bez dávky hned 503 (na proud se nečeká), dávka se sbírá na pozadí.
  const pending = [];
  const first = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/jmk'), {}, { waitUntil: (p) => pending.push(p) });
  assert.equal(first.status, 503);
  await Promise.all(pending);
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/jmk'), {}, { waitUntil() {} });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Date.now() - data.at < 10000);
  assert.deepEqual(data.list.map((m) => m.attributes.ID), [1, 2]);
  assert.match(JSON.parse(sent[0]).filter.outFields, /LastStopID/);
  // Druhý dotaz hned potom: z paměti, bez nového spojení.
  const calls = fetchMock.mock.callCount();
  assert.equal((await (await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/jmk'), {}, { waitUntil() {} })).json()).list.length, 2);
  assert.equal(fetchMock.mock.callCount(), calls);
  fetchMock.mock.restore();
});

test('proxy /idsok: polohy spojů Olomouckého kraje, chyba zdroje jako 502', async () => {
  let calls = 0;
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), 'https://www.cestujok.cz/idspublicservices/api/service/position');
    calls++;
    return calls === 1 ? new Response('down', { status: 503 }) : Response.json([{ id: 1, name: '895002 / 12', lat: 49.59, lon: 17.26 }]);
  });
  assert.equal((await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/idsok'))).status, 502);
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/idsok'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).list[0].name, '895002 / 12');
  fetchMock.mock.restore();
});
