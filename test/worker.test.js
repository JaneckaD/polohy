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

test('proxy /mhd: vozy MHD Kroměříž a Valašské Meziříčí z mapy IDZK', async () => {
  let req = null;
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    req = { url: String(url), init };
    return Response.json({
      transmitters: [
        { cn: '946001|1|58|Valašské Meziříčí,Tesla I|130|Valašské Meziříčí,sklárny|94|1116|Valašské Meziříčí,stan.MHD u náměstí|Krhová,točna|1|2TD5812', x: 49.47, y: 17.98, ico: 'a_0.png', ds: '$z1~min.~34~s', tm: '18:36:45', cr: 'TQM–MHDVM', cat: 2 },
        { cn: '823150|150|234|Kroměříž,Bílany,rozc.', x: 49.3, y: 17.4, ico: 'a_0.png', ds: '', tm: '', cat: 2 },
      ],
    });
  });
  const res = await worker.fetch(new Request('https://dszo-proxy.example.workers.dev/mhd'));
  assert.equal(req.url, 'https://mpvnet.cz/zlin/map/mapData');
  assert.equal(req.init.method, 'POST');
  assert.equal(req.init.headers.Origin, 'https://mpvnet.cz');
  const data = await res.json();
  assert.equal(data.vehicles.length, 1);
  assert.ok(data.vehicles[0].cn.startsWith('946001|1|'));
  assert.equal(data.vehicles[0].cr, undefined);
  fetchMock.mock.restore();
});
