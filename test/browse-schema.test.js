// Schema refusals. Each case corresponds to something Aside was MEASURED to accept
// silently, which is why it has to be caught here instead of at runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJob, BrowseOptionError, WAIT_STATES } from '../src/host/browse/schema.js';

const base = { urls: ['https://example.com'] };
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

test('an unknown job option is rejected with the valid list', () => {
  const e = codeOf(() => validateJob({ ...base, nope: 1 }));
  assert.equal(e, 'EBADOPT');
  assert.throws(() => validateJob({ ...base, nope: 1 }), /valid: urls, timeoutMs/);
});

test('options Aside silently ignores are refused before anything spawns', () => {
  assert.equal(codeOf(() => validateJob({ ...base, screenshot: { maxWidth: 640 } })), 'ENOTSUP');
  assert.equal(codeOf(() => validateJob({ ...base, pdf: { format: 'A4' } })), 'ENOTSUP');
  assert.equal(codeOf(() => validateJob({ ...base, route: true })), 'ENOTSUP');
  assert.equal(codeOf(() => validateJob({ urls: ['file:///c:/x.html'] })), 'ENOTSUP');
});

test('networkidle is ENOTSUP and any other unknown wait state is EBADVAL', () => {
  // Measured: Aside accepts networkidle but downgrades it to 'stable' with a 5s timeout,
  // and accepts literal garbage without error. Neither is detectable at runtime.
  assert.equal(codeOf(() => validateJob({ ...base, waitUntil: 'networkidle' })), 'ENOTSUP');
  assert.equal(codeOf(() => validateJob({ ...base, waitUntil: 'not-a-state' })), 'EBADVAL');
  for (const s of WAIT_STATES) {
    assert.equal(validateJob({ ...base, waitUntil: s }).waitUntil, s);
  }
});

test('timeoutMs is clamped to the configured inner cap, not to the Aside ceiling', () => {
  assert.equal(validateJob({ ...base, timeoutMs: 999999 }).timeoutMs, 25000);
  assert.equal(validateJob({ ...base, timeoutMs: 999999 }, { timeoutMs: 9000 }).timeoutMs, 9000);
  assert.equal(validateJob({ ...base, timeoutMs: 5000 }).timeoutMs, 5000);
});

test('a job must carry at least one url and every url must be a string', () => {
  assert.equal(codeOf(() => validateJob({ urls: [] })), 'EBADVAL');
  assert.equal(codeOf(() => validateJob({ urls: [42] })), 'EBADVAL');
  assert.ok(validateJob(base).urls.length === 1);
});

test('a valid job is frozen so a caller cannot mutate it after validation', () => {
  const job = validateJob(base);
  assert.throws(() => { job.urls = []; }, TypeError);
  assert.ok(new BrowseOptionError('x', 'E').name === 'BrowseOptionError');
});

test('pdf css page size and margins are validated and preserved', () => {
  const pdf = { preferCSSPageSize: true, margin: { top: '20mm', right: 12, bottom: '1.5cm', left: '0in' } };
  assert.deepEqual(validateJob({ ...base, pdf }).pdf, pdf);
  assert.equal(codeOf(() => validateJob({ ...base, pdf: { preferCSSPageSize: 'true' } })), 'EBADVAL');
  assert.equal(codeOf(() => validateJob({ ...base, pdf: { margin: { center: '1in' } } })), 'EBADOPT');
  assert.equal(codeOf(() => validateJob({ ...base, pdf: { margin: { top: '20' } } })), 'EBADVAL');
});
