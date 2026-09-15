// Issue #24. ripgrep does not follow symlinks, which is the policy this tool wants, and it
// says nothing at all about the ones it stepped over. A directory of 37 entries where 35 are
// links returned 2 rows with complete: true, and no combination of noIgnore/hidden/
// includeExcluded could tell the caller otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRgRunner, createRgResolver } from '../src/rg.js';
import { restoreSearchResult } from '../src/search-result.js';

// Windows needs a privilege for this; where it is missing the whole question is moot.
function treeWithLinks() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'acm-links-'));
  const real = path.join(base, 'real');
  const scan = path.join(base, 'scan');
  mkdirSync(path.join(real, 'inner'), { recursive: true });
  mkdirSync(scan, { recursive: true });
  writeFileSync(path.join(real, 'inner', 'SKILL.md'), '# hidden behind a link\n');
  writeFileSync(path.join(scan, 'SKILL.md'), '# plainly here\n');
  try {
    symlinkSync(real, path.join(scan, 'linked-dir'), 'dir');
    symlinkSync(path.join(real, 'inner', 'SKILL.md'), path.join(scan, 'linked-file.md'));
  } catch (e) {
    rmSync(base, { recursive: true, force: true });
    return null;
  }
  return { base, scan };
}

const runner = () => createRgRunner(createRgResolver({}, process.env), { excludeGlobs: ['node_modules'] });

test('a search that stepped over links says so instead of reporting a clean sweep', async (t) => {
  const f = treeWithLinks();
  if (!f) return t.skip('this platform will not let the test create a symlink');
  t.after(() => rmSync(f.base, { recursive: true, force: true }));

  const res = await runner().files({ path: f.scan, glob: '**/*.md' });
  assert.equal(res.complete, false, 'links were skipped and the result still called itself complete');
  const skipped = res.scope.skippedSymlinks;
  assert.ok(skipped, 'nothing in scope describes what was skipped');
  assert.equal(skipped.dirs, 1);
  assert.equal(skipped.files, 1);
  assert.ok(skipped.examples.some((p) => p.includes('linked-dir')), JSON.stringify(skipped));
});

test('a tree without links is still a clean sweep', async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'acm-nolinks-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(path.join(base, 'a.md'), '# a\n');

  const res = await runner().files({ path: base, glob: '**/*.md' });
  assert.equal(res.complete, true);
  assert.equal(res.scope.skippedSymlinks.dirs, 0);
  assert.equal(res.scope.skippedSymlinks.files, 0);
});

test('the signal survives the trip through a guest RPC', async (t) => {
  const f = treeWithLinks();
  if (!f) return t.skip('this platform will not let the test create a symlink');
  t.after(() => rmSync(f.base, { recursive: true, force: true }));

  const res = await runner().files({ path: f.scan, glob: '**/*.md' });
  const overTheWire = JSON.parse(JSON.stringify(res));
  const restored = restoreSearchResult(overTheWire);
  assert.equal(restored.complete, false, 'the envelope lost the signal on the way back');
  assert.equal(restored.scope.skippedSymlinks.dirs, 1);
});

test('content search reports it too, not just the file listing', async (t) => {
  const f = treeWithLinks();
  if (!f) return t.skip('this platform will not let the test create a symlink');
  t.after(() => rmSync(f.base, { recursive: true, force: true }));

  const res = await runner().content({ query: 'here', path: f.scan });
  assert.equal(res.complete, false);
  assert.ok(res.scope.skippedSymlinks.dirs >= 1);
});
