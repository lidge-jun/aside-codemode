// Printing a page the caller names. browse.exec produced the bytes and counted them and
// dropped them, because the branch that writes runs only when the host issued a name and
// report.build was the only caller that issued one. These run captureMany's join with a pdf
// through the same containment a screenshot gets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureMany, ArtifactError } from '../src/host/browse/capture.js';
import { A4_INCHES, validateJob } from '../src/host/browse/schema.js';
import { detect, isLocalOrigin } from '../src/host/browse/policy.js';

const PT = 72;
// A minimal pdf whose MediaBox verifyPageBox can actually read, in the size asked for.
function pdf(inchesW, inchesH) {
  const w = (inchesW * PT).toFixed(5);
  const h = (inchesH * PT).toFixed(5);
  return Buffer.from('%PDF-1.4\n1 0 obj<</MediaBox [ 0 0 ' + w + ' ' + h + ' ]>>endobj\n%%EOF', 'latin1');
}
const a4 = () => pdf(A4_INCHES.paperWidth, A4_INCHES.paperHeight);
const letter = () => pdf(8.5, 11);

function harness(bodyFor, { ledgerOf } = {}) {
  const written = new Map();
  let seenJob = null;
  let seenOpts = null;
  const capture = createCaptureMany({
    session: {
      run: async (job, opts) => {
        seenJob = job; seenOpts = opts;
        const names = opts.pdfNames || [];
        const items = job.urls.map((url, i) => ({
          jobId: 'j00' + i, url, ok: true, status: 'completed', pdfName: names[i],
        }));
        return {
          schema: 'browse/2', runId: 'run-x', status: 'completed', ok: true, complete: true,
          requested: items.length, completed: items.length, unreturned: 0, partial: [], effects: [],
          items, ledger: (ledgerOf ? ledgerOf(items) : items.map((it, i) => ({ jobId: it.jobId, index: i }))),
          pwd: '/fake/session',
        };
      },
    },
    assertInside: (p) => p,
    deps: {
      mkdirImpl: async () => {},
      realpathImpl: async (p) => p,
      readFileImpl: async (p) => bodyFor(p),
      writeFileImpl: async (p, buf) => { written.set(p, buf); },
    },
  });
  return { capture, written, job: () => seenJob, opts: () => seenOpts };
}

test('a url the caller names reaches disk as a verified page', async () => {
  const h = harness(() => a4());
  const res = await h.capture(['https://a.test/doc'], { pdf: {}, outDir: '/out' });
  assert.equal(res.status, 'completed');
  const item = res.items[0];
  assert.ok(item.pdf, 'the item carries no pdf record');
  assert.equal(item.pdf.pageBox.matched, true);
  assert.ok(item.pdf.bytes > 0);
  assert.equal(h.written.size, 1, 'exactly one file for one request');
  assert.ok([...h.written.keys()][0].endsWith('.pdf'));
});

test('asking only for a pdf does not also pay for a screenshot', async () => {
  const h = harness(() => a4());
  await h.capture(['https://a.test/doc'], { pdf: {}, outDir: '/out' });
  assert.equal(h.job().screenshot, undefined, 'a screenshot was taken nobody asked for');
  assert.ok(Array.isArray(h.opts().pdfNames));
  assert.equal(h.opts().artifactNames, undefined);
});

// A file that exists is not a page of the size that was asked for. The format shortcut was
// measured producing US Letter while reporting A4, which is the whole reason for this check.
test('a page that came back the wrong size is a failure, not a file', async () => {
  const h = harness(() => letter());
  const res = await h.capture(['https://a.test/doc'], { pdf: {}, outDir: '/out' });
  assert.equal(res.items[0].code, 'EPAGEBOX');
  assert.equal(res.items[0].status, 'failed');
  assert.equal(res.status, 'failed');
  assert.match(res.items[0].error, /page box/);
});

test('the format shortcut is refused rather than silently producing another size', async () => {
  const h = harness(() => a4());
  await assert.rejects(() => h.capture(['https://a.test/doc'], { pdf: { format: 'A4' }, outDir: '/out' }),
    (e) => e instanceof ArtifactError && e.code === 'ENOTSUP');
});

test('a call with nothing to bring back is refused', async () => {
  const h = harness(() => a4());
  await assert.rejects(() => h.capture(['https://a.test/doc'], { screenshot: false, outDir: '/out' }),
    (e) => e instanceof ArtifactError && e.code === 'EBADVAL');
});

// The ledger is the only thing that says which file belongs to which request.
test('a pdf echoed under a name nobody issued is reported, not attributed', async () => {
  const h = harness(() => a4(), { ledgerOf: (items) => items.map((it, i) => ({ jobId: it.jobId, index: i })) });
  const capture = createCaptureMany({
    session: { run: async (job) => ({
      schema: 'browse/2', runId: 'run-x', status: 'completed', ok: true, complete: true,
      requested: 1, completed: 1, unreturned: 0, partial: [], effects: [], pwd: '/fake/session',
      items: [{ jobId: 'j000', url: job.urls[0], ok: true, status: 'completed', pdfName: 'page-999-somebody-elses.pdf' }],
      ledger: [{ jobId: 'j000', index: 0 }],
    }) },
    assertInside: (p) => p,
    deps: { mkdirImpl: async () => {}, realpathImpl: async (p) => p, readFileImpl: async () => a4(), writeFileImpl: async () => {} },
  });
  const res = await capture(['https://a.test/doc'], { pdf: {}, outDir: '/out' });
  assert.equal(res.items[0].code, 'EPROVENANCE');
});

test('a page this machine served to itself is not an origin refusing us', () => {
  assert.equal(isLocalOrigin('http://localhost:10100/report'), true);
  assert.equal(isLocalOrigin('http://127.0.0.1:8080/'), true);
  assert.equal(isLocalOrigin('http://[::1]:3000/'), true);
  assert.equal(isLocalOrigin('https://example.test/'), false);
  // Detection is off by default only when every url is local; one remote url turns it on.
  assert.equal(validateJob({ urls: ['http://localhost/a'], timeoutMs: 5000 }).detect, false);
  assert.equal(validateJob({ urls: ['https://example.test/'], timeoutMs: 5000 }).detect, true);
  assert.equal(validateJob({ urls: ['http://localhost/a', 'https://example.test/'], timeoutMs: 5000 }).detect, true);
  // Naming it still wins, in both directions.
  assert.equal(validateJob({ urls: ['http://localhost/a'], timeoutMs: 5000, detect: true }).detect, true);
  assert.equal(validateJob({ urls: ['https://example.test/'], timeoutMs: 5000, detect: false }).detect, false);
});

// The detector used to flag this tool's own report, because the report listed a blocked item
// and the word was an alternative on its own.
test('a document that talks about being blocked is not a blocked document', () => {
  const page = (tree) => detect({ requestedUrl: 'https://a.test/', finalUrl: 'https://a.test/', title: 'Report', tree });
  assert.equal(page('one item came back EBLOCKED and the rest were blocked by policy notes'), null);
  assert.equal(page('this page explains why forbidden means what it means'), null);
  // And still catches an origin actually refusing you.
  assert.equal(page('403 Forbidden').kind, 'blocked');
  assert.equal(page('Access Denied').kind, 'blocked');
  assert.equal(page('Your IP has been blocked').kind, 'blocked');
  assert.equal(page('Too Many Requests').kind, 'blocked');
});

// Both artifacts are independent requests. A screenshot that failed verification used to
// withhold a pdf that was sitting in the session directory and verified perfectly, because
// the pdf branch asked whether the item was still completed after the screenshot had
// already lowered it.
test('a failed screenshot does not withhold a pdf that verified', async () => {
  const written = new Map();
  const capture = createCaptureMany({
    session: { run: async (job, opts) => ({
      schema: 'browse/2', runId: 'run-x', status: 'completed', ok: true, complete: true,
      requested: 1, completed: 1, unreturned: 0, partial: [], effects: [], pwd: '/fake/session',
      items: [{ jobId: 'j000', url: job.urls[0], ok: true, status: 'completed',
        artifactName: opts.artifactNames[0], pdfName: opts.pdfNames[0] }],
      ledger: [{ jobId: 'j000', index: 0 }],
    }) },
    assertInside: (p) => p,
    deps: {
      mkdirImpl: async () => {}, realpathImpl: async (p) => p,
      // The screenshot comes back as bytes verifyCapture cannot read; the pdf is fine.
      readFileImpl: async (p) => (p.endsWith('.pdf') ? a4() : Buffer.from('not a png')),
      writeFileImpl: async (p, buf) => { written.set(p, buf); },
    },
  });
  const res = await capture(['https://a.test/doc'], { screenshot: {}, pdf: {}, outDir: '/out' });
  const item = res.items[0];
  assert.equal(item.code, 'ECAPTURE', 'the screenshot failure is still reported');
  assert.ok(item.pdf, 'the pdf was withheld because a different artifact failed');
  assert.equal(item.pdf.pageBox.matched, true);
  assert.ok([...written.keys()].some((p) => p.endsWith('.pdf')), 'the pdf never reached disk');
});
