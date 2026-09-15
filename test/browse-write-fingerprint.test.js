// Making the staleness guard mandatory for the steps that can change something.
//
// The implementation has been there for a while and so has the warning. What was missing
// was that nothing required either. The tool's own measurement is the argument: one
// measured click grew a tree from 3,126 characters to 23,530 and renumbered it, so a ref
// minted before a click names a different element after it.
//
// The third rule is the one a review had to point out. Without it the first two are
// satisfiable by any string: allowStaleRefs skips the comparison entirely and stamps
// refGuard 'disabled', so a caller could pass a fingerprint-shaped value and then turn off
// the check that reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJob, gatedVerbs } from '../src/host/browse/schema.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';
import { NO_EFFECT_VERBS } from '../src/host/browse/actions-run.js';

const batch = (over) => validateJob({ urls: ['https://portal.test/a'], approveWrites: true, ...over });
// Without the declaration, for jobs that have nothing to declare: setting approveWrites on
// one of those is itself refused, which is the write gate doing its job.
const readBatch = (over) => validateJob({ urls: ['https://portal.test/a'], ...over });
const attach = (over) => validateAttach({ targetId: 'T1', ...over });
const refused = (fn, match) => assert.throws(fn, (e) => (e.code === 'EBADVAL' || e.code === 'EINVAL') && match.test(e.message));

test('a write by ref without a fingerprint is refused, on both paths', () => {
  refused(() => batch({ actions: [{ ref: 'e1', click: true }] }), /refsFingerprint is required/);
  refused(() => attach({ actions: [{ ref: 'e1', click: true }] }), /refsFingerprint is required/);
  // And the same step with one is fine, so the refusal is about the fingerprint.
  assert.ok(batch({ refsFingerprint: 'r12-abc', actions: [{ ref: 'e1', click: true }] }));
  assert.ok(attach({ refsFingerprint: 'r12-abc', actions: [{ ref: 'e1', click: true }] }));
});

test('a structure-only fingerprint cannot authorise a write', () => {
  // 's' is what summarizeTree prefixes fingerprintStructure with; 'r' is the full one. It
  // compares ref and role only, so a reordered list looks unchanged to it - which is
  // exactly the accident of clicking the row next to the one you meant.
  refused(() => batch({ refsFingerprint: 's12-abc', actions: [{ ref: 'e1', click: true }] }), /fingerprintStructure cannot authorise/);
  refused(() => attach({ refsFingerprint: 's12-abc', actions: [{ ref: 'e1', click: true }] }), /fingerprintStructure cannot authorise/);
  assert.ok(batch({ refsFingerprint: 'r12-abc', actions: [{ ref: 'e1', click: true }] }));
});

test('the check cannot be turned off underneath the rule that requires it', () => {
  refused(
    () => batch({ refsFingerprint: 'r12-abc', allowStaleRefs: true, actions: [{ ref: 'e1', click: true }] }),
    /allowStaleRefs turns off the check/,
  );
  refused(
    () => attach({ refsFingerprint: 'r12-abc', allowStaleRefs: true, actions: [{ ref: 'e1', click: true }] }),
    /allowStaleRefs turns off the check/,
  );
});

test('steps aimed some other way keep every option they had', () => {
  // Writing this test is what showed that every verb which CAN be aimed by ref is an effect
  // verb: the three that are not - waitFor, waitForLoadState, sleepMs - take a selector or
  // nothing. So allowStaleRefs plus a ref step now always means a step that could change
  // something with the check turned off, which is the combination being refused, and the
  // option no longer has a use alongside actions. That is stated in the catalog rather than
  // left for someone to discover.
  assert.ok(readBatch({ allowStaleRefs: true, actions: [{ sleepMs: 10 }] }));
  assert.ok(readBatch({ allowStaleRefs: true, actions: [{ waitFor: '.ready' }] }));
  // A selector does not use the numbering the fingerprint protects.
  assert.ok(batch({ allowStaleRefs: true, actions: [{ selector: '#go', click: true }] }));
  assert.ok(attach({ actions: [{ selector: '#go', click: true }] }));
});

test('every gated verb is covered, not just click', () => {
  const byRef = ['click', 'dblclick', 'hover', 'focus', 'check', 'uncheck', 'scrollIntoView'];
  assert.ok(byRef.length > 1, 'the sweep needs more than one verb to mean anything');
  for (const verb of byRef) {
    assert.equal(NO_EFFECT_VERBS.includes(verb), false, verb + ' should be a gated verb for this sweep to be about anything');
    refused(() => batch({ actions: [{ ref: 'e1', [verb]: true }] }), /refsFingerprint is required/);
  }
  // A value verb takes the same route.
  refused(() => batch({ actions: [{ ref: 'e1', fill: 'x' }] }), /refsFingerprint is required/);
  // And a step that waits does not ask for one, whichever way it is aimed.
  const waiting = readBatch({ actions: [{ waitFor: '.ready' }, { sleepMs: 5 }] });
  assert.deepEqual(gatedVerbs(waiting.actions), [], 'waiting is not a gated verb');
});
