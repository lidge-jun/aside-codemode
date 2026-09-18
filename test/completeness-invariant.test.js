// Issue #40: the invariant six closed issues shared, and none of them wrote down.
//
//   If the implementation skipped, capped, filtered out or could not apply something the
//   caller requested, the completeness field that action documents MUST NOT report full
//   success.
//
// #24, #29, #30, #31, #32 and #34 were each fixed with a symptom test. None stated the rule,
// so #36 and #37 shipped under a green suite of 978 tests. Every existing envelope test is
// namespace-local — search-hardening for search, browse-envelope for browse batches,
// grepfile-envelope for one fs method — so a reviewer could not state the rule, let alone
// check it.
//
// The anti-false-green mechanism is that this file is an INDEPENDENT source. The coverage
// classification below is written by hand here, NOT read from the registry, and the catalog
// is checked against it. Deriving both sides from src/search-schema.js would reproduce
// exactly the self-consistent green this repository has already been bitten by: its own
// comment at the top of that file records includeExcluded being executable while absent
// from the catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createActions } from '../src/host/actions.js';
import { createFs } from '../src/host/fs.js';
import { createSearch } from '../src/host/search.js';
import { createRgResolver, createRgRunner } from '../src/rg.js';
import { createSearchMany } from '../src/host/browse/search.js';
import { makeRootGuard } from '../src/paths.js';

const actions = createActions();

// 'neutral'   cannot change which results come back
// 'selector'  defines the requested subset — a glob, a query, a path, a depth. A caller who
//             asked for *.js did not LOSE the rest (DEC-2b), so it never lowers completeness
// 'may-omit'  a cap, a budget, an implicit pruning policy, or a filter that may not apply
const COVERAGE = {
  'search.files': { path: 'selector', pattern: 'selector', glob: 'selector', max: 'may-omit', noIgnore: 'may-omit', hidden: 'may-omit', followSymlinks: 'neutral', includeExcluded: 'may-omit', binary: 'may-omit', maxFilesize: 'may-omit', timeoutMs: 'may-omit' },
  'search.content': { query: 'selector', path: 'selector', glob: 'selector', context: 'neutral', max: 'may-omit', ignoreCase: 'selector', fixedStrings: 'selector', wordRegexp: 'selector', multiline: 'selector', noIgnore: 'may-omit', hidden: 'may-omit', followSymlinks: 'neutral', includeExcluded: 'may-omit', binary: 'may-omit', maxFilesize: 'may-omit', timeoutMs: 'may-omit' },
  'search.count': { query: 'selector', path: 'selector', glob: 'selector', ignoreCase: 'selector', fixedStrings: 'selector', noIgnore: 'may-omit', hidden: 'may-omit', followSymlinks: 'neutral', includeExcluded: 'may-omit', binary: 'may-omit', maxFilesize: 'may-omit', timeoutMs: 'may-omit' },
  'browse.probe': {},
  'browse.exec': { urls: 'selector', timeoutMs: 'may-omit', waitUntil: 'neutral', waitSelector: 'neutral', snapshot: 'neutral', maxTreeChars: 'may-omit', treeNodes: 'neutral', actions: 'neutral', approveWrites: 'neutral', stopOnError: 'may-omit', allowStaleRefs: 'neutral', refsFingerprint: 'neutral', actionBudgetMs: 'may-omit', snapshotAfter: 'neutral', fullText: 'neutral', maxTextChars: 'may-omit', helper: 'neutral', screenshot: 'neutral', pdf: 'neutral', extract: 'neutral', concurrency: 'neutral', detect: 'neutral', requireSelector: 'neutral', minTextChars: 'neutral', requireContent: 'neutral', loggedInMarker: 'neutral', stopWhenLoggedOut: 'may-omit' },
  'browse.leakedTabs': {},
  'browse.approve': { approvalId: 'selector' },
  'browse.reject': { approvalId: 'selector' },
  'browse.tabs': {},
  'browse.attach': { targetId: 'selector', urlIncludes: 'selector', titleIncludes: 'selector', requireSelector: 'neutral', minTextChars: 'neutral', includeText: 'neutral', maxTextChars: 'may-omit', sampleChars: 'may-omit', snapshot: 'neutral', maxTreeChars: 'may-omit', treeNodes: 'neutral', actions: 'neutral', approveWrites: 'neutral', stopOnError: 'may-omit', allowStaleRefs: 'neutral', refsFingerprint: 'neutral', actionBudgetMs: 'may-omit', extract: 'neutral', snapshotAfter: 'neutral' },
  'browse.captureMany': { urls: 'selector', outDir: 'neutral', screenshot: 'neutral', pdf: 'neutral', snapshot: 'neutral', timeoutMs: 'may-omit', waitUntil: 'neutral', waitSelector: 'neutral', concurrency: 'neutral' },
  'browse.readText': { url: 'selector', timeoutMs: 'may-omit', minChars: 'may-omit', fresh: 'neutral', locale: 'neutral' },
  'browse.searchMany': { queries: 'selector', engine: 'neutral', since: 'may-omit' },
  'browse.downloadMedia': { urls: 'selector', outDir: 'neutral', maxBytes: 'may-omit' },
  'browse.watch': { urls: 'selector', timeoutMs: 'may-omit', locale: 'neutral' },
  'browse.prefetch': { urls: 'selector', timeoutMs: 'may-omit', locale: 'neutral' },
  'report.build': { items: 'selector', outFile: 'neutral', title: 'neutral', paper: 'neutral', timeoutMs: 'may-omit' },
  'api.batch': { requests: 'selector' },
  'api.adapters': {},
  'recipes.list': {},
  'recipes.describe': { name: 'selector' },
  'recipes.run': { name: 'selector', args: 'selector' },
  read_file: { path: 'selector', offset: 'selector', limit: 'may-omit' },
  write_file: { file_path: 'selector', content: 'neutral' },
  edit_file: { path: 'selector', appendText: 'neutral', edits: 'neutral' },
  apply_patch: { text: 'neutral' },
  'fs.read': { path: 'selector', maxBytes: 'may-omit', offset: 'selector' },
  'fs.readMany': { paths: 'selector', maxBytes: 'may-omit', totalBytes: 'may-omit' },
  'fs.grepFile': { path: 'selector', pattern: 'selector', context: 'neutral', max: 'may-omit', ignoreCase: 'selector', normalize: 'selector', maxLineBytes: 'may-omit' },
  'fs.write': { path: 'selector', content: 'neutral' },
  'fs.mkdir': { path: 'selector' },
  'fs.stat': { path: 'selector' },
  'fs.exists': { path: 'selector' },
  'fs.list': { path: 'selector', max: 'may-omit', recursive: 'selector', depth: 'selector' },
};

// An audit of this file established that NONE of these is genuinely un-forceable in-process:
// every one has an existing injection seam, cited per action below. Calling them
// "unreachable" would have been the same kind of false comfort this test exists to remove,
// so the set is named for what it actually is — deferred, with the seam the next cycle uses.
//
//   browse.exec        fake resolveAside/spawnAside, as test/browse-envelope.test.js:9-16 does
//   browse.captureMany injectable session (src/host/browse/capture.js:98)
//   browse.attach      injectable session.raw (src/host/browse/attach.js:273)
//   browse.readText    injectable fetchImpl and browse adapter (read-text.js:96)
//   browse.downloadMedia injectable fetch and fs deps (media.js:29)
//   browse.watch       injectable readText (watch.js:17)
//   browse.prefetch    injectable readText (watch.js:93)
//   api.batch          injectable fetch (adapters.js:62)
//   recipes.run        injectable exec (watch.js:70)
//   report.build       injectable session/read/write (report.js:38)
//
// One of them is a KNOWN present-day false green rather than merely untested: a fake
// browse.exec child can return ok:true with snapshot.truncated:true, because itemStatus
// ignores nested truncation (script.js:80, session.js:181) and top-level complete is assigned
// from run status alone (session.js:518). wp9 is the cycle that fixes it, and its probe here
// is what will prove it.
const DEFERRED_TO_WP9 = new Set([
  'browse.exec', 'browse.attach', 'browse.captureMany', 'browse.downloadMedia',
  'browse.watch', 'browse.prefetch', 'browse.readText', 'report.build', 'recipes.run',
  'api.batch',
]);

const COVERAGE_CLASSES = new Set(['neutral', 'selector', 'may-omit']);

// NAMED EXCEPTIONS from structure/result-completeness.md: a primitive string return cannot
// carry a field, the catalog promises Promise<string>, and the suite asserts it as one. Their
// in-band truncation marker is display text, not the contract. Listed here so the exception
// is a decision rather than a gap, and cross-checked against the contract doc below.
const STRING_RETURN_EXCEPTIONS = new Set(['fs.read', 'read_file']);

function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function fsOn(dir) {
  return createFs({ assertInside: makeRootGuard([dir]) });
}

function searchOn(dir) {
  return createSearch({
    rgRunner: createRgRunner(createRgResolver({}, process.env), { excludeGlobs: [] }),
    assertInside: makeRootGuard([dir]),
    caps: { files: 5000, content: 500 },
  });
}

// Each probe forces ONE deterministic loss and declares the axis that must disclose it.
// 'complete' is for an operational loss — a cap, an unreadable path, an unapplied filter.
// A coverage key is for POLICY pruning, where complete is deliberately left true.
const PROBES = {
  'fs.list': async () => {
    const dir = tmp('inv-list-');
    for (const n of ['a', 'b', 'c']) writeFileSync(path.join(dir, n), 'x');
    return { value: await fsOn(dir).list(dir, { max: 1 }), expect: 'complete' };
  },
  'fs.grepFile': async () => {
    const dir = tmp('inv-grep-');
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'hit\nhit\nhit\n');
    return { value: await fsOn(dir).grepFile(f, 'hit', { max: 1 }), expect: 'complete' };
  },
  'fs.readMany': async () => {
    const dir = tmp('inv-many-');
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    writeFileSync(a, 'x'.repeat(64));
    writeFileSync(b, 'y'.repeat(64));
    const rows = await fsOn(dir).readMany([a, b], { totalBytes: 8 });
    return { value: rows, expect: 'rows-skipped' };
  },
  'search.content': async () => {
    const dir = tmp('inv-content-');
    writeFileSync(path.join(dir, 'a.txt'), 'hit\nhit\nhit\n');
    return { value: await searchOn(dir).content({ query: 'hit', path: dir, max: 1 }), expect: 'complete' };
  },
  'search.files': async () => {
    const dir = tmp('inv-files-');
    for (const n of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(path.join(dir, n), 'x');
    return { value: await searchOn(dir).files({ path: dir, max: 1 }), expect: 'complete' };
  },
  'search.count': async () => {
    // count has no row cap, so its forced loss is a POLICY one: default pruning is armed.
    const dir = tmp('inv-count-');
    writeFileSync(path.join(dir, 'a.txt'), 'hit\n');
    return { value: await searchOn(dir).count({ query: 'hit', path: dir }), expect: 'coverage.binaryContent' };
  },
  'browse.searchMany': async () => {
    const html = '<a class="result__a" href="https://a.test">A</a>';
    const fetchImpl = async () => ({ text: async () => html });
    const value = await createSearchMany({ fetchImpl })(['undated'], { since: '2030-01-01' });
    return { value, expect: 'complete' };
  },
};

// Returns true when the action claimed FULL SUCCESS on the axis, which is the thing a probe
// must never see after forcing a loss.
//
// The presence check is load-bearing. An earlier version read
// `coverage[key] === 'off'` and expected false, so DELETING the key produced
// `undefined === 'off'` → false and the probe passed while the disclosure had vanished. A
// guard that survives the removal of the thing it guards is not a guard.
function readAxis(value, expect) {
  if (expect === 'complete') {
    assert.equal(typeof value.complete, 'boolean', 'complete must exist to be read');
    return value.complete;
  }
  if (expect === 'rows-skipped') {
    // fs.readMany discloses per row rather than in one field, which the contract doc records.
    assert.ok(Array.isArray(value), 'readMany must return rows');
    return !value.some((row) => row.skipped || row.error);
  }
  if (expect.startsWith('coverage.')) {
    const key = expect.slice('coverage.'.length);
    const coverage = value.scope?.coverage;
    assert.ok(coverage && typeof coverage === 'object', 'scope.coverage must exist to be read');
    assert.ok(key in coverage, 'coverage.' + key + ' must be present, not absent');
    assert.ok(['off', 'on', 'unknown'].includes(coverage[key]), 'coverage.' + key + ' must be off/on/unknown, got ' + coverage[key]);
    return coverage[key] === 'off';
  }
  throw new Error('unknown axis: ' + expect);
}

// Option names that are caps, budgets or deadlines by construction. Classifying one of these
// as neutral or selector would silence its probe requirement, and the membership check alone
// could not tell.
//
// This is a heuristic, not a proof, and its gap is wider than "a novel option": it misses any
// lossy option whose NAME is outside this list, whether new (maxResults) or already here.
// binary, noIgnore, hidden, includeExcluded and stopWhenLoggedOut are all may-omit today and
// none of them would be caught if someone reclassified them. Only a reader can see that.
const NAMES_THAT_MUST_BE_LOSSY = /^(max|limit|maxBytes|totalBytes|maxFilesize|maxTextChars|maxTreeChars|sampleChars|timeoutMs|actionBudgetMs|since|minChars)$/;

test('every catalog input is classified, and every classification is a real input', () => {
  const problems = [];
  for (const row of actions.list()) {
    const described = actions.describe(row.path);
    const declared = Object.keys(described.inputs || {});
    const table = COVERAGE[row.path];
    if (!table) { problems.push(row.path + ' has no coverage classification'); continue; }
    for (const name of declared) {
      if (!(name in table)) problems.push(row.path + '.' + name + ' is an input with no coverage class');
      else if (!COVERAGE_CLASSES.has(table[name])) problems.push(row.path + '.' + name + ' has class ' + JSON.stringify(table[name]) + ', not neutral/selector/may-omit');
      else if (NAMES_THAT_MUST_BE_LOSSY.test(name) && table[name] !== 'may-omit') problems.push(row.path + '.' + name + ' is a cap or budget classified as ' + table[name]);
    }
    for (const name of Object.keys(table)) {
      if (!declared.includes(name)) problems.push(row.path + '.' + name + ' is classified but not an input');
    }
  }
  // A new capping option cannot slip past the sweep: it arrives unclassified and fails here.
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every may-omit action has a probe, or is deferred or excepted by name', () => {
  const lossy = Object.entries(COVERAGE)
    .filter(([, table]) => Object.values(table).includes('may-omit'))
    .map(([action]) => action);

  const missing = lossy.filter((a) => !PROBES[a] && !DEFERRED_TO_WP9.has(a) && !STRING_RETURN_EXCEPTIONS.has(a));
  assert.deepEqual(missing, [], 'no probe and no stated reason: ' + missing.join(', '));

  const stale = Object.keys(PROBES).filter((a) => !lossy.includes(a));
  assert.deepEqual(stale, [], 'probe for an action that can no longer lose anything: ' + stale.join(', '));
});

test('the string-return exceptions are the ones the contract doc names', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const doc = readFileSync(path.join(root, 'structure', 'result-completeness.md'), 'utf8');
  for (const action of STRING_RETURN_EXCEPTIONS) {
    assert.match(doc, new RegExp('`' + action.replace('.', '\\.') + '`'), action + ' is excepted here but not named in the contract');
  }
  assert.match(doc, /DISPLAY TEXT|display text/, 'the contract must say the in-band marker is not the contract');
});

for (const [action, probe] of Object.entries(PROBES)) {
  test(action + ' discloses a forced omission', async () => {
    const { value, expect } = await probe();
    assert.equal(readAxis(value, expect), false, action + ' hid a forced omission on ' + expect);
  });
}

// Without a positive case per probe, an implementation that reports incomplete ALWAYS passes
// every negative probe above and is useless. The audit found the first version covered only
// fs.list and search.content, so four actions could have gone unconditionally incomplete.
//
// Each case constructs a no-loss situation, by one of two routes: meet the cap exactly
// (fs.list, fs.grepFile, search.content, search.files), stay comfortably inside the budget
// (fs.readMany), or disable the lossy policy outright (search.count, browse.searchMany).
// Only the first route is a boundary; all three are genuinely lossless, which is what the
// axis has to report.
const POSITIVE = {
  'fs.list': async () => {
    const dir = tmp('pos-list-');
    for (const n of ['a', 'b']) writeFileSync(path.join(dir, n), 'x');
    return { value: await fsOn(dir).list(dir, { max: 2 }), expect: 'complete' };
  },
  'fs.grepFile': async () => {
    const dir = tmp('pos-grep-');
    const f = path.join(dir, 'a.txt');
    writeFileSync(f, 'hit\nhit\n');
    return { value: await fsOn(dir).grepFile(f, 'hit', { max: 2 }), expect: 'complete' };
  },
  'fs.readMany': async () => {
    const dir = tmp('pos-many-');
    const a = path.join(dir, 'a.txt');
    writeFileSync(a, 'x');
    return { value: await fsOn(dir).readMany([a], { totalBytes: 1024 }), expect: 'rows-skipped' };
  },
  'search.content': async () => {
    const dir = tmp('pos-content-');
    writeFileSync(path.join(dir, 'a.txt'), 'hit\nhit\n');
    return { value: await searchOn(dir).content({ query: 'hit', path: dir, max: 2 }), expect: 'complete' };
  },
  'search.files': async () => {
    const dir = tmp('pos-files-');
    for (const n of ['a.txt', 'b.txt']) writeFileSync(path.join(dir, n), 'x');
    return { value: await searchOn(dir).files({ path: dir, max: 2 }), expect: 'complete' };
  },
  'search.count': async () => {
    const dir = tmp('pos-count-');
    writeFileSync(path.join(dir, 'a.txt'), 'hit\n');
    const value = await searchOn(dir).count({ query: 'hit', path: dir, noIgnore: true, hidden: true, includeExcluded: true, binary: true });
    return { value, expect: 'coverage.binaryContent' };
  },
  'browse.searchMany': async () => {
    const html = '<a class="result__a" href="https://a.test">A</a>';
    const fetchImpl = async () => ({ text: async () => html });
    return { value: await createSearchMany({ fetchImpl })(['plain'], {}), expect: 'complete' };
  },
};

test('every probe has a positive counterpart', () => {
  assert.deepEqual(Object.keys(PROBES).sort(), Object.keys(POSITIVE).sort());
});

for (const [action, probe] of Object.entries(POSITIVE)) {
  test(action + ' reports full success when nothing was lost', async () => {
    const { value, expect } = await probe();
    assert.equal(readAxis(value, expect), true, action + ' reported a loss that did not happen on ' + expect);
  });
}
