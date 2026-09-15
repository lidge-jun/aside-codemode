// The Aside CLI exits 0 even when the run failed (001 E1), so these cases pin the only
// success signal that actually means anything: the trailing marker plus the payload.
// The child is faked; npm test never launches a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowseSession, parseMarker, parseFinal, stripAnsi } from '../src/host/browse/session.js';

const resolveAside = async () => 'C:/fake/aside.exe';
const job = { urls: ['https://a.test', 'https://b.test'], timeoutMs: 5000 };

function fakeSpawn(stdout, killed = false) {
  return async () => ({ stdout, killed });
}

const finalLine = (o) => JSON.stringify({ type: 'final', items: [], leakedUrls: [], partial: [], ...o });

test('the trailing marker is parsed and a missing one is not invented', () => {
  assert.deepEqual(parseMarker('x\n[ok | 12ms]'), { marker: 'ok', ms: 12 });
  assert.deepEqual(parseMarker('x\n[error | 3ms]\n'), { marker: 'error', ms: 3 });
  assert.deepEqual(parseMarker('no marker here'), { marker: null, ms: null });
});

test('the colourised marker the CLI actually emits is parsed', () => {
  // Captured verbatim from a real run: the CLI dims its own marker, so the raw bytes carry
  // ANSI around it. Anchoring to end-of-string made every successful run read as a failure.
  const real = '\u001b[2m[ok | 395ms]\u001b[0m\n';
  assert.deepEqual(parseMarker(real), { marker: 'ok', ms: 395 });
  assert.equal(stripAnsi(real).trim(), '[ok | 395ms]');
  assert.deepEqual(parseMarker('\u001b[2m[error | 7ms]\u001b[0m'), { marker: 'error', ms: 7 });
});

test('the last marker wins when a transcript contains more than one', () => {
  assert.deepEqual(parseMarker('[ok | 1ms]\nmore\n[error | 2ms]'), { marker: 'error', ms: 2 });
});

test('the final payload is found even behind other stdout noise', () => {
  const out = 'system chatter\n' + finalLine({ items: [{ url: 'u', ok: true }] }) + '\n[ok | 5ms]';
  assert.equal(parseFinal(out).items[0].url, 'u');
  assert.equal(parseFinal('nothing json here'), null);
});

test('exit 0 with an error marker is a FAILURE, not a success', async () => {
  const s = createBrowseSession({ resolveAside, spawnAside: fakeSpawn(finalLine({ items: [{ url: 'a', ok: true }] }) + '\n[error | 9ms]') });
  const res = await s.run(job);
  assert.equal(res.ok, false);
  assert.ok(res.partial.includes('script-error'));
});

test('a run with no marker at all is a failure and names every url as a possible leak', async () => {
  const s = createBrowseSession({ resolveAside, spawnAside: fakeSpawn('silence') });
  const res = await s.run(job);
  assert.equal(res.ok, false);
  assert.deepEqual(res.partial, ['no-marker']);
  assert.deepEqual(res.leakedUrls, job.urls);
});

test('a host kill reports every requested url as leaked, because the tabs are unrecoverable', async () => {
  // 001 E5: a killed CLI leaves tabs that no later session can close. Silence here would
  // turn a permanent leak into a clean-looking result.
  const s = createBrowseSession({ resolveAside, spawnAside: fakeSpawn('partial output', true) });
  const res = await s.run(job);
  assert.equal(res.ok, false);
  assert.deepEqual(res.partial, ['host-kill']);
  assert.deepEqual(res.leakedUrls, job.urls);
  assert.ok(res.items.every((i) => i.code === 'EHOSTKILL'));
});

test('a reported tab leak prevents ok even when the marker says ok', async () => {
  const out = finalLine({ items: [{ url: 'a', ok: true }], leakedUrls: ['https://a.test'] }) + '\n[ok | 5ms]';
  const res = await createBrowseSession({ resolveAside, spawnAside: fakeSpawn(out) }).run(job);
  assert.equal(res.ok, false);
  assert.ok(res.partial.includes('tab-leak'));
});

test('a clean run is ok and keeps the raw transcript for diagnostics only', async () => {
  const out = finalLine({ items: [{ url: 'a', ok: true }, { url: 'b', ok: true }] }) + '\n[ok | 7ms]';
  const res = await createBrowseSession({ resolveAside, spawnAside: fakeSpawn(out) }).run(job);
  assert.equal(res.ok, true);
  assert.deepEqual(res.partial, []);
  assert.equal(res.raw.marker, 'ok');
});

test('an already-aborted signal refuses before any spawn', async () => {
  const c = new AbortController();
  c.abort();
  let spawned = false;
  const s = createBrowseSession({ resolveAside, spawnAside: async () => { spawned = true; return { stdout: '' }; }, signal: c.signal });
  await assert.rejects(s.run(job), (e) => e.code === 'ECANCELLED');
  assert.equal(spawned, false);
});
