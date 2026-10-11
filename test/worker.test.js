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
