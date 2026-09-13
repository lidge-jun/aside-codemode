// Search completeness + root policy regressions (plan 020_search.md).
// Every case below is a defect reproduced against d1fa638 on 2026-09-13:
//   - truncated/partial metadata vanished through JSON.stringify
//   - rg -C context events were parsed and thrown away
//   - search.count threw on a soft (unreadable path) rg exit 2
//   - termination by signal resolved as a clean, complete result
//   - followSymlinks:true walked outside the configured roots
//   - max/context/timeoutMs accepted NaN, 0, negatives and fractions
//   - includeExcluded existed in execution but not in the actions catalog
//   - a '/' root rejected every path because of a `root + sep` prefix test
//   - --files split on '\n', so an unusual filename could be mangled
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRgResolver, createRgRunner } from '../src/rg.js';
import { runStream } from '../src/rg-stream.js';
import { createSearch } from '../src/host/search.js';
import { createActions } from '../src/host/actions.js';
import { makeRootGuard } from '../src/paths.js';
import { decorateSearchResult, restoreSearchResult, isSearchEnvelope } from '../src/search-result.js';
import { CONTENT_OPTS, FILES_OPTS, COUNT_OPTS } from '../src/search-schema.js';

const caps = { files: 5000, content: 500 };

function runner(opts) {
  return createRgRunner(createRgResolver({}, process.env), opts);
}

function searchOn(dir, opts) {
  return createSearch({ rgRunner: runner(opts), assertInside: makeRootGuard([dir]), caps });
}

// Exactly three matching lines in one file: lets a single fixture prove
// max < hits, max === hits and max > hits without re-counting.
function threeHitCorpus() {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-hard-'));
  writeFileSync(path.join(dir, 'a.txt'), 'needle-hit\nneedle-hit\nneedle-hit\n');
  return dir;
}

test('a truncated array still carries truncated/complete through direct JSON', async () => {
  const dir = threeHitCorpus();
  const hits = await searchOn(dir).content({ query: 'needle-hit', path: dir, max: 1 });

  assert.equal(hits.length, 1, 'array ergonomics: length still projects the rows');
  assert.equal(hits.truncated, true);
  assert.equal(hits.complete, false);

  const wire = JSON.parse(JSON.stringify(hits));
  assert.equal(Array.isArray(wire.rows), true);
  assert.equal(wire.rows.length, 1);
  assert.equal(wire.truncated, true);
  assert.equal(wire.complete, false);
  assert.deepEqual(wire.partial, []);
  assert.equal(wire.scope.path, realpathSync(dir));
});

test('metadata survives a nested return value, not only a top-level one', async () => {
  const dir = threeHitCorpus();
  const hits = await searchOn(dir).content({ query: 'needle-hit', path: dir, max: 1 });
  const wire = JSON.parse(JSON.stringify({ answer: 'x', evidence: hits }));
  assert.equal(wire.evidence.truncated, true);
  assert.equal(wire.evidence.rows.length, 1);
});

test('a complete search reports complete true and truncated false', async () => {
  const dir = threeHitCorpus();
  const search = searchOn(dir);

  const all = await search.content({ query: 'needle-hit', path: dir });
  assert.equal(all.length, 3);
  assert.equal(all.truncated, false);
  assert.equal(all.complete, true);

  const none = await search.content({ query: 'no-such-token-anywhere', path: dir });
  assert.equal(none.length, 0);
  assert.equal(none.complete, true, 'an honest empty result is complete, not unknown');
  assert.equal(JSON.parse(JSON.stringify(none)).complete, true);
});

test('max === hits is NOT truncated; max < hits is', async () => {
  const dir = threeHitCorpus();
  const search = searchOn(dir);

  const exact = await search.content({ query: 'needle-hit', path: dir, max: 3 });
  assert.equal(exact.length, 3);
  assert.equal(exact.truncated, false, 'exactly max rows with nothing left is a complete answer');
  assert.equal(exact.complete, true);

  const over = await search.content({ query: 'needle-hit', path: dir, max: 2 });
  assert.equal(over.length, 2);
  assert.equal(over.truncated, true);

  const under = await search.content({ query: 'needle-hit', path: dir, max: 10 });
  assert.equal(under.length, 3);
  assert.equal(under.truncated, false);
});

test('files max === file count is not reported as truncated', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-hard-files-'));
  writeFileSync(path.join(dir, 'one.txt'), '1');
  writeFileSync(path.join(dir, 'two.txt'), '2');
  const search = searchOn(dir);
  const exact = await search.files({ path: dir, max: 2 });
  assert.equal(exact.length, 2);
  assert.equal(exact.truncated, false);
  assert.equal(exact.complete, true);
  const cut = await search.files({ path: dir, max: 1 });
  assert.equal(cut.length, 1);
  assert.equal(cut.truncated, true);
});

test('context:1 keeps the real rg context events on the hit', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-ctx-'));
  writeFileSync(path.join(dir, 'ctx.txt'), 'before-line\nneedle-hit\nafter-line\n');
  const hits = await searchOn(dir).content({ query: 'needle-hit', path: dir, context: 1 });

  assert.equal(hits.length, 1, 'context lines must not be counted as matches');
  const [hit] = hits;
  assert.equal(hit.line, 2);
  assert.ok(hit.context, 'context must be represented on the hit');
  assert.deepEqual(hit.context.before.map((c) => c.text), ['before-line']);
  assert.deepEqual(hit.context.after.map((c) => c.text), ['after-line']);
  assert.deepEqual(hit.context.before.map((c) => c.line), [1]);
  assert.deepEqual(hit.context.after.map((c) => c.line), [3]);

  const wire = JSON.parse(JSON.stringify(hits));
  assert.equal(wire.rows[0].context.after[0].text, 'after-line');
  assert.equal(wire.scope.context, 1);
});

test('context lines do not consume the max budget', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-ctx2-'));
  writeFileSync(path.join(dir, 'ctx.txt'), 'pad\nneedle-hit\npad\npad\nneedle-hit\npad\n');
  const hits = await searchOn(dir).content({ query: 'needle-hit', path: dir, context: 1, max: 2 });
  assert.equal(hits.length, 2);
  assert.equal(hits.truncated, false);
});

test('search.count keeps {matches,files} deep-equal and adds non-enumerable state', async () => {
  const dir = threeHitCorpus();
  const c = await searchOn(dir).count({ query: 'needle-hit', path: dir });
  assert.deepEqual(c, { matches: 3, files: 1 }, 'the original count contract must not grow enumerable keys');
  assert.equal(c.complete, true);
  assert.equal(c.truncated, false);
  assert.deepEqual(c.partial, []);
  assert.equal(c.scope.kind, 'count');

  const wire = JSON.parse(JSON.stringify(c));
  assert.equal(wire.matches, 3);
  assert.equal(wire.files, 1);
  assert.equal(wire.complete, true);
  assert.deepEqual(wire.partial, []);
});

test('an unreadable path makes count partial, never a silently complete number', async () => {
  // Before: count ran with max=MAX_SAFE_INTEGER and counted nothing toward
  // `accepted`, so rg's soft exit 2 (one unreadable dir) threw the whole call
  // away — and the caller could not tell a permission problem from a bad regex.
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cnt-perm-'));
  writeFileSync(path.join(dir, 'ok.txt'), 'needle-hit\n');
  const locked = path.join(dir, 'locked');
  mkdirSync(locked);
  writeFileSync(path.join(locked, 'inner.txt'), 'needle-hit\n');
  chmodSync(locked, 0o000);
  try {
    const c = await searchOn(dir).count({ query: 'needle-hit', path: dir });
    assert.equal(c.matches, 1, 'readable matches must survive');
    assert.ok(Array.isArray(c.partial) && c.partial.length > 0, 'the unreadable path must be reported');
    assert.match(c.partial.join(' '), /Permission denied/i);
    assert.equal(c.complete, false, 'a partial traversal is not a complete count');
    assert.equal(JSON.parse(JSON.stringify(c)).complete, false);
  } finally {
    chmodSync(locked, 0o755);
  }
});

test('content rows stay complete:false when the traversal was partial', async () => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-row-perm-'));
  writeFileSync(path.join(dir, 'ok.txt'), 'needle-hit\n');
  const locked = path.join(dir, 'locked');
  mkdirSync(locked);
  writeFileSync(path.join(locked, 'inner.txt'), 'needle-hit\n');
  chmodSync(locked, 0o000);
  try {
    const hits = await searchOn(dir).content({ query: 'needle-hit', path: dir });
    assert.equal(hits.length, 1);
    assert.equal(hits.complete, false);
    const wire = JSON.parse(JSON.stringify(hits));
    assert.equal(wire.complete, false);
    assert.ok(wire.partial.length > 0, 'partial must survive serialization, not only live objects');
  } finally {
    chmodSync(locked, 0o755);
  }
});

test('termination by signal is not reported as a complete search', async () => {
  // Before: child "close" with code === null (killed) took the same success
  // branch as exit 0, so an externally killed rg returned whatever rows it had
  // as a clean, complete answer.
  if (process.platform === 'win32') return;
  const withRows = await runStream('/bin/sh', ['-c', 'printf "row-one\\n"; kill -TERM $$'], {
    max: 100,
    onLine: () => true,
  });
  assert.equal(withRows.killedBySignal, 'SIGTERM');
  assert.equal(withRows.truncated, false, 'an external kill is not our own max-cap kill');
  assert.equal(withRows.accepted, 1);

  await assert.rejects(
    () => runStream('/bin/sh', ['-c', 'kill -TERM $$'], { max: 100, onLine: () => true }),
    (e) => /signal/i.test(e.message) && e.code === 'ERGFAIL',
    'a signal with nothing to show must not look like a clean zero',
  );
});

test('followSymlinks:true is rejected before the resolver or rg ever runs', async () => {
  const outside = mkdtempSync(path.join(tmpdir(), 'codemode-outside-'));
  writeFileSync(path.join(outside, 'secret.txt'), 'SENTINEL-OUTSIDE-ROOT\n');
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-root-'));
  writeFileSync(path.join(root, 'inside.txt'), 'plain\n');
  symlinkSync(outside, path.join(root, 'link'));

  const neverRuns = async () => {
    throw new Error('resolver must not be reached for a rejected option');
  };
  const guarded = createSearch({
    rgRunner: createRgRunner(neverRuns),
    assertInside: makeRootGuard([root]),
    caps,
  });
  for (const call of [
    () => guarded.content({ query: 'SENTINEL-OUTSIDE-ROOT', path: root, followSymlinks: true }),
    () => guarded.files({ path: root, followSymlinks: true }),
    () => guarded.count({ query: 'SENTINEL-OUTSIDE-ROOT', path: root, followSymlinks: true }),
  ]) {
    await assert.rejects(call, (e) => e.code === 'ENOTSUP' && /followSymlinks/.test(e.message));
  }

  // followSymlinks:false stays a supported, working option.
  const real = searchOn(root);
  const ok = await real.content({ query: 'SENTINEL-OUTSIDE-ROOT', path: root, followSymlinks: false });
  assert.deepEqual([...ok], [], 'the default walk must not read through the symlink');
  const files = await real.files({ path: root, followSymlinks: false });
  assert.ok(files.some((f) => f.endsWith('inside.txt')));
});

test('max/context/timeoutMs reject NaN, zero, negative and fractional values', async () => {
  const dir = threeHitCorpus();
  const search = searchOn(dir);
  const bad = [
    { query: 'needle-hit', path: dir, max: 0 },
    { query: 'needle-hit', path: dir, max: -3 },
    { query: 'needle-hit', path: dir, max: Number.NaN },
    { query: 'needle-hit', path: dir, max: 2.5 },
    { query: 'needle-hit', path: dir, max: Infinity },
    { query: 'needle-hit', path: dir, context: -1 },
    { query: 'needle-hit', path: dir, context: 1.5 },
    { query: 'needle-hit', path: dir, timeoutMs: 0 },
    { query: 'needle-hit', path: dir, timeoutMs: Number.NaN },
    { query: 'needle-hit', path: dir, maxFilesize: 'huge' },
    { query: 'needle-hit', path: dir, ignoreCase: 'yes' },
  ];
  for (const opts of bad) {
    await assert.rejects(
      () => search.content(opts),
      (e) => e.code === 'EBADVAL',
      `must reject ${JSON.stringify(opts)}`,
    );
  }
  // and the valid forms still work
  const ok = await search.content({ query: 'needle-hit', path: dir, max: 2, context: 0, timeoutMs: 15000 });
  assert.equal(ok.length, 2);
});

test('the actions catalog and the executed schema are the same option set', () => {
  const actions = createActions();
  const pairs = [
    ['search.files', FILES_OPTS],
    ['search.content', CONTENT_OPTS],
    ['search.count', COUNT_OPTS],
  ];
  for (const [name, opts] of pairs) {
    const inputs = Object.keys(actions.describe(name).inputs).sort();
    assert.deepEqual(inputs, [...opts].sort(), `${name} catalog must match the executed schema`);
    assert.ok(inputs.includes('includeExcluded'), `${name} must document includeExcluded`);
  }
});

test('actions.check accepts includeExcluded and rejects what execution rejects', async () => {
  const actions = createActions();
  assert.equal(actions.check('search.content', { query: 'x', path: 'y', includeExcluded: true }).ok, true);
  assert.equal(actions.check('search.files', { path: 'y', includeExcluded: true }).ok, true);

  const follow = actions.check('search.content', { query: 'x', path: 'y', followSymlinks: true });
  assert.equal(follow.ok, false);
  assert.deepEqual(follow.invalid.map((i) => i.name), ['followSymlinks']);
  assert.equal(follow.invalid[0].code, 'ENOTSUP');

  const badMax = actions.check('search.content', { query: 'x', path: 'y', max: 0 });
  assert.equal(badMax.ok, false);
  assert.deepEqual(badMax.invalid.map((i) => i.name), ['max']);

  // the same inputs must fail at execution, so check is not a softer oracle
  const dir = threeHitCorpus();
  const search = searchOn(dir);
  await assert.rejects(() => search.content({ query: 'x', path: dir, followSymlinks: true }), (e) => e.code === 'ENOTSUP');
  await assert.rejects(() => search.content({ query: 'x', path: dir, max: 0 }), (e) => e.code === 'EBADVAL');
  assert.equal((await search.content({ query: 'needle-hit', path: dir, includeExcluded: true })).length, 3);
});

test('scope reports the effective ignore/hidden/exclude/path policy', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-scope-'));
  mkdirSync(path.join(dir, 'Library'));
  writeFileSync(path.join(dir, 'Library', 'cached.md'), 'needle-hit\n');
  writeFileSync(path.join(dir, 'real.md'), 'needle-hit\n');
  const search = searchOn(dir, { excludeGlobs: ['Library'] });

  const pruned = await search.content({ query: 'needle-hit', path: dir });
  assert.equal(pruned.length, 1);
  assert.deepEqual(pruned.scope.excludeGlobs, ['Library']);
  assert.equal(pruned.scope.includeExcluded, false);
  assert.equal(pruned.scope.noIgnore, false);
  assert.equal(pruned.scope.hidden, false);
  assert.equal(pruned.scope.followSymlinks, false);
  assert.equal(pruned.scope.path, realpathSync(dir));

  const opened = await search.content({ query: 'needle-hit', path: dir, includeExcluded: true, noIgnore: true, hidden: true });
  assert.equal(opened.length, 2);
  assert.deepEqual(opened.scope.excludeGlobs, [], 'includeExcluded means no pruning is in effect');
  assert.equal(opened.scope.includeExcluded, true);
  assert.equal(opened.scope.noIgnore, true);
  assert.equal(opened.scope.hidden, true);
});

test("a '/' root accepts /tmp instead of rejecting every path", () => {
  // Before: the prefix test was `target.startsWith(root + path.sep)`, which for
  // root '/' compared against '//' and refused everything.
  const guard = makeRootGuard(['/']);
  const resolved = guard('/tmp');
  assert.equal(resolved, realpathSync.native ? realpathSync.native('/tmp') : realpathSync('/tmp'));
  assert.equal(guard('/'), '/');
  const nested = mkdtempSync(path.join(tmpdir(), 'codemode-slash-'));
  assert.equal(guard(nested), realpathSync(nested));
});

test('a sibling directory sharing a root prefix is still outside the root', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'codemode-sib-'));
  const root = path.join(base, 'proj');
  const sibling = path.join(base, 'proj-evil');
  mkdirSync(root);
  mkdirSync(sibling);
  writeFileSync(path.join(sibling, 'x.txt'), 'x');
  const guard = makeRootGuard([root]);
  assert.throws(() => guard(path.join(sibling, 'x.txt')), (e) => e.code === 'EROOT');
});

test('unusual filenames are returned, not silently skipped', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-names-'));
  const names = ['a b.txt', "we'ird[1]$x.txt", '한글 파일.txt', 'tab\tname.txt', 'new\nline.txt'];
  const created = [];
  for (const n of names) {
    try {
      writeFileSync(path.join(dir, n), 'x\n');
      created.push(n);
    } catch {
      // a filesystem may legitimately refuse a byte; only assert on what exists
    }
  }
  assert.ok(created.length >= 4, 'fixture must exercise several unusual names');
  const files = await searchOn(dir).files({ path: dir });
  const bases = files.map((f) => path.posix.basename(f.split('/').pop() ?? f));
  for (const n of created) {
    assert.ok(files.some((f) => f.endsWith(n)), `missing ${JSON.stringify(n)} (got ${JSON.stringify(bases)})`);
  }
  assert.equal(files.length, created.length);
  assert.equal(files.complete, true);
});

test('decorateSearchResult keeps array ergonomics and count identity', () => {
  const rows = decorateSearchResult(['a', 'b'], { truncated: true, partial: ['x'], scope: { kind: 'files' } });
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.toUpperCase()), ['A', 'B']);
  assert.deepEqual(rows.filter((r) => r === 'a'), ['a']);
  assert.deepEqual([...rows], ['a', 'b']);
  assert.deepEqual(Object.keys(rows), ['0', '1'], 'metadata must stay non-enumerable');
  assert.equal(rows.complete, false, 'truncated or partial means not complete');

  const count = decorateSearchResult({ matches: 2, files: 1 }, { scope: { kind: 'count' } });
  assert.deepEqual(count, { matches: 2, files: 1 });
  assert.equal(count.complete, true);
  assert.deepEqual(JSON.parse(JSON.stringify(count)), {
    matches: 2, files: 1, complete: true, truncated: false, partial: [], scope: { kind: 'count' },
  });
});

test('restoreSearchResult rebuilds guest ergonomics from a wire envelope', () => {
  const original = decorateSearchResult([{ file: 'a', line: 1, text: 't' }], {
    truncated: true,
    partial: ['perm'],
    scope: { kind: 'content', path: '/tmp' },
  });
  const restored = restoreSearchResult(JSON.parse(JSON.stringify(original)));
  assert.equal(Array.isArray(restored), true);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].file, 'a');
  assert.equal(restored.truncated, true);
  assert.equal(restored.complete, false);
  assert.deepEqual(restored.partial, ['perm']);
  assert.equal(restored.scope.path, '/tmp');
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(original)));

  const count = restoreSearchResult(JSON.parse(JSON.stringify(
    decorateSearchResult({ matches: 5, files: 2 }, { partial: ['x'], scope: { kind: 'count' } }),
  )));
  assert.deepEqual(count, { matches: 5, files: 2 });
  assert.equal(count.complete, false);
  assert.deepEqual(count.partial, ['x']);
});

test('restoreSearchResult refuses to invent metadata for arbitrary user data', () => {
  assert.equal(isSearchEnvelope({ rows: [], complete: true, truncated: false, partial: [], scope: {} }), true);
  assert.equal(isSearchEnvelope({ rows: [1, 2] }), false, 'a bare rows key is ordinary user data');
  assert.equal(isSearchEnvelope({ matches: 1, files: 1 }), false);
  assert.equal(isSearchEnvelope(null), false);
  assert.equal(isSearchEnvelope([1, 2, 3]), false);
  for (const bogus of [null, 42, 'x', [1], { rows: [1] }, { matches: 1, files: 1 }]) {
    assert.throws(() => restoreSearchResult(bogus), (e) => e.code === 'EBADENVELOPE');
  }
});

test('a search result round-trips through a structuredClone-style transport', async () => {
  // The worker RPC main is building cannot carry non-enumerable fields, so the
  // envelope (not the live object) is what crosses the boundary.
  const dir = threeHitCorpus();
  const hits = await searchOn(dir).content({ query: 'needle-hit', path: dir, max: 2 });
  const transported = restoreSearchResult(structuredClone(hits.toJSON()));
  assert.equal(transported.length, 2);
  assert.equal(transported.truncated, true);
  assert.equal(transported.complete, false);
  assert.equal(transported.scope.path, realpathSync(dir));
  assert.equal(transported[0].text, 'needle-hit');
});
