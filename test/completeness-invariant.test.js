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
import { createBrowse } from '../src/host/browse/browse.js';
import { createCaptureMany } from '../src/host/browse/capture.js';
import { createAttach } from '../src/host/browse/attach.js';
import { createReadText } from '../src/host/browse/read-text.js';
import { createDownloadMedia } from '../src/host/browse/media.js';
import { createWatch, createPrefetch, createRecipes } from '../src/host/browse/watch.js';
import { createReport } from '../src/host/report/report.js';
import { createApi } from '../src/host/browse/adapters.js';

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

const COVERAGE_CLASSES = new Set(['neutral', 'selector', 'may-omit']);

// browse.approve and recipes.run project browse.exec's envelope, so their loss is inherited
// rather than introduced by one of their own options. api.batch caps requests[].limit, which
// is below the catalog's top-level requests input. These still need probes even though the
// hand-written option table has no may-omit entry that can reveal them.
const LOSSY_BEYOND_OPTIONS = new Set(['browse.approve', 'recipes.run', 'api.batch']);

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

const BROWSE_URL = 'https://a.test/page';
const resolveAside = async () => 'C:/fake/aside.exe';

function childOutput(item) {
  return JSON.stringify({ type: 'final', items: [{ jobId: 'j000', url: BROWSE_URL, ok: true, ...item }], leakedUrls: [], partial: [] })
    + '\n[ok | 5ms]';
}

function browseWith(item, extraCaps = {}) {
  return createBrowse({
    config: { browseCaps: { enabled: true, ...extraCaps } },
    resolveAside,
    spawnAside: async () => ({ stdout: childOutput(item), killed: false }),
  });
}

function readablePng() {
  const buf = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(10, 16);
  buf.writeUInt32BE(5, 20);
  return buf;
}

function captureValue(truncated) {
  const capture = createCaptureMany({
    session: {
      run: async (_job, opts) => ({
        schema: 'browse/2', runId: 'run-capture', status: 'completed', ok: true,
        requested: 1, completed: 1, complete: !truncated, truncated,
        items: [{
          jobId: 'j000', url: BROWSE_URL, ok: true, status: 'completed',
          artifactName: opts.artifactNames[0],
          ...(truncated ? { snapshot: { truncated: true } } : {}),
        }],
        ledger: [{ jobId: 'j000', url: BROWSE_URL, index: 0 }],
        partial: truncated ? ['truncated-items'] : [],
        lostTo: truncated ? ['snapshot-truncated'] : undefined,
        pwd: '/fake/session',
      }),
    },
    assertInside: (p) => p,
    deps: {
      mkdirImpl: async () => {},
      realpathImpl: async (p) => p,
      readFileImpl: async () => readablePng(),
      writeFileImpl: async () => {},
    },
  });
  return capture([BROWSE_URL], { outDir: '/out' });
}

function attachValue(textChars, text) {
  const attach = createAttach({
    config: { browseCaps: { enabled: true } },
    session: {
      raw: async () => ({
        rows: [{
          kind: 'page', contentVerified: true, actionsOk: true,
          render: { textChars }, text,
        }],
        raw: { stdout: '' },
      }),
    },
  });
  return attach.attach({ includeText: true });
}

function diffReader(body, type = 'text/plain') {
  return createReadText({
    fetchImpl: async () => ({
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
      text: async () => body,
      url: 'https://patch-diff.githubusercontent.com/raw/o/r/pull/1.diff',
    }),
  });
}

function mediaValue(refuseSecond) {
  const media = createDownloadMedia({
    fetchImpl: async (url) => url.includes('/refused') && refuseSecond
      ? { ok: false, status: 503, headers: { get: () => null } }
      : { ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => readablePng() },
    deps: { mkdirImpl: async () => {}, writeFileImpl: async () => {} },
  });
  return media(['https://a.test/image', 'https://a.test/refused'], { outDir: '/out' });
}

function reportValue(complete) {
  let paper;
  const report = createReport({
    session: {
      run: async (job) => {
        paper = job.pdf;
        return {
          status: 'completed', complete,
          items: [{ ok: true, pdfName: 'report.pdf' }],
        };
      },
    },
    assertInside: (p) => p,
    deps: {
      readPdf: async () => Buffer.from(`/MediaBox [0 0 ${paper.paperWidth * 72} ${paper.paperHeight * 72}]`),
      writeFileImpl: async () => {},
    },
  });
  return report.build({ items: [], outFile: '/out/report.pdf' });
}

// Each probe forces ONE deterministic loss and declares the axis that must disclose it.
// 'complete' is for an operational loss — a cap, an unreadable path, an unapplied filter.
// A coverage key is for POLICY pruning, where complete is deliberately left true.
const PROBES = {
  'browse.exec': async () => ({
    value: await browseWith({ snapshot: { truncated: true } }).exec({ urls: [BROWSE_URL], snapshot: true }),
    expect: 'complete',
  }),
  'browse.approve': async () => {
    const browse = browseWith(
      { actionsOk: true, snapshot: { truncated: true } },
      { approvalDir: tmp('inv-approve-') },
    );
    const refused = await browse.exec({
      urls: [BROWSE_URL], snapshot: true, refsFingerprint: 'r1-test',
      actions: [{ ref: 'e1', click: true }],
    });
    return { value: await browse.approve({ approvalId: refused.approvalId }), expect: 'complete' };
  },
  'browse.attach': async () => ({
    value: await attachValue(10, 'short'),
    expect: 'complete',
  }),
  'browse.captureMany': async () => ({
    value: await captureValue(true),
    expect: 'complete',
  }),
  'browse.readText': async () => {
    const url = 'https://patch-diff.githubusercontent.com/raw/o/r/pull/1.diff';
    const interstitial = '[Skip to content](#start-of-content)\n\n## Navigation Menu\n\n[Sign in](/login?return_to=x)\n\nYou can’t perform that action at this time.\n';
    return { value: await diffReader(interstitial, 'text/html')(url, { fresh: true }), expect: 'complete' };
  },
  'browse.downloadMedia': async () => ({
    value: await mediaValue(true),
    expect: 'complete',
  }),
  'browse.watch': async () => {
    const watch = createWatch({
      readText: async (url) => url.includes('/bad')
        ? { ok: false, complete: false }
        : { ok: true, complete: true, text: 'observed' },
    });
    return { value: await watch(['https://a.test/good', 'https://a.test/bad']), expect: 'complete' };
  },
  'browse.prefetch': async () => {
    const prefetch = createPrefetch({
      readText: async (url) => url.includes('/incomplete')
        ? { ok: true, complete: false, text: 'partial', source: 'fetch' }
        : { ok: true, complete: true, text: 'whole', source: 'fetch' },
    });
    const value = await prefetch(['https://a.test/complete', 'https://a.test/incomplete']);
    assert.equal(value.ok, true, 'best-effort prefetch must stay successful as an operation');
    assert.equal(value.complete, false, 'one incomplete read must leave the same prefetch incomplete');
    return { value, expect: 'complete' };
  },
  'report.build': async () => ({
    value: await reportValue(false),
    expect: 'complete',
  }),
  'recipes.run': async () => {
    const recipes = createRecipes({
      registry: { page: { url: BROWSE_URL } },
      exec: async () => ({ ok: true, status: 'completed', complete: false, items: [{ ok: true }], partial: [] }),
    });
    return { value: await recipes.run('page'), expect: 'complete' };
  },
  'api.batch': async () => {
    const api = createApi({
      fetchImpl: async () => ({
        ok: true, status: 200,
        json: async () => ({ results: [{ trackId: 1 }, { trackId: 2 }] }),
      }),
    });
    return { value: await api.batch([{ adapter: 'itunes', term: 'x', limit: 1 }]), expect: 'complete' };
  },
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

test('every may-omit action has a probe, or is excepted by name', () => {
  const lossy = Object.entries(COVERAGE)
    .filter(([, table]) => Object.values(table).includes('may-omit'))
    .map(([action]) => action);

  const missing = lossy.filter((a) => !PROBES[a] && !STRING_RETURN_EXCEPTIONS.has(a));
  assert.deepEqual(missing, [], 'no probe and no stated reason: ' + missing.join(', '));

  const stale = Object.keys(PROBES).filter((a) => !lossy.includes(a) && !LOSSY_BEYOND_OPTIONS.has(a));
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
// Each case constructs a no-loss situation: caps are met exactly or stay inside budget,
// policies are disabled, and projected envelopes come from complete producers. The point is
// the same in every case: the axis has to distinguish a real loss from an unconditional
// incomplete result.
const POSITIVE = {
  'browse.exec': async () => ({
    value: await browseWith({}).exec({ urls: [BROWSE_URL] }),
    expect: 'complete',
  }),
  'browse.approve': async () => {
    const browse = browseWith(
      { actionsOk: true, snapshot: { truncated: false } },
      { approvalDir: tmp('pos-approve-') },
    );
    const refused = await browse.exec({
      urls: [BROWSE_URL], snapshot: true, refsFingerprint: 'r1-test',
      actions: [{ ref: 'e1', click: true }],
    });
    return { value: await browse.approve({ approvalId: refused.approvalId }), expect: 'complete' };
  },
  'browse.attach': async () => ({
    value: await attachValue(5, 'whole'),
    expect: 'complete',
  }),
  'browse.captureMany': async () => ({
    value: await captureValue(false),
    expect: 'complete',
  }),
  'browse.readText': async () => {
    const url = 'https://patch-diff.githubusercontent.com/raw/o/r/pull/1.diff';
    const body = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n';
    return { value: await diffReader(body)(url, { fresh: true }), expect: 'complete' };
  },
  'browse.downloadMedia': async () => ({
    value: await mediaValue(false),
    expect: 'complete',
  }),
  'browse.watch': async () => {
    const watch = createWatch({
      readText: async () => ({ ok: true, complete: true, text: 'observed' }),
    });
    return { value: await watch(['https://a.test/one', 'https://a.test/two']), expect: 'complete' };
  },
  'browse.prefetch': async () => {
    const prefetch = createPrefetch({
      readText: async () => ({ ok: true, complete: true, text: 'whole', source: 'fetch' }),
    });
    return { value: await prefetch(['https://a.test/one', 'https://a.test/two']), expect: 'complete' };
  },
  'report.build': async () => ({
    value: await reportValue(true),
    expect: 'complete',
  }),
  'recipes.run': async () => {
    const recipes = createRecipes({
      registry: { page: { url: BROWSE_URL } },
      exec: async () => ({ ok: true, status: 'completed', complete: true, items: [{ ok: true }], partial: [] }),
    });
    return { value: await recipes.run('page'), expect: 'complete' };
  },
  'api.batch': async () => {
    const api = createApi({
      fetchImpl: async () => ({
        ok: true, status: 200,
        json: async () => ({ results: [{ trackId: 1 }] }),
      }),
    });
    return { value: await api.batch([{ adapter: 'itunes', term: 'x', limit: 1 }]), expect: 'complete' };
  },
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

test('every beyond-options loss has both executable sides', () => {
  const missing = [...LOSSY_BEYOND_OPTIONS].filter((action) => !PROBES[action] || !POSITIVE[action]);
  assert.deepEqual(missing, [], 'beyond-options entry without a negative and positive probe: ' + missing.join(', '));
});

for (const [action, probe] of Object.entries(POSITIVE)) {
  test(action + ' reports full success when nothing was lost', async () => {
    const { value, expect } = await probe();
    assert.equal(readAxis(value, expect), true, action + ' reported a loss that did not happen on ' + expect);
  });
}
