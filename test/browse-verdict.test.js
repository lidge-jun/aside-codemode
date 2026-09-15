// The bug this file exists for: itemStatus returned 'blocked', ITEM_STATUSES never listed
// it, and a blocked page is an ordinary thing to meet on the web. So the contract checker
// rejected a result the tool produced on a normal day, and nothing failed until someone
// read both files at once. A vocabulary is only a vocabulary if something compares the two.
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemStatus, runStatus } from '../src/host/browse/session.js';
import { ITEM_STATUSES, RUN_STATUSES } from '../src/host/browse/result-contract.js';

// Every code the function branches on, plus the shapes that reach it without one.
const CODES = [
  'EHOSTKILL', 'ENOMARKER', 'EUNRETURNED', 'ESKIP', 'ETABBUDGET', 'EBLOCKED',
  'EUNRENDERED', 'EACTION', 'EDEADLINE', 'ECONTRACT', 'EPROVENANCE', 'ECAPTURE',
];
const KINDS = [undefined, null, 'login-wall', 'captcha', 'blocked', 'upstream', 'something-new'];

test('itemStatus can only answer in the vocabulary the contract publishes', () => {
  const seen = new Set();
  const escaped = [];
  const record = (item) => {
    const s = itemStatus(item);
    seen.add(s);
    if (!ITEM_STATUSES.includes(s)) escaped.push(JSON.stringify(item) + ' -> ' + s);
  };
  record(null);
  record(undefined);
  for (const ok of [true, false]) {
    for (const actionsOk of [undefined, true, false]) {
      record({ ok, actionsOk });
      for (const code of CODES) {
        for (const blockKind of KINDS) record({ ok, actionsOk, code, blockKind });
      }
    }
  }
  assert.deepEqual(escaped, [], 'a status left the vocabulary');
  // Guard the guard: a rewrite that made every branch answer 'failed' would pass the
  // membership check above while saying nothing.
  assert.ok(seen.size >= 5, 'the sweep only produced ' + seen.size + ' distinct statuses');
});

test('a blocked page is split by whether a person can clear it', () => {
  const blocked = (blockKind) => itemStatus({ ok: false, code: 'EBLOCKED', blockKind });
  assert.equal(blocked('login-wall'), 'needs_input');
  assert.equal(blocked('captcha'), 'needs_input');
  // An origin refusing this client is not fixed by someone signing in.
  assert.equal(blocked('blocked'), 'failed');
  assert.equal(blocked('upstream'), 'failed');
  // Unknown and absent both stay failures: needs_input is a claim, not a default.
  assert.equal(blocked('something-new'), 'failed');
  assert.equal(blocked(undefined), 'failed');
});

test('a run stopped only by a sign-in wall asks rather than fails', () => {
  const marker = 'ok';
  const needs = { status: 'needs_input' };
  const done = { status: 'completed' };
  assert.equal(runStatus({ marker, items: [needs] }), 'needs_input');
  assert.equal(runStatus({ marker, items: [needs, needs] }), 'needs_input');
  // Work that finished is still work that finished.
  assert.equal(runStatus({ marker, items: [done, needs] }), 'partial');
});

test('not knowing outranks asking, but a definite failure does not', () => {
  const marker = 'ok';
  const needs = { status: 'needs_input' };
  // A run we cannot account for is not a run a person fixes by signing in.
  assert.equal(runStatus({ marker, items: [needs, { status: 'indeterminate' }] }), 'indeterminate');
  // These two used to answer 'failed', which is a definite claim that the run is over and
  // the cause is terminal. Neither is true when a person signing in would unblock it, and
  // needs_input is the only signal that tells an agent to hand the run back. Both facts
  // stay visible where a caller can still read them.
  assert.equal(runStatus({ marker, items: [needs], effects: [{ state: 'indeterminate' }] }), 'needs_input');
  assert.equal(runStatus({ marker, items: [needs], extras: 1 }), 'needs_input');
  // And work that finished is still work that finished.
  assert.equal(runStatus({ marker, items: [{ status: 'completed' }, needs], extras: 1 }), 'partial');
});

test('runStatus can only answer in the vocabulary the contract publishes', () => {
  const escaped = [];
  for (const marker of [null, 'ok', 'error']) {
    for (const killed of [true, false]) {
      for (const items of [[], [{ status: 'completed' }], [{ status: 'needs_input' }],
        [{ status: 'failed' }], [{ status: 'completed' }, { status: 'needs_input' }],
        [{ status: 'indeterminate' }], [{ status: 'unreturned' }], [{ status: 'skipped' }]]) {
        for (const extras of [0, 1]) {
          for (const effects of [[], [{ state: 'indeterminate' }]]) {
            for (const leakedUrls of [[], ['https://x.test']]) {
              const s = runStatus({ marker, items, killed, effects, extras, leakedUrls });
              if (!RUN_STATUSES.includes(s)) escaped.push(s + ' from ' + JSON.stringify({ marker, killed, items, extras }));
            }
          }
        }
      }
    }
  }
  assert.deepEqual(escaped, [], 'a run status left the vocabulary');
});
