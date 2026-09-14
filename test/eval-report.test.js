// wp10. The report is where a measurement turns into a claim, so these cases pin the three
// places a flattering number could sneak in: a p95 from too few samples, a failure quietly
// dropped from the median, and a median printed without the values behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, render, median, P95_MIN_SAMPLES } from '../eval/report.mjs';

const run = (path, pair, ms, ok = true, why = null) => ({ kind: 'run', workload: 'w', path, pair, slot: 0, ms, ok, why });

test('the median is right for both an odd and an even number of samples', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
});

test('p95 is not computed below the sample threshold, and the report says so', () => {
  const rows = Array.from({ length: 10 }, (_, i) => run('a', i, 100 + i));
  const s = summarize(rows);
  assert.equal(s.paths[0].p95Ms, null);
  assert.match(s.paths[0].p95Note, new RegExp(String(P95_MIN_SAMPLES)));
  const text = render(s);
  assert.match(text, /not computed/);
  assert.equal(/\| 1[0-9][0-9] \|$/m.test(text.split('\n')[3]), false, 'a p95 number appeared anyway');
});

test('p95 appears once there are enough samples', () => {
  const rows = Array.from({ length: P95_MIN_SAMPLES }, (_, i) => run('a', i, i + 1));
  const s = summarize(rows);
  assert.equal(s.paths[0].p95Note, null);
  assert.equal(typeof s.paths[0].p95Ms, 'number');
});

test('a failed run stays in the median and shows up as an error rate', () => {
  const rows = [run('a', 0, 100), run('a', 1, 900, false, 'exit 1'), run('a', 2, 200)];
  const s = summarize(rows);
  const a = s.paths[0];
  assert.equal(a.runs, 3);
  assert.equal(a.medianMs, 200, 'the failure was dropped from the median');
  assert.equal(a.medianOkMs, 150, 'the ok-only median must be reported separately, not instead');
  assert.equal(Number(a.errorRate.toFixed(3)), 0.333);
  assert.deepEqual(a.failures, [{ pair: 1, why: 'exit 1' }]);
  assert.match(render(s), /exit 1/);
});

test('every value is printed, not just the summary', () => {
  const rows = [run('a', 0, 111), run('a', 1, 222), run('b', 0, 333)];
  const text = render(summarize(rows));
  for (const ms of [111, 222, 333]) assert.ok(text.includes(String(ms)), ms + ' is missing from the report');
});

test('two paths are summarised side by side', () => {
  const rows = [run('a', 0, 100), run('b', 0, 300), run('a', 1, 120), run('b', 1, 280)];
  const s = summarize(rows);
  assert.deepEqual(s.paths.map((p) => p.path), ['a', 'b']);
  assert.equal(s.totalRuns, 4);
  assert.equal(s.paths[0].medianMs, 110);
  assert.equal(s.paths[1].medianMs, 290);
});

test('plan rows from a dry run are not counted as measurements', () => {
  const s = summarize([{ kind: 'plan', workload: 'w', path: 'a' }, run('a', 0, 100)]);
  assert.equal(s.totalRuns, 1);
  assert.equal(s.paths.length, 1);
});
