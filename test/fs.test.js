// AC 5 — root-scoped fs: escape via .. and via symlink are refused; caps work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeRootGuard, RootEscapeError } from '../src/paths.js';
import { createFs } from '../src/host/fs.js';

function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'codemode-fs-'));
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
  return { root, outside };
}

test('write then read roundtrip inside the root', async () => {
  const { root } = fixture();
  const fs = createFs({ assertInside: makeRootGuard([root]) });
  await fs.write(path.join(root, 'a.txt'), 'alpha');
  assert.equal(await fs.read(path.join(root, 'a.txt')), 'alpha');
  const list = await fs.list(root);
  assert.deepEqual(list.map((e) => e.name), ['a.txt']);
});

test('reading outside the root via .. is refused', async () => {
  const { root, outside } = fixture();
  const fs = createFs({ assertInside: makeRootGuard([root]) });
  await assert.rejects(fs.read(path.join(root, '..', 'outside', 'secret.txt')), RootEscapeError);
  await assert.rejects(fs.read(path.join(outside, 'secret.txt')), RootEscapeError);
});

test('escape through a symlink is refused', async (t) => {
  const { root, outside } = fixture();
  try {
    symlinkSync(outside, path.join(root, 'link'), 'dir');
  } catch (e) {
    t.skip('cannot create symlink here: ' + e.message);
    return;
  }
  const fs = createFs({ assertInside: makeRootGuard([root]) });
  await assert.rejects(fs.read(path.join(root, 'link', 'secret.txt')), RootEscapeError);
});

test('read cap appends a truncation marker', async () => {
  const { root } = fixture();
  writeFileSync(path.join(root, 'big.txt'), 'z'.repeat(4096));
  const fs = createFs({ assertInside: makeRootGuard([root]) });
  const text = await fs.read(path.join(root, 'big.txt'), { maxBytes: 100 });
  assert.match(text, /truncated: 4096 bytes total/);
});

test('empty roots deny everything', async () => {
  const { root } = fixture();
  const guard = makeRootGuard([]);
  assert.throws(() => guard(root), RootEscapeError);
});
