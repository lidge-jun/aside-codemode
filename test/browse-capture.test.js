// Artifact containment. `pwd` is reported by the script, so it is influenced data: these
// pin that the host names the files and refuses anything that resolves out of the session.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { artifactNameFor, containedRead, ArtifactError, createCaptureMany } from '../src/host/browse/capture.js';

// A readable PNG, because verifyCapture reads the real IHDR dimensions. The trailing byte
// makes each file distinguishable, which is how a swapped artifact is actually detected.
function png(mark) {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const ihdr = Buffer.concat([
    Buffer.from('IHDR'),
    Buffer.from([0, 0, 0, 4]), Buffer.from([0, 0, 0, 4]),
    Buffer.from([8, 6, 0, 0, 0]),
  ]);
  return Buffer.concat([head, ihdr, Buffer.from([mark])]);
}

// captureMany with a stubbed session. The point of every case below is the JOIN: which
// file ends up attached to which request.
function harness(envelope, { readFails = false } = {}) {
  const written = new Map();
  const reads = [];
  const capture = createCaptureMany({
    session: { run: async (job, opts) => envelope(opts.artifactNames) },
    assertInside: (p) => p,
    deps: {
      mkdirImpl: async () => {},
      realpathImpl: async (p) => p,
      readFileImpl: async (p) => {
        reads.push(p);
        if (readFails) { const e = new Error('gone'); e.code = 'EARTIFACT'; throw e; }
        return png(p.charCodeAt(p.length - 5) % 251);
      },
      writeFileImpl: async (p, buf) => { written.set(p, buf); },
    },
  });
  return { capture, written, reads };
}

const item = (jobId, url, extra = {}) => ({ jobId, url, ok: true, status: 'completed', ...extra });
const envelopeOf = (items, ledger, over = {}) => ({
  schema: 'browse/2', runId: 'run-x', status: 'completed', ok: true,
  requested: ledger.length, completed: items.filter((i) => i.status === 'completed').length,
  items, ledger, partial: [], leakedUrls: [], pwd: '/fake/session', ...over,
});

test('a result that came back second still takes the file issued for its own request', async () => {
  // Two urls, answered in reverse. The old index join handed B's result A's filename.
  const urls = ['https://a.test', 'https://b.test'];
  const ledger = urls.map((url, i) => ({ jobId: 'j00' + i, url, index: i }));
  const { capture, written } = harness((names) => envelopeOf([
    item('j001', urls[1], { artifactName: names[1] }),
    item('j000', urls[0], { artifactName: names[0] }),
  ], ledger));
  const res = await capture(urls, { outDir: '/out' });
  const byJob = new Map(res.items.map((i) => [i.jobId, i]));
  assert.equal(byJob.get('j000').status, 'completed');
  assert.equal(byJob.get('j001').status, 'completed');
  assert.notEqual(byJob.get('j000').artifact.path, byJob.get('j001').artifact.path);
  assert.equal(written.size, 2);
  for (const it of res.items) {
    assert.ok(it.artifact.path.endsWith(it.artifactName), 'the file on disk must be the one issued for this request');
  }
});

test('two requests for the same url keep separate files', async () => {
  const urls = ['https://a.test', 'https://a.test'];
  const ledger = urls.map((url, i) => ({ jobId: 'j00' + i, url, index: i }));
  const { capture, written } = harness((names) => envelopeOf([
    item('j000', urls[0], { artifactName: names[0] }),
    item('j001', urls[1], { artifactName: names[1] }),
  ], ledger));
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(written.size, 2, 'the same url twice is two captures, not one');
  assert.notEqual(res.items[0].artifactName, res.items[1].artifactName);
});

test('a request nobody answered is not turned into an artifact error', async () => {
  const urls = ['https://a.test', 'https://b.test', 'https://c.test'];
  const ledger = urls.map((url, i) => ({ jobId: 'j00' + i, url, index: i }));
  const { capture, reads } = harness((names) => envelopeOf([
    item('j000', urls[0], { artifactName: names[0] }),
    item('j001', urls[1], { artifactName: names[1] }),
    { jobId: 'j002', url: urls[2], ok: false, status: 'unreturned', code: 'EUNRETURNED' },
  ], ledger, { status: 'partial', ok: false }));
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(reads.length, 2, 'the missing request must not be read from disk');
  assert.equal(res.items[2].code, 'EUNRETURNED');
  assert.equal(res.status, 'partial');
});

test('a result carrying the wrong name is refused rather than repaired', async () => {
  const urls = ['https://a.test', 'https://b.test'];
  const ledger = urls.map((url, i) => ({ jobId: 'j00' + i, url, index: i }));
  const { capture, reads } = harness((names) => envelopeOf([
    item('j000', urls[0], { artifactName: names[1] }),
    item('j001', urls[1], { artifactName: names[1] }),
  ], ledger, { complete: true }));
  const res = await capture(urls, { outDir: '/out' });
  const swapped = res.items.find((i) => i.jobId === 'j000');
  assert.equal(swapped.code, 'EPROVENANCE');
  assert.equal(swapped.status, 'failed');
  assert.equal(reads.length, 1, 'the mismatched item must not have its bytes read');
  assert.equal(res.status, 'partial');
  // The envelope arrived claiming completion. One refused item has to take that away.
  assert.equal(res.complete, false);
  assert.equal(res.completed, 1);
});

test('a completed result with no artifact name at all is a provenance failure', async () => {
  const urls = ['https://a.test'];
  const ledger = [{ jobId: 'j000', url: urls[0], index: 0 }];
  const { capture } = harness(() => envelopeOf([item('j000', urls[0])], ledger));
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(res.items[0].code, 'EPROVENANCE');
  assert.equal(res.ok, false);
});

test('a host kill stays indeterminate, whatever the artifacts say', async () => {
  const urls = ['https://a.test'];
  const ledger = [{ jobId: 'j000', url: urls[0], index: 0 }];
  const { capture, reads } = harness(() => envelopeOf(
    [{ jobId: 'j000', url: urls[0], ok: false, status: 'indeterminate', code: 'EHOSTKILL' }],
    ledger,
    { status: 'indeterminate', ok: false },
  ));
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(res.status, 'indeterminate');
  assert.equal(reads.length, 0);
});

test('a run that brought back no ledger cannot attribute anything, and says so', async () => {
  // Not reachable from the real session, which always issues a ledger. This is the guard
  // that keeps a future caller from reintroducing the index join.
  const urls = ['https://a.test', 'https://b.test'];
  const { capture, reads } = harness((names) => {
    const e = envelopeOf([
      // Reversed on purpose: an implementation that quietly fell back to the index zip
      // would pair these correctly by accident if they arrived in request order.
      item('j001', urls[1], { artifactName: names[1] }),
      item('j000', urls[0], { artifactName: names[0] }),
    ], []);
    delete e.ledger;
    return e;
  });
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(reads.length, 0);
  assert.ok(res.items.every((i) => i.code === 'ECONTRACT'));
  assert.equal(res.status, 'failed');
  assert.ok(res.partial.includes('no-ledger'));
});

test('a ledger that points two requests at one file is refused outright', async () => {
  // Without this check both items read and write the same bytes and the run still says
  // completed, which is the original mis-attribution wearing a ledger.
  const urls = ['https://a.test', 'https://b.test'];
  const broken = [
    { jobId: 'j000', url: urls[0], index: 0 },
    { jobId: 'j001', url: urls[1], index: 0 },
  ];
  const { capture, reads } = harness((names) => envelopeOf([
    item('j000', urls[0], { artifactName: names[0] }),
    item('j001', urls[1], { artifactName: names[0] }),
  ], broken));
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(reads.length, 0);
  assert.ok(res.items.every((i) => i.code === 'ECONTRACT'));
  assert.equal(res.status, 'failed');
});

test('a ledger index outside the issued names is refused', async () => {
  const urls = ['https://a.test'];
  const { capture, reads } = harness((names) => envelopeOf(
    [item('j000', urls[0], { artifactName: names[0] })],
    [{ jobId: 'j000', url: urls[0], index: 9 }],
  ));
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(reads.length, 0);
  assert.equal(res.items[0].code, 'ECONTRACT');
});

test('a ledger naming one request twice is refused', async () => {
  const urls = ['https://a.test', 'https://b.test'];
  const { capture } = harness((names) => envelopeOf([
    item('j000', urls[0], { artifactName: names[0] }),
  ], [
    { jobId: 'j000', url: urls[0], index: 0 },
    { jobId: 'j000', url: urls[1], index: 1 },
  ]));
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(res.items[0].code, 'ECONTRACT');
  assert.equal(res.status, 'failed');
});

test('a result claiming an id the ledger never issued gets no file and no success', async () => {
  const urls = ['https://a.test'];
  const { capture, reads } = harness((names) => envelopeOf([
    { jobId: 'j999', url: 'https://ghost.test', ok: true, status: 'completed', artifactName: names[0] },
  ], [{ jobId: 'j000', url: urls[0], index: 0 }]));
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(reads.length, 0, 'an unissued id has no file of its own to read');
  assert.equal(res.items[0].code, 'EPROVENANCE');
  assert.match(res.items[0].error, /no artifact name was issued/);
  assert.equal(res.ok, false);
});

test('a refused run keeps the rest of the envelope and leaves the caller partial alone', async () => {
  const urls = ['https://a.test'];
  const incoming = ['earlier-note'];
  const { capture } = harness(() => {
    const e = envelopeOf([item('j000', urls[0], { artifactName: 'wrong.png' })], [], {
      partial: incoming, tabs: { requested: 1, closed: 1, peak: 1 },
      timings: { totalMs: 12 }, actionLog: [{ i: 0 }], raw: { marker: 'ok' },
    });
    delete e.ledger;
    return e;
  });
  const res = await capture(urls, { outDir: '/out' });
  assert.equal(res.complete, false);
  assert.equal(res.completed, 0);
  assert.deepEqual(res.tabs, { requested: 1, closed: 1, peak: 1 });
  assert.deepEqual(res.timings, { totalMs: 12 });
  assert.equal(res.actionLog.length, 1);
  assert.deepEqual(res.raw, { marker: 'ok' });
  assert.deepEqual(incoming, ['earlier-note'], 'the envelope we were handed must not be mutated');
});

test('an artifact that cannot be read fails its own item without claiming completion', async () => {
  const urls = ['https://a.test', 'https://b.test'];
  const ledger = urls.map((url, i) => ({ jobId: 'j00' + i, url, index: i }));
  const { capture } = harness((names) => envelopeOf([
    item('j000', urls[0], { artifactName: names[0] }),
    item('j001', urls[1], { artifactName: names[1] }),
  ], ledger), { readFails: true });
  const res = await capture(urls, { outDir: '/out' });
  assert.ok(res.items.every((i) => i.code === 'EARTIFACT'));
  assert.equal(res.status, 'failed');
  assert.equal(res.complete, false);
  assert.equal(res.completed, 0);
});

test('artifact names are host-generated and carry no caller input', () => {
  const a = artifactNameFor(0, {});
  const b = artifactNameFor(0, {});
  assert.match(a, /^shot-000-[0-9a-f-]{36}\.png$/);
  assert.notEqual(a, b, 'names must not collide across calls');
  assert.match(artifactNameFor(2, { type: 'jpeg' }), /^shot-002-.*\.jpg$/);
});

test('a path-like artifact name is refused before any filesystem call', async () => {
  let touched = false;
  const deps = { realpathImpl: async (p) => { touched = true; return p; }, readFileImpl: async () => Buffer.alloc(0) };
  for (const bad of ['../escape.png', 'a/b.png', 'a\\b.png', '..']) {
    await assert.rejects(containedRead('/session', bad, deps), (e) => e instanceof ArtifactError && e.code === 'EBADNAME');
  }
  assert.equal(touched, false, 'a bad name must not reach the filesystem');
});

test('an artifact resolving outside the session directory is refused', async () => {
  const root = path.join('/session', 'artifacts');
  const deps = {
    // Simulate a symlink that escapes: realpath returns somewhere else entirely.
    realpathImpl: async (p) => (p === root ? root : '/elsewhere/evil.png'),
    readFileImpl: async () => Buffer.from('pwned'),
  };
  await assert.rejects(containedRead('/session', 'shot.png', deps), (e) => e.code === 'EESCAPE');
});

test('a missing session directory is an error, not a silent empty read', async () => {
  await assert.rejects(containedRead(null, 'shot.png', {}), (e) => e.code === 'ENOPWD');
});

test('a contained artifact is read from under the session artifacts dir', async () => {
  const root = path.join('/session', 'artifacts');
  const seen = [];
  const deps = {
    realpathImpl: async (p) => p,
    readFileImpl: async (p) => { seen.push(p); return Buffer.from('bytes'); },
  };
  const buf = await containedRead('/session', 'shot.png', deps);
  assert.equal(String(buf), 'bytes');
  assert.equal(seen[0], path.join(root, 'shot.png'));
});
