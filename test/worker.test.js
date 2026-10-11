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
