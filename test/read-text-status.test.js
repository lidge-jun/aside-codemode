import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCache } from '../src/host/browse/cache.js';
import { createReadText } from '../src/host/browse/read-text.js';

async function localServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function memoryCache() {
  const values = new Map();
  return {
    values,
    get: async ({ subject }) => values.has(subject)
      ? { hit: true, value: values.get(subject) }
      : { hit: false },
    put: async ({ subject }, value) => { values.set(subject, value); },
  };
}

test('BUG-R31 refuses HTTP errors without caching them and keeps HTML readable', async (t) => {
  const requests = new Map();
  const base = await localServer(t, (req, res) => {
    requests.set(req.url, (requests.get(req.url) || 0) + 1);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/missing') {
      res.statusCode = 404;
      res.end('<html><body><h1>404: Not Found</h1></body></html>');
      return;
    }
    if (req.url === '/forbidden') {
      res.statusCode = 403;
      res.end('<html><body><h1>Forbidden</h1></body></html>');
      return;
    }
    res.statusCode = 200;
    res.end('<html><body><h1>Available</h1><p>page body</p></body></html>');
  });
  const cache = memoryCache();
  const readText = createReadText({ cache });

  const missing = await readText(`${base}/missing`);
  const missingAgain = await readText(`${base}/missing`);
  const forbidden = await readText(`${base}/forbidden`);
  const available = await readText(`${base}/available`);

  assert.equal(missing.ok, false);
  assert.equal(missing.format, 'markdown');
  assert.equal(missing.blockKind, 'blocked');
  assert.equal(missingAgain.cached, undefined);
  assert.equal(requests.get('/missing'), 2, 'a 404 response must be fetched again, not replayed from cache');
  assert.equal(cache.values.has(`${base}/missing`), false);
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.format, 'markdown');
  assert.equal(forbidden.blockKind, 'auth');
  assert.equal(available.ok, true);
  assert.equal(available.format, 'markdown');
  assert.match(available.text, /^# Available/);
});

test('BUG-R29 returns non-HTML bodies byte-for-byte with truthful formats', async (t) => {
  const json = '{"message":"line one\\nline two","markup":"<b>literal</b>"}';
  const plain = 'line one\n<b>literal text, not HTML</b>';
  const base = await localServer(t, (req, res) => {
    res.statusCode = 200;
    if (req.url === '/plain') {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(plain);
      return;
    }
    res.setHeader('content-type', 'application/problem+json; charset=utf-8');
    res.end(json);
  });
  const readText = createReadText();

  const out = await readText(`${base}/data`);
  const plainOut = await readText(`${base}/plain`);

  assert.equal(out.ok, true);
  assert.equal(out.format, 'json');
  assert.equal(out.text, json);
  assert.deepEqual(JSON.parse(out.text), {
    message: 'line one\nline two',
    markup: '<b>literal</b>',
  });
  assert.equal(plainOut.ok, true);
  assert.equal(plainOut.format, 'text');
  assert.equal(plainOut.text, plain);
});

test('BUG-R32 refuses a 0.7.0 readText entry that predates status and format validation', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'codemode-read-text-cache-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cache = createCache({ dir });
  const url = 'https://a.test/legacy';
  const legacyBody = '{"error":"not found","markup":"<b>missing</b>"}';

  // 0.7.0 called HTTP errors successful and stored every body under markdown. This fixture
  // uses the real cache writer so the filesystem key and envelope are production-shaped.
  await cache.put(
    { namespace: 'readText', subject: url, accountRoot: '', locale: null },
    { ok: true, source: 'fetch', status: 404, markdown: legacyBody, chars: legacyBody.length },
  );

  let fetches = 0;
  const freshBody = '{"available":true,"markup":"<b>literal</b>"}';
  const readText = createReadText({
    cache,
    fetchImpl: async () => {
      fetches += 1;
      return {
        status: 200,
        url,
        headers: { get: () => 'application/json; charset=utf-8' },
        text: async () => freshBody,
      };
    },
  });

  const out = await readText(url);

  assert.equal(fetches, 1, 'the legacy success must not suppress a current fetch');
  assert.equal(out.cached, undefined);
  assert.equal(out.status, 200);
  assert.equal(out.format, 'json');
  assert.equal(out.text, freshBody);
});
