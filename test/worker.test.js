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

test('proxy /mhd: vozy MHD měst a regionálních autobusů vybraných dopravců z mapy IDZK', async () => {
  let req = null;
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
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
  fetchMock.mock.restore();
});
