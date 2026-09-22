// Issue #45: Search byte budgets (record cap 256KiB, aggregate raw output 4MiB).
//
// Contracts under test:
//  1. Giant (>256KiB) rg JSON match must not crash; normal rows recover; complete:false partial warning.
//  2. Count must not report complete for skipped huge rows.
//  3. Aggregate >4MiB of many <256KiB records must stop and return incomplete/truncated.
//  4. Normal small and exact row max semantics remain unchanged.
//  5. Context separation across skipped record: giant skipped line does not leak into adjacent context.
//  6. Record budget enforces UTF-8 byte limit, not JS string length (multi-byte non-ASCII).
//  7. Guest execute integration: search.content and search.count via codemode CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRgResolver, createRgRunner } from '../src/rg.js';
import { runStream } from '../src/rg-stream.js';

function createRunner(opts = {}) {
  const resolve = createRgResolver({}, process.env);
  return createRgRunner(resolve, opts);
}

test('issue45: giant (>256KiB) rg JSON match does not crash, normal rows recover with complete:false and partial warning', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-giant-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // 300 KiB line ensures the raw rg JSON record well exceeds the 256KiB (262,144 bytes) cap.
  const normalBefore = 'alpha needle match';
  const giantLine = 'x'.repeat(300 * 1024) + ' needle giant ' + 'y'.repeat(1024);
  const normalAfter = 'omega needle match';
  writeFileSync(path.join(dir, 'content.txt'), `${normalBefore}\n${giantLine}\n${normalAfter}\n`);

  const runner = createRunner();
  const hits = await runner.content({ path: dir, query: 'needle' });

  // 1. Must not crash and normal rows must recover
  const texts = hits.map((h) => h.text);
  assert.ok(texts.some((t) => t.includes(normalBefore)), 'normal match before giant line must be recovered');
  assert.ok(texts.some((t) => t.includes(normalAfter)), 'normal match after giant line must be recovered');

  // 2. The giant row itself must not be returned as an accepted hit (skipped due to >256KiB cap)
  assert.ok(hits.every((h) => Buffer.byteLength(h.text, 'utf8') < 256 * 1024), 'giant row (>256KiB) must be skipped');

  // 3. Completeness invariant: skipped huge row must lower completeness
  assert.equal(hits.complete, false, 'skipped huge record must make complete: false');

  // 4. Partial warning: must report that records were unparsable / skipped
  assert.ok(Array.isArray(hits.partial) && hits.partial.length > 0, 'must include partial warning for skipped huge record');
});

test('issue45: count must not report complete for skipped huge rows', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-count-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const normalMatch = 'first needle occurrence';
  const giantLine = 'z'.repeat(300 * 1024) + ' needle ' + 'w'.repeat(1024);
  const secondNormal = 'second needle occurrence';
  writeFileSync(path.join(dir, 'data.txt'), `${normalMatch}\n${giantLine}\n${secondNormal}\n`);

  const runner = createRunner();
  const result = await runner.count({ path: dir, query: 'needle' });

  // 1. Count must NOT report complete when huge rows are skipped
  assert.equal(result.complete, false, 'count must not report complete when huge rows were skipped');

  // 2. Must report a partial warning
  assert.ok(Array.isArray(result.partial) && result.partial.length > 0, 'count must report partial warning');

  // 3. Normal matches must still be counted
  assert.ok(result.matches >= 2, 'count should count at least the normal matches');
});

test('issue45: aggregate >4MiB of many <256KiB records must stop and return incomplete/truncated', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-agg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Create ~6 MiB of matches spread across many records, each ~4 KiB (< 256 KiB record cap).
  // 1,500 records * ~4,100 bytes ≈ 6.15 MiB raw data, exceeding the 4 MiB aggregate cap.
  const lineSize = 4096;
  const numLines = 1500;
  const padding = 'a'.repeat(lineSize - 30);
  const lines = [];
  for (let i = 0; i < numLines; i++) {
    lines.push(`needle record ${String(i).padStart(6, '0')} ${padding}`);
  }
  writeFileSync(path.join(dir, 'many.txt'), lines.join('\n') + '\n');

  const runner = createRunner();
  // Pass high max so that max row count is NOT what terminates the search
  const hits = await runner.content({ path: dir, query: 'needle', max: 10000 });

  // 1. Must stop before returning all 1500 records
  assert.ok(hits.length < numLines, `must stop before reading all ${numLines} records (got ${hits.length})`);
  assert.ok(hits.length > 0, 'must have accepted some records before hitting the 4MiB aggregate limit');

  // 2. Must report truncated and incomplete
  assert.equal(hits.truncated, true, 'must report truncated: true when stopped by aggregate budget');
  assert.equal(hits.complete, false, 'must report complete: false when stopped by aggregate budget');
});

test('issue45: normal small and exact row max semantics remain unchanged', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-normal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(path.join(dir, 'small.txt'), 'hit 1\nhit 2\nhit 3\n');

  const runner = createRunner();

  // Case A: normal small search under max (all fit)
  const allHits = await runner.content({ path: dir, query: 'hit', max: 10 });
  assert.equal(allHits.length, 3);
  assert.equal(allHits.complete, true, 'all hits returned must be complete');
  assert.equal(allHits.truncated, false);
  assert.deepEqual(allHits.partial, []);

  // Case B: exact row max (max === match count)
  const exactHits = await runner.content({ path: dir, query: 'hit', max: 3 });
  assert.equal(exactHits.length, 3);
  assert.equal(exactHits.complete, true, 'exact row max must report complete: true');
  assert.equal(exactHits.truncated, false, 'exact row max must report truncated: false');

  // Case C: row cap hit (max < match count)
  const cappedHits = await runner.content({ path: dir, query: 'hit', max: 2 });
  assert.equal(cappedHits.length, 2);
  assert.equal(cappedHits.complete, false, 'capped search must report complete: false');
  assert.equal(cappedHits.truncated, true, 'capped search must report truncated: true');

  // Case D: normal count
  const countResult = await runner.count({ path: dir, query: 'hit' });
  assert.equal(countResult.matches, 3);
  assert.equal(countResult.complete, true);
  assert.equal(countResult.truncated, false);
  assert.deepEqual(countResult.partial, []);
});

test('issue45: context separation across skipped record', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-context-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Line 1: match alpha
  // Line 2: giant record (>256KiB)
  // Line 3: match beta
  const giantMiddle = 'm'.repeat(300 * 1024);
  writeFileSync(path.join(dir, 'context.txt'), `target_alpha\n${giantMiddle}\ntarget_beta\n`);

  const runner = createRunner();
  const hits = await runner.content({ path: dir, query: 'target_', context: 1 });

  // Both normal matches should be found
  assert.equal(hits.length, 2, 'both normal matches should be recovered');
  assert.equal(hits[0].line, 1);
  assert.equal(hits[1].line, 3);

  // Context separation:
  // 1. Line 1's after context must NOT contain the giant line 2
  assert.ok(
    hits[0].context.after.every((row) => Buffer.byteLength(row.text, 'utf8') < 256 * 1024),
    'hit[0] after context must not include the giant skipped record',
  );

  // 2. Line 3's before context must NOT contain the giant line 2
  assert.ok(
    hits[1].context.before.every((row) => Buffer.byteLength(row.text, 'utf8') < 256 * 1024),
    'hit[1] before context must not include the giant skipped record',
  );

  // 3. Line 1 must not bleed into Line 3's before context (since context is 1 line, distance is 2 lines)
  assert.ok(
    hits[1].context.before.every((row) => !row.text.includes('target_alpha')),
    'hit[0] must not bleed into hit[1] context across the skipped record',
  );

  // Incomplete due to skipped giant record
  assert.equal(hits.complete, false);
  assert.ok(hits.partial.length > 0);
});

test('issue45: record budget enforces UTF-8 byte limit, not JS string length', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-utf8-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Korean characters: '가' is 1 JS char (UTF-16 code unit), but 3 UTF-8 bytes.
  // 100,000 '가' characters:
  //   JS length = 100,000 (< 256 * 1024 = 262,144)
  //   UTF-8 bytes = 300,000 (> 256 * 1024 = 262,144)
  // If the check used JS length, this would NOT be skipped.
  // Under UTF-8 byte cap, this MUST be skipped as oversized (>256KiB).
  const utf8Oversized = '가'.repeat(100000) + ' needle_utf8_oversized';
  assert.ok(utf8Oversized.length < 256 * 1024, 'JS length must be < 256KiB');
  assert.ok(Buffer.byteLength(utf8Oversized, 'utf8') > 256 * 1024, 'UTF-8 byte length must be > 256KiB');

  // Sub-cap ASCII line: 200,000 ASCII chars:
  //   JS length = 200,000 (< 256KiB)
  //   UTF-8 bytes = 200,000 (< 256KiB)
  //   In rg --json, total record is ~200.1 KiB (< 256KiB).
  // This line MUST be accepted as a normal hit.
  const asciiSubCap = 'a'.repeat(200000) + ' needle_ascii_subcap';
  assert.ok(Buffer.byteLength(asciiSubCap, 'utf8') < 256 * 1024, 'ASCII UTF-8 bytes must be < 256KiB');

  writeFileSync(path.join(dir, 'utf8.txt'), `${utf8Oversized}\n${asciiSubCap}\n`);

  const runner = createRunner();
  const hits = await runner.content({ path: dir, query: 'needle_' });

  // 1. Sub-cap ASCII line is accepted
  assert.ok(hits.some((h) => h.text.includes('needle_ascii_subcap')), 'sub-cap record must be accepted');

  // 2. Oversized UTF-8 line (which had JS length < 256K but UTF-8 bytes > 256K) must be skipped
  assert.ok(!hits.some((h) => h.text.includes('needle_utf8_oversized')), 'UTF-8 oversized record must be skipped');

  // 3. Completeness reflects skipped UTF-8 oversized record
  assert.equal(hits.complete, false, 'must be incomplete due to skipped UTF-8 oversized record');
  assert.ok(hits.partial.length > 0, 'must have partial warning for skipped UTF-8 oversized record');
});

test('issue45: guest execute integration handles oversized records and reports completeness', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-guest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const normalLine = 'regular needle result';
  const giantLine = 'x'.repeat(300 * 1024) + ' needle giant ' + 'y'.repeat(1024);
  writeFileSync(path.join(dir, 'file.txt'), `${normalLine}\n${giantLine}\n`);

  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cli = path.join(rootDir, 'bin', 'codemode.mjs');

  // Test guest search.content
  const contentCode = `return await search.content({ path: ${JSON.stringify(dir)}, query: 'needle' });`;
  const contentRun = JSON.parse(execFileSync(process.execPath, [cli, '--code', contentCode], {
    encoding: 'utf8',
    env: { ...process.env, CODEMODE_ROOTS: dir, CODEMODE_IGNORE_REPO_CONFIG: '1' },
  }));

  assert.equal(contentRun.ok, true, 'guest execution must not crash on oversized record');
  assert.equal(contentRun.result.complete, false, 'guest search result must report complete: false');
  assert.ok(
    Array.isArray(contentRun.result.partial) && contentRun.result.partial.length > 0,
    'guest search result must report partial warning',
  );
  assert.ok(
    contentRun.result.rows.some((row) => row.text.includes(normalLine)),
    'guest search result must recover normal matching rows',
  );

  // Test guest search.count
  const countCode = `return await search.count({ path: ${JSON.stringify(dir)}, query: 'needle' });`;
  const countRun = JSON.parse(execFileSync(process.execPath, [cli, '--code', countCode], {
    encoding: 'utf8',
    env: { ...process.env, CODEMODE_ROOTS: dir, CODEMODE_IGNORE_REPO_CONFIG: '1' },
  }));

  assert.equal(countRun.ok, true, 'guest count execution must not crash');
  assert.equal(countRun.result.complete, false, 'guest count must report complete: false for skipped huge rows');
  assert.ok(
    Array.isArray(countRun.result.partial) && countRun.result.partial.length > 0,
    'guest count must report partial warning',
  );
});


// ---------------------------------------------------------------------------
// Count aggregate MUST report truncated: true (issue #45)
// ---------------------------------------------------------------------------

test('issue45: count aggregate >4MiB must report truncated: true and complete: false', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-count-agg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Create ~6 MiB of matches spread across many records, each ~4 KiB.
  const lineSize = 4096;
  const numLines = 1500;
  const padding = 'c'.repeat(lineSize - 30);
  const lines = [];
  for (let i = 0; i < numLines; i++) {
    lines.push(`count_needle record ${String(i).padStart(6, '0')} ${padding}`);
  }
  writeFileSync(path.join(dir, 'many_count.txt'), lines.join('\n') + '\n');

  const runner = createRunner();
  const result = await runner.count({ path: dir, query: 'count_needle' });

  // When aggregate stdout exceeds 4MiB, count MUST report truncated: true and complete: false
  assert.equal(result.truncated, true, 'count aggregate >4MiB must report truncated: true');
  assert.equal(result.complete, false, 'count aggregate >4MiB must report complete: false');
  assert.ok(
    Array.isArray(result.partial) && result.partial.length > 0,
    'count must report partial warning on aggregate budget exceeded',
  );
});

// ---------------------------------------------------------------------------
// Low-level runStream exact byte caps & edge cases
// ---------------------------------------------------------------------------

test('issue45: low-level runStream exact byte caps on record and stdout', async () => {
  const script = `
    const rec100 = 'a'.repeat(100);
    const rec101 = 'b'.repeat(101);
    process.stdout.write(rec100 + '\\n');
    process.stdout.write(rec101 + '\\n');
    process.stdout.write('c'.repeat(50) + '\\n');
  `;
  const accepted = [];
  const discarded = [];
  const res = await runStream(process.execPath, ['-e', script], {
    maxRecordBytes: 100,
    maxStdoutBytes: 1000,
    onLine: (line) => {
      accepted.push(line);
      return true;
    },
    onDiscardRecord: (info) => {
      discarded.push(info);
    },
  });

  // rec100 (exactly 100 bytes) accepted
  assert.equal(accepted.length, 2);
  assert.equal(accepted[0], 'a'.repeat(100));
  assert.equal(accepted[1], 'c'.repeat(50));
  // rec101 (101 bytes) discarded
  assert.equal(discarded.length, 1);
  assert.equal(res.oversizedRecords, 1);
  assert.ok(res.warnings.some((w) => w.includes('record-budget-exceeded')));

  // Test stdout budget exact cap
  const stdoutScript = `
    for (let i = 0; i < 10; i++) {
      process.stdout.write('x'.repeat(40) + '\\n');
    }
  `;
  const resStdout = await runStream(process.execPath, ['-e', stdoutScript], {
    maxRecordBytes: 100,
    maxStdoutBytes: 100, // 100 bytes cap: should kill after ~2-3 lines of 41 bytes
    onLine: () => true,
  });

  assert.equal(resStdout.stdoutBudgetExceeded, true);
  assert.equal(resStdout.truncated, true);
  assert.ok(resStdout.totalStdoutBytes > 100);
  assert.ok(resStdout.warnings.some((w) => w.includes('stdout-budget-exceeded')));
});

test('issue45: low-level runStream giant unterminated record is discarded without unbound buffering', async () => {
  // Process outputs 500 bytes with NO newline / delimiter, then closes
  const script = `
    process.stdout.write('u'.repeat(500));
  `;
  const accepted = [];
  const discarded = [];
  const res = await runStream(process.execPath, ['-e', script], {
    maxRecordBytes: 100,
    maxStdoutBytes: 2000,
    onLine: (line) => {
      accepted.push(line);
      return true;
    },
    onDiscardRecord: (info) => {
      discarded.push(info);
    },
  });

  assert.equal(accepted.length, 0, 'unterminated oversized record must not be accepted');
  assert.equal(discarded.length, 1, 'unterminated oversized record must trigger onDiscardRecord');
  assert.equal(res.oversizedRecords, 1);
});

test('issue45: low-level runStream handles UTF-8 multi-byte split across chunks', async () => {
  // Korean '가' (0xEA 0xB0 0x80) split across two write calls
  const script = `
    process.stdout.write(Buffer.from([0xEA]));
    setTimeout(() => {
      process.stdout.write(Buffer.from([0xB0, 0x80, 0x0A]));
    }, 10);
  `;
  const accepted = [];
  const res = await runStream(process.execPath, ['-e', script], {
    maxRecordBytes: 100,
    onLine: (line) => {
      accepted.push(line);
      return true;
    },
  });

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0], '가', 'split UTF-8 bytes must reassemble correctly without replacement chars');
  assert.equal(res.oversizedRecords, 0);
});

test('issue45: low-level runStream preserves NUL-delimited records for files()', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-nul-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Create paths with spaces and check that NUL delimiter preserves them cleanly
  writeFileSync(path.join(dir, 'file one.txt'), 'content 1');
  writeFileSync(path.join(dir, 'file two.txt'), 'content 2');

  const runner = createRunner();
  const fileHits = await runner.files({ path: dir });

  assert.equal(fileHits.length, 2);
  assert.ok(fileHits.some((f) => f.includes('file one.txt')));
  assert.ok(fileHits.some((f) => f.includes('file two.txt')));
  assert.equal(fileHits.complete, true);
  assert.equal(fileHits.truncated, false);
});

// ---------------------------------------------------------------------------
// Context amplification regression at runner level (issue #45)
// ---------------------------------------------------------------------------

test('issue45: context amplification regression bounds serialized result to <= 8MiB', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-context-amp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // 150 matching lines, each ~2 KiB. With context: 150, uncontrolled duplication
  // yields 150 * 150 * 2 KiB ≈ 45 MiB of serialized JSON.
  const lineSize = 2048;
  const numLines = 150;
  const padding = 'c'.repeat(lineSize - 30);
  const lines = [];
  for (let i = 0; i < numLines; i++) {
    lines.push(`amp_target line ${String(i).padStart(4, '0')} ${padding}`);
  }
  writeFileSync(path.join(dir, 'amp.txt'), lines.join('\n') + '\n');

  const runner = createRunner();
  const hits = await runner.content({ path: dir, query: 'amp_target', context: 150, max: 500 });
  const serializedBytes = Buffer.byteLength(JSON.stringify(hits), 'utf8');

  // Must not exceed conservative 8 MiB serialized output
  assert.ok(
    serializedBytes <= 8 * 1024 * 1024,
    `serialized result must be <= 8MiB to prevent context amplification (got ${(serializedBytes / (1024 * 1024)).toFixed(2)} MiB)`,
  );

  // If budget was triggered, must be incomplete / partial
  if (serializedBytes >= 8 * 1024 * 1024 || hits.length < numLines) {
    assert.equal(hits.complete, false, 'budget-triggered search must report complete: false');
  }
});

// JSON escaping and empty-line object overhead must consume the retained budget,
// not only the unescaped text length. Check through the real worker transport.
test('issue45: repeated escaped and empty context remains bounded through the guest', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-budget-escaped-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'escaped.txt'), ('needle ' + '\\'.repeat(1024) + '\n').repeat(150));
  const runner = createRunner();
  const hits = await runner.content({path: dir, query: 'needle', context: 150});
  assert.equal(hits.complete, false);
  assert.equal(hits.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(hits)) < 4 * 1024 * 1024 + 4096);

  writeFileSync(path.join(dir, 'empty.txt'), '\n'.repeat(700));
  const empty = await runner.content({path: path.join(dir, 'empty.txt'), query: '^', context: 700, max: 1000});
  assert.equal(empty.complete, false);
  assert.ok(Buffer.byteLength(JSON.stringify(empty)) < 4 * 1024 * 1024 + 4096);
  const { runCode } = await import('../src/sandbox.js');
  const out = await runCode(`const r = await search.content({path: ${JSON.stringify(dir)}, query: 'needle', context: 150}); return {n:r.length,complete:r.complete,truncated:r.truncated,partial:r.partial};`, {
    globals: signal => ({search: createRunner({signal})}),
  });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.complete, false);
  assert.equal(out.result.truncated, true);
});
