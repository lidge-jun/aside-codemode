import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeRootGuard } from '../src/paths.js';
import { createFs } from '../src/host/fs.js';
import { createActions } from '../src/host/actions.js';
import { runCode } from '../src/sandbox.js';

function host() {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-grepfile-'));
  const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }) });
  return { root, fs };
}

test('max:1 on three hits is truncated and incomplete', async () => {
  const { fs } = host();
  await fs.write_file({ file_path: 'a.txt', content: 'hit\nhit\nhit\n' });
  const hits = await fs.grepFile('a.txt', 'hit', { max: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits.truncated, true);
  assert.equal(hits.complete, false);
  const wire = JSON.parse(JSON.stringify(hits));
  assert.equal(wire.truncated, true);
  assert.equal(wire.rows.length, 1);
});

test('max equal to hit count is complete', async () => {
  const { fs } = host();
  await fs.write_file({ file_path: 'a.txt', content: 'hit\nhit\nhit\n' });
  const hits = await fs.grepFile('a.txt', 'hit', { max: 3 });
  assert.equal(hits.length, 3);
  assert.equal(hits.truncated, false);
  assert.equal(hits.complete, true);
});

test('invalid max and context throw', async () => {
  const { fs } = host();
  await fs.write_file({ file_path: 'a.txt', content: 'hit\n' });
  await assert.rejects(() => fs.grepFile('a.txt', 'hit', { max: -1 }), /positive integer/);
  await assert.rejects(() => fs.grepFile('a.txt', 'hit', { max: 0 }), /positive integer/);
  await assert.rejects(() => fs.grepFile('a.txt', 'hit', { max: 1.5 }), /positive integer/);
  await assert.rejects(() => fs.grepFile('a.txt', 'hit', { max: Number.NaN }), /positive integer/);
  await assert.rejects(() => fs.grepFile('a.txt', 'hit', { context: -1 }), /non-negative/);
});

test('actions.check agrees with runtime on bad grepFile numbers', () => {
  const actions = createActions();
  const badMax = actions.check('fs.grepFile', { path: 'f.txt', pattern: 'a', max: -1 });
  assert.equal(badMax.ok, false);
  assert.ok(badMax.invalid.length >= 1);
  const badCtx = actions.check('fs.grepFile', { path: 'f.txt', pattern: 'a', context: -1 });
  assert.equal(badCtx.ok, false);
  assert.ok(badCtx.invalid.length >= 1);
  const good = actions.check('fs.grepFile', { path: 'f.txt', pattern: 'a', max: 1 });
  assert.equal(good.ok, true);
});

test('separated extra match after a gap still sets truncated', async () => {
  const { fs } = host();
  await fs.write_file({ file_path: 'a.txt', content: 'hit\ngap\nhit\n' });
  const hits = await fs.grepFile('a.txt', 'hit', { max: 1, context: 0 });
  assert.equal(hits.length, 1);
  assert.equal(hits.truncated, true);
  assert.equal(hits.complete, false);
});

test('guest runCode keeps grepFile envelope metadata', async () => {
  const { fs } = host();
  await fs.write_file({ file_path: 'a.txt', content: 'hit\nhit\nhit\n' });
  const out = await runCode(
    'const hits = await fs.grepFile("a.txt", "hit", { max: 1 }); return { n: hits.length, truncated: hits.truncated, complete: hits.complete };',
    { timeoutMs: 5000, globals: { fs }, maxResultBytes: 4096 },
  );
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.n, 1);
  assert.equal(out.result.truncated, true);
  assert.equal(out.result.complete, false);
});
