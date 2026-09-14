// wp10. A measurement harness that accepts a broken workload, or that always runs the same
// path first, produces numbers nobody should act on. These cases pin both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkload, schedule, judge, runWorkload, WorkloadError } from '../eval/paired-run.mjs';

const base = {
  id: 'w', pairs: 2,
  paths: [{ id: 'a', program: 'a()' }, { id: 'b', program: 'b()' }],
};

test('a workload that measures nothing is refused before anything runs', () => {
  assert.throws(() => validateWorkload({ ...base, pairs: 0 }), WorkloadError);
  assert.throws(() => validateWorkload({ ...base, pairs: 1.5 }), WorkloadError);
  assert.throws(() => validateWorkload({ ...base, paths: [base.paths[0]] }), /exactly two paths/);
  assert.throws(() => validateWorkload({ ...base, paths: [base.paths[0], { id: 'b' }] }), /no program/);
  assert.throws(() => validateWorkload({ ...base, id: '' }), /needs an id/);
  assert.doesNotThrow(() => validateWorkload(base));
});

test('pairs alternate which path goes first', () => {
  const plan = schedule({ ...base, pairs: 4 });
  assert.deepEqual(plan.map((s) => s.pathId), ['a', 'b', 'b', 'a', 'a', 'b', 'b', 'a']);
  // Each path leads exactly half the time, which is the whole point of alternating.
  const first = plan.filter((s) => s.slot === 0).map((s) => s.pathId);
  assert.equal(first.filter((x) => x === 'a').length, 2);
  assert.equal(first.filter((x) => x === 'b').length, 2);
});

test('the same workload produces the same schedule twice', () => {
  assert.deepEqual(schedule({ ...base, pairs: 3 }), schedule({ ...base, pairs: 3 }));
});

test('a run that did not answer is failed, not missing', () => {
  assert.deepEqual(judge({ code: 0, stdout: 'EVAL_JSON {"count":6}' }, { count: 6 }), { ok: true, why: null, value: { count: 6 } });
  assert.equal(judge({ code: 0, stdout: 'EVAL_JSON {"count":5}' }, { count: 6 }).ok, false);
  assert.match(judge({ code: 0, stdout: 'EVAL_JSON {"count":5}' }, { count: 6 }).why, /wanted 6/);
  assert.equal(judge({ code: 0, stdout: 'nothing here' }, {}).ok, false);
  assert.equal(judge({ code: 1, stdout: 'EVAL_JSON {"count":6}' }, { count: 6 }).ok, false);
});

test('a dry run reports the plan and starts no process', async () => {
  const rows = [];
  const res = await runWorkload({ ...base, pairs: 3 }, { emit: (r) => rows.push(r), dryRun: true, bin: 'definitely-not-a-binary' });
  assert.equal(res.runs, 0);
  assert.equal(res.planned, 6);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.kind === 'plan'));
});

test('a real run emits one row per execution, in schedule order', async () => {
  const rows = [];
  const res = await runWorkload({ ...base, pairs: 2, expect: { count: 6 } }, {
    emit: (r) => rows.push(r),
    bin: process.execPath,
    args: ['-e'],
  });
  assert.equal(res.runs, 4);
  assert.deepEqual(rows.map((r) => r.path), ['a', 'b', 'b', 'a']);
  // The programs are 'a()' and 'b()', which throw. A harness that quietly dropped them would
  // report a perfect, empty result.
  assert.ok(rows.every((r) => r.ok === false), 'a failing program was reported as fine');
  assert.ok(rows.every((r) => typeof r.ms === 'number'));
});
