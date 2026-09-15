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

// Creating a symlink needs a privilege on Windows. Where the test cannot create one it skips,
// which means this signal is proven on the unix runners and NOT on Windows - the runtime there
// still steps over junctions and existing links the same way, it is only the fixture we cannot
// build.
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

// The measured failure of the first attempt: a repository with three symlinked bin stubs was
// reported incomplete on every search. A file link cannot hide a subtree, so it is counted and
// reported without touching the flag.
test('a file link is reported but does not make the search incomplete', async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'acm-filelink-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(path.join(base, 'real.md'), '# real\n');
  try {
    symlinkSync(path.join(base, 'real.md'), path.join(base, 'stub.md'));
  } catch { return t.skip('this platform will not let the test create a symlink'); }

  const res = await runner().files({ path: base, glob: '**/*.md' });
  assert.equal(res.scope.skippedSymlinks.files, 1, 'the link should still be counted');
  assert.equal(res.scope.skippedSymlinks.dirs, 0);
  assert.equal(res.complete, true, 'a bin stub is not a hidden subtree');
});

test('a link the search already excludes is not reported as skipped', async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'acm-exclink-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(path.join(base, 'target'), { recursive: true });
  writeFileSync(path.join(base, 'keep.md'), '# keep\n');
  try {
    symlinkSync(path.join(base, 'target'), path.join(base, 'node_modules'), 'dir');
  } catch { return t.skip('this platform will not let the test create a symlink'); }

  const res = await runner().files({ path: base, glob: '**/*.md' });
  assert.equal(res.scope.skippedSymlinks.dirs, 0, 'an excluded directory was never going to be searched');
  assert.equal(res.complete, true);
});

test('a glob in excludeGlobs is honoured the way the search honours it', async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'acm-globlink-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(path.join(base, 'real.log'), 'x\n');
  try {
    symlinkSync(path.join(base, 'real.log'), path.join(base, 'stub.log'));
  } catch { return t.skip('this platform will not let the test create a symlink'); }

  const withGlob = createRgRunner(createRgResolver({}, process.env), { excludeGlobs: ['*.log'] });
  const res = await withGlob.files({ path: base });
  assert.equal(res.scope.skippedSymlinks.files, 0, 'the search excluded it, so it was not skipped by the link policy');
});

// The count is bounded on purpose, and a bound that quietly closed the census would be worse
// than no count at all. Capping says so and does not claim the search was incomplete.
test('a capped census says it stopped early rather than guessing', async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'acm-cap-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (let i = 0; i < 40; i++) writeFileSync(path.join(base, 'f' + i + '.md'), 'x\n');

  const { scanSkippedSymlinks } = await import('../src/symlink-scan.js');
  const scan = await scanSkippedSymlinks(base, { maxEntries: 10 });
  assert.equal(scan.capped, true);
  assert.ok(scan.scanned <= 10 + 1);
});
