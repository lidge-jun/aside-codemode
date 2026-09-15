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
  // Nearest rank over 1..30 puts p95 at 29, not at the maximum. Pinning the value is what
  // stops a later 'simplification' to s[s.length - 1] from passing.
  assert.equal(s.paths[0].p95Ms, 29);
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
  assert.deepEqual(s.paths.map((p) => p.pathId), ['a', 'b']);
  assert.deepEqual(s.paths.map((p) => p.path), ['a / unspecified', 'b / unspecified']);
  assert.equal(s.totalRuns, 4);
  assert.equal(s.paths[0].medianMs, 110);
  assert.equal(s.paths[1].medianMs, 290);
});

test('plan rows from a dry run are not counted as measurements', () => {
  const s = summarize([{ kind: 'plan', workload: 'w', path: 'a' }, run('a', 0, 100)]);
  assert.equal(s.totalRuns, 1);
  assert.equal(s.paths.length, 1);
});

test('cold and warm are kept apart instead of pooled', () => {
  // Pooling them lets a slow cold start be averaged away by the warm runs beside it, which is
  // how a cold-start regression disappears from a report that still looks honest.
  const rows = [
    { ...run('a', 0, 9000), mode: 'cold' },
    { ...run('a', 1, 9200), mode: 'cold' },
    { ...run('a', 2, 1000), mode: 'warm' },
    { ...run('a', 3, 1100), mode: 'warm' },
  ];
  const s = summarize(rows);
  assert.deepEqual(s.paths.map((p) => p.path), ['a / cold', 'a / warm']);
  assert.equal(s.paths[0].medianMs, 9100);
  assert.equal(s.paths[1].medianMs, 1050);
  assert.deepEqual(s.paths.map((p) => p.pathId), ['a', 'a']);
  assert.deepEqual(s.paths.map((p) => p.mode), ['cold', 'warm']);
});

test('rows without a mode keep their own bucket instead of joining warm', () => {
  // Merging them would let an old campaign and a new warm one share a median, which is how a
  // 100 ms row and a 9000 ms row average into a number that describes neither.
  const s = summarize([run('a', 0, 100), { ...run('a', 1, 9000), mode: 'warm' }]);
  assert.deepEqual(s.paths.map((p) => p.path), ['a / unspecified', 'a / warm']);
  assert.equal(s.paths[0].medianMs, 100);
  assert.equal(s.paths[1].medianMs, 9000);
  assert.equal(s.paths[0].roundTrips, null, 'a missing call count must not be invented');
});

test('a bucket whose runs disagree about call count prints no single figure', () => {
  const rows = [{ ...run('n', 0, 900), roundTrips: 3 }, { ...run('n', 1, 400), roundTrips: 1 }];
  const s = summarize(rows);
  assert.equal(s.paths[0].roundTrips, null);
  assert.deepEqual(s.paths[0].roundTripsMixed, [1, 3]);
  assert.match(render(s), /different call counts/);
});

test('a clean run says failures were none rather than staying silent', () => {
  assert.match(render(summarize([run('a', 0, 100)])), /failed: none/);
});

test('two cold campaigns that waited different amounts are two conditions', () => {
  // Pooling them gives a median that describes neither, and 'cold' stops meaning anything.
  const rows = [
    { ...run('a', 0, 1000), mode: 'cold', idleMs: 0 },
    { ...run('a', 1, 5000), mode: 'cold', idleMs: 3000 },
  ];
  const s = summarize(rows);
  assert.equal(s.paths.length, 2);
  assert.deepEqual(s.paths.map((p) => p.path), ['a / cold', 'a / cold +3000ms idle']);
});

test('a bucket where only some runs reported a call count prints none', () => {
  const rows = [{ ...run('a', 0, 100), roundTrips: 3 }, run('a', 1, 110)];
  const s = summarize(rows);
  assert.equal(s.paths[0].roundTrips, null);
  assert.equal(s.paths[0].roundTripsPartial, true);
  assert.match(render(s), /did not report a call count/);
});

test('who went first is in the report, not only in the runner output', () => {
  const rows = [
    { ...run('a', 0, 100), slot: 0 }, { ...run('b', 0, 100), slot: 1 },
    { ...run('b', 1, 100), slot: 0 }, { ...run('a', 1, 100), slot: 1 },
    { ...run('a', 2, 100), slot: 0 }, { ...run('b', 2, 100), slot: 1 },
  ];
  const text = render(summarize(rows));
  assert.match(text, /Went first/);
  assert.match(text, /a \/ unspecified 2\/3/);
  assert.match(text, /b \/ unspecified 1\/3/);
});

test('the report says how many calls a path needed per run', () => {
  const rows = [
    { ...run('native', 0, 900), roundTrips: 3 },
    { ...run('native', 1, 950), roundTrips: 3 },
    { ...run('batch', 0, 400), roundTrips: 1 },
  ];
  const s = summarize(rows);
  assert.equal(s.paths[0].roundTrips, 3);
  assert.equal(s.paths[1].roundTrips, 1);
  const text = render(s);
  assert.match(text, /calls per run/);
});
