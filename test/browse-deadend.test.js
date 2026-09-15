// The green lie, in three parts. A DNS failure and a refused connection both land on
// Chrome's own error page, which loads and has a title, so the batch called them completed.
// A run that only needed someone to sign in was lowered back to failed on the way out
// through the artifact join. And requireContent could be switched on with nothing to check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowseSession, deadEndReason, itemStatus } from '../src/host/browse/session.js';
import { createCaptureMany } from '../src/host/browse/capture.js';
import { validateJob, BrowseOptionError } from '../src/host/browse/schema.js';

const resolveAside = async () => 'C:/fake/aside.exe';
const fakeSpawn = (stdout) => async () => ({ stdout, killed: false });
const finalLine = (o) => JSON.stringify({ type: 'final', items: [], leakedUrls: [], partial: [], ...o });
const ok = (s) => s + '\n[ok | 5ms]';
const job3 = { urls: ['https://a.test', 'https://b.test', 'https://c.test'], timeoutMs: 5000 };
const run = (stdout, job = job3) => createBrowseSession({ resolveAside, spawnAside: fakeSpawn(stdout) }).run(job);
const ERROR_PAGE = 'chrome-error://chromewebdata/';

test('the browser error page is recognised by its scheme and nothing else', () => {
  assert.ok(deadEndReason({ finalUrl: ERROR_PAGE }));
  assert.ok(deadEndReason({ finalUrl: 'CHROME-ERROR://chromewebdata/' }), 'the scheme is not case sensitive');
  assert.equal(deadEndReason({ finalUrl: 'https://example.test/chrome-error' }), null);
  assert.equal(deadEndReason({ finalUrl: 'https://example.test/404' }), null, 'a rendered 404 is the content check\'s job');
  assert.equal(deadEndReason({}), null);
  assert.equal(deadEndReason(null), null);
});

test('an item that arrived nowhere is a failure even while it claims ok', () => {
  assert.equal(itemStatus({ ok: true, finalUrl: ERROR_PAGE }), 'failed');
  assert.equal(itemStatus({ ok: true, finalUrl: 'https://example.test/' }), 'completed');
});

test('a dead end is stamped with its own code and reported on the run', async () => {
  const out = ok(finalLine({ items: [
    { jobId: 'j000', url: 'https://a.test', ok: true, finalUrl: 'https://a.test/' },
    { jobId: 'j001', url: 'https://b.test', ok: true, finalUrl: 'https://b.test/' },
    { jobId: 'j002', url: 'https://nope.invalid', ok: true, finalUrl: ERROR_PAGE },
  ] }));
  const res = await run(out);
  assert.equal(res.items[2].status, 'failed');
  assert.equal(res.items[2].code, 'EDEADEND');
  assert.match(res.items[2].error, /error page/);
  assert.equal(res.status, 'partial');
  assert.equal(res.complete, false);
  assert.ok(res.partial.includes('dead-end'));
});

// The acceptance shape the spec asks for: one page that worked, one that never loaded, one
// that loaded and did not have what was wanted. The run must name both failures.
test('a batch mixing a good page, a dead end and an unrendered page is partial and says why', async () => {
  const out = ok(finalLine({ items: [
    { jobId: 'j000', url: 'https://a.test', ok: true, finalUrl: 'https://a.test/', contentVerified: true },
    { jobId: 'j001', url: 'https://nope.invalid', ok: true, finalUrl: ERROR_PAGE },
    { jobId: 'j002', url: 'https://c.test', ok: false, code: 'EUNRENDERED', finalUrl: 'https://c.test/404' },
  ] }));
  const res = await run(out);
  assert.equal(res.status, 'partial');
  assert.equal(res.completed, 1);
  assert.equal(res.items.filter((i) => i.status === 'failed').length, 2);
  assert.ok(res.partial.includes('dead-end'));
  assert.ok(res.partial.includes('content-unverified'));
});

test('an item that already said why it failed keeps its own reason', async () => {
  const out = ok(finalLine({ items: [
    { jobId: 'j000', url: 'https://a.test', ok: false, code: 'EBLOCKED', blockKind: 'login-wall', finalUrl: ERROR_PAGE },
    { jobId: 'j001', url: 'https://b.test', ok: true, finalUrl: 'https://b.test/' },
    { jobId: 'j002', url: 'https://c.test', ok: true, finalUrl: 'https://c.test/' },
  ] }));
  const res = await run(out);
  assert.equal(res.items[0].code, 'EBLOCKED', 'the symptom must not overwrite the cause');
});

// A run with nothing completed used to come back through this join as 'failed', which
// turned a request for a person into a dead end nobody could act on.
test('the artifact join does not lower a run that is waiting for a person', async () => {
  const envelope = {
    schema: 'browse/2', runId: 'run-x', status: 'needs_input', ok: false, complete: false,
    requested: 1, completed: 0, unreturned: 0, partial: ['needs-input'], effects: [],
    ledger: [{ jobId: 'j000', index: 0 }], pwd: '/tmp/session',
    items: [{ jobId: 'j000', url: 'https://a.test', ok: false, status: 'needs_input', code: 'EBLOCKED', blockKind: 'login-wall' }],
  };
  const capture = createCaptureMany({
    session: { run: async () => envelope },
    assertInside: (p) => p,
    deps: { mkdirImpl: async () => {}, realpathImpl: async (p) => p, writeFileImpl: async () => {}, readFileImpl: async () => Buffer.alloc(0) },
  });
  const res = await capture(['https://a.test'], { outDir: '/tmp/out' });
  assert.equal(res.status, 'needs_input');
  assert.equal(res.complete, false);
});

const base = { urls: ['https://a.test'], timeoutMs: 5000 };
const refuses = (job, re) => assert.throws(() => validateJob(job), (e) => e instanceof BrowseOptionError && e.code === 'EBADVAL' && re.test(e.message));

test('requireContent brings its own check, or names one beside it', () => {
  // The pattern IS the check, so it stands alone.
  const withPattern = validateJob({ ...base, requireContent: 'Signed in as' });
  assert.equal(withPattern.requireContentPattern, 'Signed in as');
  assert.equal(withPattern.requireContent, true);
  // A bare true with nothing beside it is legal, and means: fail the item if the render
  // heuristics fire. It does not claim verification, because `asked` never counts the
  // boolean — an earlier revision refused this call on a hole that was never open, and
  // broke a caller who wanted exactly that.
  assert.equal(validateJob({ ...base, requireContent: true }).requireContent, true);
  assert.equal(validateJob({ ...base, requireContent: true }).requireContentPattern, null);
  assert.equal(validateJob({ ...base, requireContent: true, minTextChars: 100 }).requireContent, true);
  assert.equal(validateJob({ ...base, requireContent: true, requireSelector: 'main' }).requireContent, true);
  // A pattern that cannot compile is a refusal, not a check that never matches.
  refuses({ ...base, requireContent: '([unclosed' }, /not a valid regular expression/);
  refuses({ ...base, requireContent: '' }, /cannot be an empty pattern/);
  refuses({ ...base, requireContent: 42 }, /must be true, or a regular expression/);
  // Off stays off.
  assert.equal(validateJob(base).requireContent, false);
  assert.equal(validateJob(base).requireContentPattern, null);
});
