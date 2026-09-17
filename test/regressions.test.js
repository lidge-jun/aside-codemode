// Regression tests for defects measured against a real tree on 2026-09-13.
// Every case here is a bug that shipped, was reproduced, and was fixed — the
// comments name the observed symptom so a future reader does not "simplify"
// the guard away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRgResolver, createRgRunner, RgNotFoundError } from '../src/rg.js';
import { createSearch } from '../src/host/search.js';
import { createFs } from '../src/host/fs.js';
import { makeRootGuard, RootConfigError } from '../src/paths.js';
import { loadConfig } from '../src/config.js';

const caps = { files: 5000, content: 500 };

function runner() {
  return createRgRunner(createRgResolver({}, process.env));
}

// A corpus with a .gitignore that hides a whole subdirectory, mirroring the
// real failure: a parent .gitignore listed an entire project dir, so a
// repo-wide search silently lost most of the matching files, including that
// project's own README.
function ignoredCorpus() {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-ign-'));
  // ripgrep only honours .gitignore INSIDE a git repository, so the fixture
  // needs a .git dir to reproduce the real-world exclusion at all.
  mkdirSync(path.join(dir, '.git'));
  writeFileSync(path.join(dir, '.gitignore'), 'hidden-project/\n');
  writeFileSync(path.join(dir, 'visible.md'), 'needle-token here\n');
  mkdirSync(path.join(dir, 'hidden-project'));
  writeFileSync(path.join(dir, 'hidden-project', 'README.md'), 'needle-token here\n');
  return dir;
}

function bigCorpus(n) {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-big-'));
  for (let i = 0; i < n; i += 1) {
    writeFileSync(path.join(dir, `f${i}.txt`), 'needle-token\nneedle-token\nneedle-token\n');
  }
  return dir;
}

test('gitignored files are excluded by default but recoverable with noIgnore', async () => {
  const dir = ignoredCorpus();
  const search = createSearch({ rgRunner: runner(), assertInside: makeRootGuard([dir]), caps });

  const def = await search.content({ query: 'needle-token', path: dir });
  assert.equal(def.length, 1, 'default search must respect .gitignore');

  const all = await search.content({ query: 'needle-token', path: dir, noIgnore: true });
  assert.equal(all.length, 2, 'noIgnore must recover the ignored file');
  assert.ok(all.some((h) => h.file.endsWith('README.md')));
});

test('search.count sizes a search and exposes the ignore gap without pulling rows', async () => {
  const dir = ignoredCorpus();
  const search = createSearch({ rgRunner: runner(), assertInside: makeRootGuard([dir]), caps });
  const def = await search.count({ query: 'needle-token', path: dir });
  const all = await search.count({ query: 'needle-token', path: dir, noIgnore: true });
  assert.equal(def.files, 1);
  assert.equal(all.files, 2);
  assert.ok(all.matches > def.matches);
});

test('files max is a real bound: a large tree does not blow the stdout buffer', async () => {
  // Before: search.files({max:10}) on a big tree died with
  // "stdout maxBuffer length exceeded" because execFile buffered ALL output
  // before `max` was ever applied.
  const dir = bigCorpus(400);
  const search = createSearch({ rgRunner: runner(), assertInside: makeRootGuard([dir]), caps });
  const out = await search.files({ path: dir, max: 10 });
  assert.equal(out.length, 10);
  assert.equal(out.truncated, true);
});

test('content max is a GLOBAL row cap, not ripgrep per-file --max-count', async () => {
  // Before: `max` was passed to --max-count, which is per FILE. With 5 files
  // and max:3 the caller got up to 15 rows.
  const dir = bigCorpus(5);
  const search = createSearch({ rgRunner: runner(), assertInside: makeRootGuard([dir]), caps });
  const hits = await search.content({ query: 'needle-token', path: dir, max: 3 });
  assert.equal(hits.length, 3);
  assert.equal(hits.truncated, true);
});

test('unknown search options are rejected, never silently ignored', async () => {
  // Before: passing noIgnore to a build that did not support it returned the
  // same filtered result set with no signal that the option did nothing.
  const dir = ignoredCorpus();
  const search = createSearch({ rgRunner: runner(), assertInside: makeRootGuard([dir]), caps });
  await assert.rejects(
    () => search.content({ query: 'x', path: dir, bogusOption: 1 }),
    (e) => e.code === 'EBADOPT' && /bogusOption/.test(e.message) && /valid:/.test(e.message),
  );
  await assert.rejects(
    () => search.files({ path: dir, nope: true }),
    (e) => e.code === 'EBADOPT',
  );
});

test('a root from another OS fails with a structured, actionable error', async () => {
  // Before: the committed config carried Windows roots; on macOS the CLI died
  // with a raw realpath ENOENT stack trace before running any user code.
  assert.throws(
    () => makeRootGuard(['C:\\Users\\someone\\.aside']),
    (e) => e instanceof RootConfigError
      && e.code === 'EROOTCFG'
      && /codemode\.config\.json/.test(e.message),
  );
});

test('rgPath: null can clear an inherited rgPath', () => {
  // Before: config merge only accepted `typeof rgPath === "string"`, so a
  // later config could never undo an earlier "bin/rg.exe" — on macOS that
  // surfaced as spawn EACCES.
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cfg-'));
  const base = path.join(dir, 'base.json');
  const over = path.join(dir, 'over.json');
  writeFileSync(base, JSON.stringify({ roots: [dir], rgPath: 'bin/rg.exe' }));
  writeFileSync(over, JSON.stringify({ roots: [dir], rgPath: null }));
  const cfg = loadConfig(['--config', over], { CODEMODE_CONFIG: base });
  assert.equal(cfg.rgPath, null);
});

test('a windows-absolute root is reported verbatim, not joined onto cwd', () => {
  const cfg = loadConfig([], { CODEMODE_ROOTS: 'C:\\Users\\someone\\Developers' });
  assert.equal(cfg.roots[0], 'C:\\Users\\someone\\Developers');
});

test('a vendored .exe rgPath is not authoritative on a non-windows host', async () => {
  // A fresh clone ships bin/rg.exe and a config pointing at it. On macOS that
  // must fall through to the PATH ladder instead of hard-failing EACCES.
  if (process.platform === 'win32') return;
  const resolve = createRgResolver({ rgPath: 'bin/rg.exe' }, process.env);
  const resolved = await resolve();
  assert.ok(resolved && !resolved.endsWith('.exe'));
});

test('an explicit non-exe bogus rgPath is still a structured error', async () => {
  const resolve = createRgResolver({ rgPath: path.join(tmpdir(), 'definitely-not-rg') }, {});
  await assert.rejects(resolve(), RgNotFoundError);
});

test('fs.read truncation names kept bytes, total bytes and the way out', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-fs-'));
  writeFileSync(path.join(dir, 'big.txt'), 'z'.repeat(5000));
  const fs = createFs({ assertInside: makeRootGuard([dir]) });
  const text = await fs.read(path.join(dir, 'big.txt'), { maxBytes: 64 });
  assert.match(text, /\[truncated: kept 64 of 5000 bytes/);
});

test('fs.readMany returns per-file errors inline instead of failing the batch', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-fs-'));
  writeFileSync(path.join(dir, 'ok.txt'), 'hello');
  const fs = createFs({ assertInside: makeRootGuard([dir]) });
  const rows = await fs.readMany([path.join(dir, 'ok.txt'), '/etc/passwd', path.join(dir, 'nope.txt')]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].text, 'hello');
  assert.ok(rows[1].error, 'out-of-root path must error inline');
  assert.ok(rows[2].error, 'missing file must error inline');
});

test('fs.readMany honours the shared total byte budget', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-fs-'));
  const paths = [];
  for (let i = 0; i < 5; i += 1) {
    const p = path.join(dir, `f${i}.txt`);
    writeFileSync(p, 'x'.repeat(500));
    paths.push(p);
  }
  const fs = createFs({ assertInside: makeRootGuard([dir]) });
  const rows = await fs.readMany(paths, { maxBytes: 400, totalBytes: 800 });
  assert.ok(rows.some((r) => r.skipped), 'budget exhaustion must be reported, not silent');
});

test('fs.grepFile returns only matching lines with context', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-fs-'));
  writeFileSync(path.join(dir, 'doc.md'), ['# One', 'filler', '## Two', 'filler', '## Three'].join('\n'));
  const fs = createFs({ assertInside: makeRootGuard([dir]) });
  const hits = await fs.grepFile(path.join(dir, 'doc.md'), '^## ', { context: 1 });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].line, 3);
  assert.match(hits[0].context, /filler/);
});

test('fs.exists never throws on an out-of-root path', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-fs-'));
  const fs = createFs({ assertInside: makeRootGuard([dir]) });
  assert.equal(await fs.exists('/etc/passwd'), false);
  assert.equal(await fs.exists(path.join(dir, 'nope')), false);
});

test('recursive fs.list walks to depth and caps entries', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-fs-'));
  mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  writeFileSync(path.join(dir, 'a', 'x.txt'), '1');
  writeFileSync(path.join(dir, 'a', 'b', 'y.txt'), '2');
  const fs = createFs({ assertInside: makeRootGuard([dir]) });
  const rows = await fs.list(dir, { recursive: true, depth: 3 });
  const names = rows.map((r) => r.name);
  assert.ok(names.includes('a/x.txt'));
  assert.ok(names.includes('a/b/y.txt'));
  const capped = await fs.list(dir, { recursive: true, max: 2 });
  assert.equal(capped.length, 2);
});

test('a soft rg error (unreadable dir) returns rows with a partial warning', async () => {
  // rg exits 2 for BOTH a bad regex and a single unreadable file. Failing the
  // whole call on exit 2 threw away good results because of one permission.
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-perm-'));
  writeFileSync(path.join(dir, 'ok.txt'), 'needle-token\n');
  const locked = path.join(dir, 'locked');
  mkdirSync(locked);
  writeFileSync(path.join(locked, 'inner.txt'), 'needle-token\n');
  const { chmodSync } = await import('node:fs');
  chmodSync(locked, 0o000);
  try {
    const search = createSearch({ rgRunner: runner(), assertInside: makeRootGuard([dir]), caps });
    const hits = await search.content({ query: 'needle-token', path: dir });
    assert.equal(hits.length, 1, 'readable results must survive');
    assert.ok(Array.isArray(hits.partial), 'incomplete traversal must be reported');
    assert.match(hits.partial.join(' '), /Permission denied/i);
  } finally {
    chmodSync(locked, 0o755);
  }
});

test('a fatal rg error still fails, and names the cause', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-badre-'));
  writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  const search = createSearch({ rgRunner: runner(), assertInside: makeRootGuard([dir]), caps });
  await assert.rejects(
    () => search.content({ query: '[unclosed', path: dir }),
    (e) => /regex parse error/i.test(e.message),
  );
});

test('fixedStrings makes a regex metacharacter query literal', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-lit-'));
  writeFileSync(path.join(dir, 'a.txt'), 'cost is $5 (approx)\n');
  const search = createSearch({ rgRunner: runner(), assertInside: makeRootGuard([dir]), caps });
  const hits = await search.content({ query: '$5 (approx)', path: dir, fixedStrings: true });
  assert.equal(hits.length, 1);
});

test('user ripgrep config cannot change results (--no-config)', async () => {
  // A user's RIPGREP_CONFIG_PATH could otherwise flip ignore rules or output
  // mode underneath the wrapper and make results irreproducible.
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cfg-rg-'));
  writeFileSync(path.join(dir, 'a.txt'), 'needle-token\n');
  const rc = path.join(dir, 'rgrc');
  writeFileSync(rc, '--files-with-matches\n');
  const rgRunner = createRgRunner(createRgResolver({}, { ...process.env, RIPGREP_CONFIG_PATH: rc }));
  const search = createSearch({ rgRunner, assertInside: makeRootGuard([dir]), caps });
  const hits = await search.content({ query: 'needle-token', path: dir });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1, 'line numbers prove --json survived the user config');
});

test('excludeGlobs prunes heavy dirs by default and includeExcluded opts back in', async () => {
  // How much a home directory's heavy trees cost is a property of that machine, so the
  // numbers live in evidence/exclude-pruning-260918.md and are reproducible with
  // scripts/measure-excludes.mjs. An earlier copy of them here disagreed with that note,
  // which is the drift the note exists to stop. What this test pins is the rule: the
  // pruning must be reversible per call, or it becomes an invisible second blind spot on
  // top of .gitignore.
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-excl-'));
  mkdirSync(path.join(dir, 'Library'));
  writeFileSync(path.join(dir, 'Library', 'cache.md'), 'needle-token\n');
  writeFileSync(path.join(dir, 'real.md'), 'needle-token\n');

  const pruned = createRgRunner(createRgResolver({}, process.env), { excludeGlobs: ['Library'] });
  const search = createSearch({ rgRunner: pruned, assertInside: makeRootGuard([dir]), caps });

  const def = await search.content({ query: 'needle-token', path: dir });
  assert.equal(def.length, 1, 'excluded dir must be pruned by default');
  assert.ok(def[0].file.endsWith('real.md'));

  const all = await search.content({ query: 'needle-token', path: dir, includeExcluded: true });
  assert.equal(all.length, 2, 'includeExcluded must restore the pruned dir');

  const files = await search.files({ path: dir, includeExcluded: true });
  assert.ok(files.some((f) => f.includes('Library')));
});

test('excludeGlobs is configurable and can be emptied', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cfg-ex-'));
  const cfgPath = path.join(dir, 'c.json');
  writeFileSync(cfgPath, JSON.stringify({ roots: [dir], excludeGlobs: [] }));
  const cfg = loadConfig(['--config', cfgPath], {});
  assert.deepEqual(cfg.excludeGlobs, [], 'an explicit empty list must disable pruning');

  const viaEnv = loadConfig([], { CODEMODE_EXCLUDES: 'Library, node_modules' });
  assert.deepEqual(viaEnv.excludeGlobs, ['Library', 'node_modules']);

  const defaults = loadConfig([], {});
  assert.ok(defaults.excludeGlobs.includes('Library'), 'Library is pruned by default');
});
