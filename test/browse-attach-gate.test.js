// browse.attach is a write path, and it was the one with nothing in front of it.
//
// The batch gate guards tabs this tool opened. attach reaches the same verbs on the tab the
// person is signed into and looking at, by its own compiler and its own call into the REPL,
// so session.run never saw it. It also passed no runId and no onEffect, which meant a click
// on that tab produced no ledger entry at all: requested, confirmed, unconfirmed - none of
// it existed, so a click followed by the process dying left nothing behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttach } from '../src/host/browse/attach.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';

const PAGE = { kind: 'page', tab: { targetId: 'T1' }, href: 'https://portal.test/', contentVerified: null, actionsOk: true, actions: [] };
// The run id is read back out of the compiled source rather than hard-coded, so these
// fixtures answer as the real script would: with the id THIS call issued. A fixed id would
// have let the wiring break without the assertions noticing.
const effectLine = (runId, state) => JSON.stringify({
  type: 'effect',
  effect: { operationId: runId + '-attach-0', runId, jobId: 'attach', i: 0, verb: 'click', state, at: 1 },
});
const runIdOf = (src) => {
  const m = String(src).match(/"runId":"(attach-[0-9a-f-]+)"/);
  assert.ok(m, 'the compiled attach source carries no runId, so nothing downstream could correlate an effect');
  return m[1];
};
const attachWith = (raw) => createAttach({ config: { browseCaps: { enabled: true } }, session: { raw } });
const WRITE = { targetId: 'T1', refsFingerprint: 'r1-test', actions: [{ ref: 'e1', click: true }] };

test('a click on the tab you are signed into is refused without the declaration', async () => {
  let reached = false;
  const attach = attachWith(async () => { reached = true; return { rows: [PAGE], raw: { stdout: '' } }; });
  const res = await attach.attach(WRITE);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'EWRITEAPPROVAL');
  assert.deepEqual(res.wants, ['click']);
  assert.equal(reached, false, 'the refusal has to happen before the repl is called at all');
  assert.match(res.error, /signed into/);
});

test('the refusal is attach shaped, not a batch envelope', async () => {
  const res = await attachWith(async () => ({ rows: [PAGE], raw: { stdout: '' } })).attach(WRITE);
  // A caller reading this surface should not have to learn the other one to understand
  // being turned down.
  for (const key of ['ok', 'code', 'error', 'wants', 'tab', 'tabs', 'contentVerified']) {
    assert.ok(key in res, 'the attach refusal is missing ' + key);
  }
  assert.equal('items' in res, false, 'items belongs to the batch envelope');
  assert.equal('schema' in res, false);
});

test('saying so lets the same call through, under an id the compiled source carries', async () => {
  let compiledRunId = null;
  const attach = attachWith(async (src) => {
    compiledRunId = runIdOf(src);
    return { rows: [PAGE], raw: { stdout: [effectLine(compiledRunId, 'started'), effectLine(compiledRunId, 'confirmed')].join('\n') } };
  });
  const res = await attach.attach({ ...WRITE, approveWrites: true });
  assert.ok(compiledRunId, 'the repl has to have been called for any of this to mean anything');
  assert.equal(res.ok, true);
  assert.equal(res.runId, compiledRunId,
    'the id the caller is handed has to be the one the script was told to stamp its effects with');
});

test('an attached write is recorded, and an unconfirmed one is not called done', async () => {
  const confirmed = await attachWith(async (src) => {
    const id = runIdOf(src);
    return { rows: [PAGE], raw: { stdout: [effectLine(id, 'started'), effectLine(id, 'confirmed')].join('\n') } };
  }).attach({ ...WRITE, approveWrites: true });
  assert.equal(confirmed.effects.length, 1, 'the ledger has to have the click in it before its state means anything');
  assert.equal(confirmed.effects[0].state, 'confirmed');
  assert.equal(confirmed.effects[0].verb, 'click');

  const unconfirmed = await attachWith(async (src) => ({
    rows: [PAGE], raw: { stdout: effectLine(runIdOf(src), 'started') },
  })).attach({ ...WRITE, approveWrites: true });
  assert.equal(unconfirmed.effects.length, 1);
  assert.equal(unconfirmed.effects[0].state, 'indeterminate',
    'requested and never confirmed is not the same as never requested');
});

test('a click that went out before the run died is still on the record', async () => {
  // The case the whole ledger exists for. session.raw used to answer a failed marker with
  // rows: [] and nothing else, so the transcript - the only place the effect line lives -
  // went with it.
  let compiledRunId = null;
  const attach = attachWith(async (src) => {
    compiledRunId = runIdOf(src);
    return { error: 'the run produced no marker', rows: [], raw: { stdout: effectLine(compiledRunId, 'started') } };
  });
  await assert.rejects(
    () => attach.attach({ ...WRITE, approveWrites: true }),
    (e) => {
      assert.equal(e.code, 'EREPL');
      assert.equal(e.effects.length, 1, 'a click on a live page must not be erased by the failure after it');
      assert.equal(e.effects[0].state, 'indeterminate');
      assert.equal(e.runId, compiledRunId,
        'a surviving record that cannot be tied back to the call that sent it is most of the way to no record');
      return true;
    },
  );
});

test('a read is never asked to declare anything', async () => {
  let reached = false;
  const attach = attachWith(async () => { reached = true; return { rows: [PAGE], raw: { stdout: '' } }; });
  const res = await attach.attach({ targetId: 'T1' });
  assert.equal(reached, true, 'a read must go straight through');
  assert.notEqual(res.code, 'EWRITEAPPROVAL');
  // And the declaration cannot be set on a call with nothing to declare.
  assert.throws(() => validateAttach({ targetId: 'T1', approveWrites: true }), (e) => e.code === 'EINVAL');
});

test('consent is a boolean here too', () => {
  for (const value of ['true', 'false', 1, 0, {}]) {
    assert.throws(
      () => validateAttach({ ...WRITE, approveWrites: value }),
      (e) => e.code === 'EINVAL',
      'approveWrites: ' + JSON.stringify(value) + ' must not read as consent',
    );
  }
});
