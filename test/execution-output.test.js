// wp7 F13. A result that does not fit the budget is shrunk, not stringified. Turning the
// object into truncated JSON took the answer away: status, counts and per-item ids all
// became text that could no longer be read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitEnvelope, shrinkStructured } from '../src/execution-output.js';

const envelope = (items) => ({
  schema: 'browse/2', status: 'partial', runId: 'run-x', requested: items.length,
  completed: items.filter((i) => i.status === 'completed').length, complete: false,
  items, partial: ['unreturned'], leakedUrls: [],
});

test('an oversized object result stays an object and keeps the fields that explain it', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ jobId: 'j' + i, status: 'completed', tree: 'z'.repeat(400) }));
  const out = fitEnvelope({ ok: true, result: envelope(items), logs: [] }, 4000);
  assert.equal(typeof out.result, 'object', 'the caller has to be able to read it');
  assert.equal(out.result.status, 'partial');
  assert.equal(out.result.runId, 'run-x');
  assert.equal(out.result.requested, 40);
  assert.ok(out.result.omittedItems > 0, 'and it has to say what it dropped');
  assert.equal(out.truncated, true);
});

test('a result that fits is untouched', () => {
  const small = envelope([{ jobId: 'j0', status: 'completed' }]);
  const out = fitEnvelope({ ok: true, result: small, logs: [] }, 100000);
  assert.deepEqual(out.result, small);
  assert.ok(!out.truncated);
});

test('a string result still truncates the old way', () => {
  const out = fitEnvelope({ ok: true, result: 'y'.repeat(5000), logs: [] }, 1000);
  assert.equal(typeof out.result, 'string');
  assert.ok(out.result.length < 5000);
  assert.equal(out.truncated, true);
});

test('an error is still text, because that is what an error is', () => {
  const out = fitEnvelope({ ok: false, error: 'e'.repeat(5000), logs: [] }, 1000);
  assert.equal(typeof out.error, 'string');
  assert.equal(out.truncated, true);
});

test('shrinkStructured keeps the outcome fields ahead of the payload', () => {
  const shrunk = shrinkStructured({ status: 'completed', runId: 'r', items: [1, 2, 3], note: 'x'.repeat(500) }, 80);
  assert.equal(shrunk.status, 'completed');
  assert.equal(shrunk.runId, 'r');
  assert.ok(Array.isArray(shrunk.items), 'an array stays an array even when it is emptied');
  assert.ok(
    shrunk.omittedItems > 0 || shrunk.omittedKeys || shrunk.truncatedKeys,
    'whatever was lost is named rather than silently missing',
  );
  assert.deepEqual(shrunk.truncatedKeys, ['note']);
});
