// wp10. A measurement harness that accepts a broken workload, or that always runs the same
// path first, produces numbers nobody should act on. These cases pin both.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWorkload, schedule, judge, runWorkload, pathPrograms, leadCounts,
  WorkloadError, MODES,
} from '../eval/paired-run.mjs';

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
  const good = judge({ code: 0, stdout: 'EVAL_JSON {"count":6}' }, { count: 6 });
  assert.equal(good.ok, true);
  assert.equal(good.why, null);
  assert.deepEqual(good.value, { count: 6 });
  assert.equal(judge({ code: 0, stdout: 'EVAL_JSON {"count":5}' }, { count: 6 }).ok, false);
  assert.match(judge({ code: 0, stdout: 'EVAL_JSON {"count":5}' }, { count: 6 }).why, /wanted 6/);
  assert.equal(judge({ code: 0, stdout: 'nothing here' }, {}).ok, false);
  assert.equal(judge({ code: 1, stdout: 'EVAL_JSON {"count":6}' }, { count: 6 }).ok, false);
});

test('a sequence is judged on its last line, and every line has to report', () => {
  const out = ['EVAL_JSON {"count":1}', 'EVAL_JSON {"count":2}', 'EVAL_JSON {"count":3,"total":6}'].join('\n');
  const v = judge({ code: 0, stdout: out }, { total: 6 }, ['count']);
  assert.equal(v.ok, true);
  assert.equal(v.values.length, 3, 'only the last line was kept');
  assert.deepEqual(v.value, { count: 3, total: 6 });
  // A middle call that answered nothing is the failure this catches; judging the last line
  // alone would call the run a success.
  const silent = ['EVAL_JSON {"count":1}', 'EVAL_JSON {}', 'EVAL_JSON {"count":3,"total":6}'].join('\n');
  const s = judge({ code: 0, stdout: silent }, { total: 6 }, ['count']);
  assert.equal(s.ok, false);
  assert.match(s.why, /call 2/);
});

test('a call that printed nothing at all fails the run it was part of', () => {
  // The failure the last-line rule hides: call two exits 0, prints nothing, and the run still
  // ends on a good final answer. Counting answers against calls is what catches it.
  const out = ['EVAL_JSON {"count":1}', 'nope', 'EVAL_JSON {"count":3,"total":6}'].join('\n');
  const v = judge({ code: 0, stdout: out }, { total: 6 }, [], 'eval-json', 3);
  assert.equal(v.ok, false);
  assert.match(v.why, /2 answers from 3 calls/);
  // Without the call count it still looks fine, which is why the count is passed in.
  assert.equal(judge({ code: 0, stdout: out }, { total: 6 }).ok, true);
});

test('an answer of zero is an answer', () => {
  const v = judge({ code: 0, stdout: '{"ok":true,"result":0}' }, {}, [], 'last-json-result', 1);
  assert.equal(v.ok, false, 'a scalar is not a shape this harness can check');
  assert.match(v.why, /answered 0/);
  const obj = judge({ code: 0, stdout: '{"ok":true,"result":{"count":0}}' }, { count: 0 }, ['count'], 'last-json-result', 1);
  assert.equal(obj.ok, true, 'count 0 was read as a missing key');
});

test('a malformed answer fails its own run instead of throwing', () => {
  const out = ['{"ok":true,"result":null}', '{"ok":true,"result":{"file":5}}'].join('\n');
  const v = judge({ code: 0, stdout: out }, { file: 5 }, ['file'], 'last-json-result', 2);
  assert.equal(v.ok, false);
  assert.match(v.why, /call 1 answered null/);
});

test('who went first is counted, because an odd number of pairs is not balanced', () => {
  const even = { id: 'w', pairs: 4, paths: [{ id: 'a', program: 'x' }, { id: 'b', program: 'y' }] };
  assert.deepEqual(leadCounts(even), { a: 2, b: 2 });
  assert.deepEqual(leadCounts({ ...even, pairs: 3 }), { a: 2, b: 1 });
});

test('a workload definition that would quietly measure the wrong thing is refused', () => {
  const ok = { id: 'w', pairs: 2, paths: [{ id: 'a', program: 'x' }, { id: 'b', program: 'y' }] };
  assert.throws(() => validateWorkload({ ...ok, paths: [{ id: 'a', program: 'x' }, { id: 'a', program: 'y' }] }), /different ids/);
  assert.throws(() => validateWorkload({ ...ok, paths: [{ id: 'a', program: 'x', answerFrom: 'magic' }, ok.paths[1]] }), /answerFrom/);
  assert.throws(() => validateWorkload({ ...ok, paths: [{ id: 'a', program: 'x', requireKeys: 'count' }, ok.paths[1]] }), /list of strings/);
  assert.throws(() => validateWorkload({ ...ok, paths: [{ id: 'a', program: 'x', expect: [1] }, ok.paths[1]] }), /not an object/);
  assert.throws(() => validateWorkload({ ...ok, expect: [1] }), /expect must be an object/);
  assert.throws(() => validateWorkload({ ...ok, requireKeys: 'count' }), /list of strings/);
});

test('a path may be a sequence of calls, and says how many', () => {
  const w = validateWorkload({
    id: 'seq', pairs: 1,
    paths: [
      { id: 'many', programs: ['one()', 'two()', 'three()'] },
      { id: 'one', program: 'all()' },
    ],
  });
  assert.deepEqual(pathPrograms(w.paths[0]).length, 3);
  const plan = schedule(w);
  assert.deepEqual(plan.map((s) => s.programs.length), [3, 1]);
  assert.throws(() => validateWorkload({ ...w, paths: [{ id: 'x', programs: [] }, w.paths[1]] }), /no program/);
  assert.throws(() => validateWorkload({ ...w, paths: [{ id: 'x', programs: ['ok', 7] }, w.paths[1]] }), /no program/);
});

test('a path may bring its own binary, and it has to be a command', () => {
  const base = { id: 'b', pairs: 1, paths: [{ id: 'a', program: 'x' }, { id: 'b', program: 'y' }] };
  assert.throws(() => validateWorkload({ ...base, paths: [{ id: 'a', program: 'x', bin: '' }, base.paths[1]] }), /not a command/);
  assert.throws(() => validateWorkload({ ...base, paths: [{ id: 'a', program: 'x', args: 'no' }, base.paths[1]] }), /not strings/);
  const ok = validateWorkload({ ...base, paths: [{ id: 'a', program: 'x', bin: 'node', args: ['-e'] }, base.paths[1]] });
  assert.equal(schedule(ok)[0].bin, 'node');
});

test('cold and warm are separate campaigns, and cold really waits', async () => {
  assert.deepEqual([...MODES].sort(), ['cold', 'warm']);
  const waits = [];
  const rows = [];
  await runWorkload({ id: 'w', pairs: 1, paths: [{ id: 'a', program: 'a' }, { id: 'b', program: 'b' }] }, {
    emit: (r) => rows.push(r), bin: process.execPath, args: ['-e'],
    mode: 'cold', idleMs: 5, sleep: async (ms) => { waits.push(ms); },
  });
  assert.deepEqual(waits, [5, 5], 'the idle gap has to precede every invocation, not just the first');
  assert.ok(rows.every((r) => r.mode === 'cold'));
  const warm = [];
  await runWorkload({ id: 'w', pairs: 1, paths: [{ id: 'a', program: 'a' }, { id: 'b', program: 'b' }] }, {
    emit: (r) => warm.push(r), bin: process.execPath, args: ['-e'],
    mode: 'warm', sleep: async () => { throw new Error('warm must not wait'); },
  });
  assert.ok(warm.every((r) => r.mode === 'warm'));
  await assert.rejects(() => runWorkload({ id: 'w', pairs: 1, paths: [{ id: 'a', program: 'a' }, { id: 'b', program: 'b' }] },
    { emit: () => {}, mode: 'lukewarm' }), /mode must be one of/);
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
