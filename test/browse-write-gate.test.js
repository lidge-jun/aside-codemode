// The write gate. Two things are being protected here and they fail in different ways.
//
// The first is that a batch which can change something never travels without the caller
// having said so. The proof that matters is not the returned status but that nothing was
// resolved and nothing was spawned: a refusal that happens after the process starts is not
// a gate, it is a regret.
//
// The second is that the gated set cannot drift. It is the effect ledger exactly, and the
// ledger lives inside the shipped script as a string the host cannot import. So the last
// test in this file reads the names back out of that string and compares them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowseSession, itemStatus, writeApprovalRefusal } from '../src/host/browse/session.js';
import { validateJob, gatedVerbs } from '../src/host/browse/schema.js';
import { checkResultEnvelope } from '../src/host/browse/result-contract.js';
import { ACTION_STEP_SRC, NO_EFFECT_VERBS } from '../src/host/browse/actions-run.js';

const never = (what) => async () => { throw new Error('the gate let the run reach ' + what); };
const session = () => createBrowseSession({ resolveAside: never('resolveAside'), spawnAside: never('spawnAside') });

test('a batch that could change something is refused before anything is spawned', async () => {
  const res = await session().run({
    urls: ['https://portal.test/a', 'https://portal.test/b'],
    actions: [{ ref: 'e1', click: true }, { ref: 'e2', fill: 'hello' }],
  });
  // If the gate were even one line later this call would have thrown instead of answering.
  assert.equal(res.status, 'needs_input');
  assert.equal(res.code, 'EWRITEAPPROVAL');
  assert.equal(res.ok, false);
  assert.equal(res.complete, false);
  assert.deepEqual(res.effects, [], 'nothing ran, so nothing can be reported as having run');
  assert.deepEqual(res.actionLog, []);
  assert.equal(res.items.length, 2, 'every requested url has to be answered, not just the first');
  assert.ok(res.items.every((i) => i.code === 'EWRITEAPPROVAL' && i.status === 'needs_input'));
});

test('the refusal names the verbs it wanted, in the order they were asked for', async () => {
  const res = await session().run({
    urls: ['https://portal.test/a'],
    actions: [
      { ref: 'e1', click: true },
      { waitFor: '.ready' },
      { ref: 'e2', fill: 'x' },
      { ref: 'e3', click: true },
    ],
  });
  assert.deepEqual(res.wants, ['click', 'fill'],
    'once each, in request order, and the wait is not one of them');
  assert.ok(res.items.every((i) => Array.isArray(i.wants) && i.wants.length === 2),
    'the item carries it too: a caller reading items[] must not have to look up');
});

test('the refusal is an ordinary envelope, not a second shape to learn', async () => {
  const res = await session().run({ urls: ['https://portal.test/a'], actions: [{ ref: 'e1', click: true }] });
  assert.deepEqual(checkResultEnvelope(res), [], 'the contract checker must accept it unchanged');
  // The fields a settled run carries. An envelope missing half of them makes the caller
  // branch on which kind of answer it got, which is the thing the contract exists to avoid.
  for (const key of ['ledger', 'reconciledBy', 'truncated', 'contentVerified', 'timings', 'leakedUrls', 'tabs', 'raw', 'pwd', 'partial']) {
    assert.ok(key in res, 'the refusal envelope is missing ' + key);
  }
  assert.ok(res.partial.includes('write-approval'));
  assert.ok(res.partial.includes('needs-input'));
});

test('a job that only reads is not asked to approve anything', async () => {
  const run = session().run({ urls: ['https://portal.test/a'], actions: [{ waitFor: '.ready' }, { sleepMs: 10 }] });
  // Reaching resolveAside IS the pass: the gate returned nothing and the run went on.
  await assert.rejects(run, /the gate let the run reach resolveAside/);
});

test('saying so lets the same batch through', async () => {
  const run = session().run({
    urls: ['https://portal.test/a'], approveWrites: true, actions: [{ ref: 'e1', click: true }],
  });
  await assert.rejects(run, /the gate let the run reach resolveAside/);
});

test('the declaration cannot be set on a job that has nothing to declare', () => {
  assert.throws(
    () => validateJob({ urls: ['https://portal.test/a'], approveWrites: true }),
    (e) => e.code === 'EBADVAL' && /no step that could change anything/.test(e.message),
  );
  assert.throws(
    () => validateJob({ urls: ['https://portal.test/a'], approveWrites: true, actions: [{ waitFor: '.x' }] }),
    (e) => e.code === 'EBADVAL',
  );
});

test('consent is a boolean and is not coerced from anything else', () => {
  for (const value of ['true', 'false', 1, 0, {}, []]) {
    assert.throws(
      () => validateJob({ urls: ['https://portal.test/a'], approveWrites: value, actions: [{ ref: 'e1', click: true }] }),
      (e) => e.code === 'EBADVAL',
      'approveWrites: ' + JSON.stringify(value) + ' must not read as consent',
    );
  }
});

test('the item status agrees with the envelope', () => {
  assert.equal(itemStatus({ ok: false, code: 'EWRITEAPPROVAL' }), 'needs_input');
  // The envelope stamps the status by hand, so the function has to answer the same way or
  // the same code means two things depending on which path read it.
  const res = writeApprovalRefusal({
    runId: 'run-x', requested: [{ jobId: 'j000', url: 'https://portal.test/a', index: 0 }],
    wants: ['click'], job: {},
  });
  assert.equal(itemStatus(res.items[0]), res.items[0].status);
});

test('the gated set is the effect ledger, read out of the script that ships', () => {
  // __NOEFFECT is inside ACTION_STEP_SRC, which is a string on purpose: it travels. The
  // host keeps its own copy, and copies drift. This reads the shipped one back.
  const line = ACTION_STEP_SRC.split('\n').find((l) => l.includes('__NOEFFECT'));
  assert.ok(line, 'the shipped fragment no longer declares __NOEFFECT; the gate is reading a ghost');
  const shipped = (line.match(/([A-Za-z]+): 1/g) || []).map((s) => s.split(':')[0]);
  assert.ok(shipped.length > 0, 'nothing was parsed out of the line, so the comparison would pass on nothing');
  assert.deepEqual(shipped.slice().sort(), NO_EFFECT_VERBS.slice().sort(),
    'the host and the shipped script disagree about which verbs have no effect');
});

test('every verb outside that set is gated, and the wait verbs are not', () => {
  const step = (verb) => {
    if (verb === 'sleepMs') return { sleepMs: 10 };
    if (verb === 'waitForLoadState') return { waitForLoadState: 'load' };
    if (verb === 'scroll') return { scroll: 'top' };
    if (['fill', 'type', 'press', 'selectOption'].includes(verb)) return { ref: 'e1', [verb]: 'x' };
    if (['goBack', 'goForward', 'reload'].includes(verb)) return { [verb]: true };
    if (verb === 'waitFor') return { waitFor: '.x' };
    return { ref: 'e1', [verb]: true };
  };
  const ALL = ['click', 'dblclick', 'fill', 'type', 'press', 'hover', 'focus', 'check', 'uncheck',
    'selectOption', 'scrollIntoView', 'waitFor', 'waitForLoadState', 'goBack', 'goForward',
    'reload', 'scroll', 'sleepMs'];
  assert.equal(ALL.length, 18, 'the verb catalogue changed; this sweep has to change with it');
  for (const verb of ALL) {
    const job = validateJob({ urls: ['https://portal.test/a'], actions: [step(verb)] });
    const gated = gatedVerbs(job.actions);
    if (NO_EFFECT_VERBS.includes(verb)) {
      assert.deepEqual(gated, [], verb + ' waits; it must not ask for consent');
    } else {
      assert.deepEqual(gated, [verb], verb + ' is an effect verb and must be gated');
    }
  }
});

