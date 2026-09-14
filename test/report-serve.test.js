// Report assembly and the jailed asset server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportServer } from '../src/host/report/serve.js';
import { buildHtml } from '../src/host/report/html.js';
import http from 'node:http';

async function get(origin, p) {
  const res = await fetch(origin + p);
  return { status: res.status, body: await res.text() };
}

// fetch() normalises a path like /x/.. to / before it ever leaves the client, which would
// make a traversal test pass for the wrong reason. This sends the literal bytes instead.
function rawGet(origin, literalPath) {
  const { port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: Number(port), path: literalPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (d) => { body += String(d); });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the server serves only what the host registered and 404s everything else', async () => {
  // A request path is a MAP LOOKUP, never a join onto a directory, so a caller-controlled
  // figure src cannot walk to an arbitrary file.
  const s = createReportServer();
  s.setDocument('<html>doc</html>');
  const name = s.register(Buffer.from('PNGBYTES'), 'image/png');
  const live = await s.listen();
  try {
    assert.equal((await get(live.origin, '/')).body, '<html>doc</html>');
    assert.equal((await get(live.origin, '/' + name)).body, 'PNGBYTES');
    // Literal paths, unnormalised: the route table is an exact map, so every one of these
    // misses and 404s. There is no join onto a directory for a traversal to exploit.
    for (const bad of ['/etc/passwd', '/../../secret', '/nope', '/' + name + '/..', '/' + name + '%2f..', '//' + name]) {
      assert.equal((await rawGet(live.origin, bad)).status, 404, bad + ' must not be served');
    }
  } finally {
    await live.close();
  }
});

test('close resolves even while a keep-alive connection is open', async () => {
  // server.close() waits for existing sockets. The browser holds one after loading, so
  // without destroying them the close never resolves and report.build hangs.
  const s = createReportServer();
  s.setDocument('<html>x</html>');
  const live = await s.listen();
  await get(live.origin, '/');
  await live.close();
  assert.ok(true, 'close resolved');
});

test('registered names are unguessable and distinct', () => {
  const s = createReportServer();
  const a = s.register(Buffer.from('1'), 'image/png');
  const b = s.register(Buffer.from('2'), 'image/png');
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/);
});

test('report html escapes item content instead of injecting it', () => {
  const html = buildHtml({ title: '<script>x</script>', items: [{ url: 'https://x.test/"onerror=', ok: true }] });
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a failed item is shown as failed rather than silently omitted', () => {
  const html = buildHtml({ items: [{ url: 'https://x.test', ok: false, code: 'EBLOCKED', error: 'login wall' }] });
  assert.match(html, /EBLOCKED/);
  assert.match(html, /login wall/);
});
