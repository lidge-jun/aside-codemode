// Issue #33 — actions.check refused options the runtime implements.
//
// The catalog is the only thing a guest reads before it calls, so the two directions of
// drift are both bugs: a signature that advertises an option the entry will report as
// unknown, and an entry that accepts an option its signature never mentions. The second
// is what made browse.exec read like a read-only fetcher while it could drive writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createActions } from '../src/host/actions.js';
import { createFs } from '../src/host/fs.js';
import { createApplyPatch } from '../src/host/patch.js';
import { makeRootGuard } from '../src/paths.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';
import { createCaptureMany, planCaptureMany } from '../src/host/browse/capture.js';
import { validateJob } from '../src/host/browse/schema.js';
import { requireApprovalId } from '../src/host/browse/approvals.js';
import { validateSearchMany } from '../src/host/browse/search.js';
import { validateReadTextUrl } from '../src/host/browse/read-text.js';
import { createDownloadMedia, validateDownloadMedia } from '../src/host/browse/media.js';
import { createWatch, createPrefetch, createRecipes, validateWatchUrls, validatePrefetchUrls, validateRecipeRun } from '../src/host/browse/watch.js';
import { createReport, planReportBuild } from '../src/host/report/report.js';
import { createApi, validateApiBatch } from '../src/host/browse/adapters.js';
import { RUNTIME_VALIDATED_PATHS } from '../src/host/browse/actions-schema.js';

const actions = createActions();
const entries = actions.list().map((row) => actions.describe(row.path));

// The return type is cut away first. Promise<{ok,items}> carries braces and identifiers of
// its own, and reading those as arguments reported `ok` as an undeclared option.
function argumentPart(signature) {
  const sig = String(signature || '');
  const arrow = sig.indexOf('=>');
  return arrow === -1 ? sig : sig.slice(0, arrow);
}

// Trace the names the validator itself reads, then ask that validator whether an own
// property with that name is legal. This keeps the runtime contract independent from the
// catalog under test: deriving both sides from BROWSE_ACTIONS is the false green this suite
// is meant to prevent.
function acceptedOptionNames(seed, validate) {
  const reads = new Set();
  const traced = new Proxy(seed, {
    get(target, key, receiver) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.get(target, key, receiver);
    },
  });
  validate(traced);
  return [...reads].filter((key) => {
    const candidate = { ...seed };
    if (!(key in candidate)) candidate[key] = undefined;
    try {
      validate(candidate);
      return true;
    } catch {
      return false;
    }
  });
}

test('browse catalog declares every option its runtime validators accept', async () => {
  const captureReads = new Set();
  const capture = createCaptureMany({
    session: { run: async () => ({ ok: true, items: [], ledger: [], partial: [] }) },
  });
  await capture(['data:text/html,ok'], new Proxy({}, {
    get(target, key, receiver) {
      if (typeof key === 'string') captureReads.add(key);
      return Reflect.get(target, key, receiver);
    },
  }));

  const accepted = new Map([
    ['browse.exec', acceptedOptionNames(
      { urls: ['data:text/html,ok'] },
      (input) => validateJob(input),
    )],
    ['browse.attach', acceptedOptionNames({}, validateAttach)],
    // browseCaps is injected by createBrowse after the public call; it is not a caller option.
    ['browse.captureMany', [...captureReads].filter((name) => name !== 'browseCaps')],
  ]);
  const missing = [];
  for (const [path, names] of accepted) {
    const declared = actions.describe(path).inputs;
    for (const name of names) {
      if (!(name in declared)) missing.push(path + ' omits runtime option ' + name);
    }
  }
  assert.deepEqual(missing, []);
});

test('every option a signature marks optional is an accepted input', () => {
  const drift = [];
  for (const rec of entries) {
    for (const m of argumentPart(rec.signature).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\?/g)) {
      if (!(m[1] in (rec.inputs || {}))) drift.push(rec.path + ' advertises ' + m[1]);
    }
  }
  assert.deepEqual(drift, []);
});

test('every accepted input is named in the signature the reader sees first', () => {
  const hidden = [];
  for (const rec of entries) {
    const args = argumentPart(rec.signature);
    for (const name of Object.keys(rec.inputs || {})) {
      if (!new RegExp('\\b' + name + '\\b').test(args)) hidden.push(rec.path + ' hides ' + name);
    }
  }
  assert.deepEqual(hidden, []);
});

test('browse.exec and browse.attach admit in their signature that they can write', () => {
  for (const path of ['browse.exec', 'browse.attach']) {
    const rec = actions.describe(path);
    assert.ok(rec.signature.includes('actions?'), path + ' signature must name actions?');
    assert.ok(rec.signature.includes('approveWrites?'), path + ' signature must name approveWrites?');
    assert.equal(rec.inputs.actions.required, false);
    assert.equal(rec.inputs.approveWrites.required, false);
  }
});

test('check accepts the batch-capture options the runtime honours', () => {
  const r = actions.check('browse.captureMany', {
    urls: ['data:text/html,ok'],
    outDir: 'out',
    screenshot: false,
    pdf: {},
    snapshot: true,
    timeoutMs: 8000,
    waitUntil: 'load',
    concurrency: 1,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('grepFile discovery follows measured runtime pattern and line-cap semantics', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-catalog-grep-'));
  writeFileSync(path.join(root, 'a.txt'), 'alpha\nbeta needle\n');
  const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }) });
  const guestRegexp = vm.runInContext('/needle/', vm.createContext({}));

  assert.deepEqual(
    (await fs.grepFile('a.txt', guestRegexp)).map((row) => row.text),
    ['beta needle'],
  );
  assert.deepEqual(
    (await fs.grepFile('a.txt', '')).map((row) => row.text),
    ['alpha', 'beta needle', ''],
  );
  assert.equal(
    (await fs.grepFile('a.txt', 'needle', { maxLineBytes: 4 }))[0].text,
    'beta…[line truncated: kept 4 of 11 bytes]',
  );
  // null is genuinely different from omission here: the runtime coerces it to zero.
  assert.equal(
    (await fs.grepFile('a.txt', 'needle', { maxLineBytes: null }))[0].text,
    '…[line truncated: kept 0 of 11 bytes]',
  );
});

test('file action discovery reports every measured value refusal from the runtime', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-catalog-files-'));
  writeFileSync(path.join(root, 'a.txt'), 'alpha\nbeta\n');
  const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }) });
  const applyPatch = createApplyPatch({ write_file: fs.write_file, edit_file: fs.edit_file });

  const refused = [
    ['read_file', { path: '', offset: 1, limit: 1 }, () => fs.read_file({ path: '', offset: 1, limit: 1 })],
    ['read_file', { path: 'a.txt', offset: 0, limit: 1 }, () => fs.read_file({ path: 'a.txt', offset: 0, limit: 1 })],
    ['read_file', { path: 'a.txt', offset: 1, limit: 0 }, () => fs.read_file({ path: 'a.txt', offset: 1, limit: 0 })],
    ['read_file', { path: 'a.txt', offset: Number.MAX_SAFE_INTEGER + 1, limit: 1 }, () => fs.read_file({ path: 'a.txt', offset: Number.MAX_SAFE_INTEGER + 1, limit: 1 })],
    ['write_file', { file_path: '', content: '' }, () => fs.write_file({ file_path: '', content: '' })],
    ['edit_file', { path: '', appendText: 'x' }, () => fs.edit_file({ path: '', appendText: 'x' })],
    ['edit_file', { path: 'a.txt' }, () => fs.edit_file({ path: 'a.txt' })],
    ['edit_file', { path: 'a.txt', edits: [{}] }, () => fs.edit_file({ path: 'a.txt', edits: [{}] })],
    ['edit_file', { path: 'a.txt', edits: [{ oldText: '', newText: 'x' }] }, () => fs.edit_file({ path: 'a.txt', edits: [{ oldText: '', newText: 'x' }] })],
    ['apply_patch', { text: '   ' }, () => applyPatch('   ')],
    ['apply_patch', { text: '*** Begin Patch\n*** End Patch' }, () => applyPatch('*** Begin Patch\n*** End Patch')],
    ['apply_patch', { text: '*** Begin Patch\n*** Add File:   \n+x\n*** End Patch' }, () => applyPatch('*** Begin Patch\n*** Add File:   \n+x\n*** End Patch')],
    ['fs.read', { path: 'a.txt', offset: -1, maxBytes: 1 }, () => fs.read('a.txt', { offset: -1, maxBytes: 1 })],
    ['fs.read', { path: 'a.txt', offset: 1.5, maxBytes: 1 }, () => fs.read('a.txt', { offset: 1.5, maxBytes: 1 })],
    ['fs.read', { path: 'a.txt', offset: Number.MAX_SAFE_INTEGER + 1, maxBytes: 1 }, () => fs.read('a.txt', { offset: Number.MAX_SAFE_INTEGER + 1, maxBytes: 1 })],
    ['fs.read', { path: 'a.txt', maxBytes: 1.5 }, () => fs.read('a.txt', { maxBytes: 1.5 })],
    ['fs.read', { path: 'a.txt', maxBytes: Number.MAX_SAFE_INTEGER + 1 }, () => fs.read('a.txt', { maxBytes: Number.MAX_SAFE_INTEGER + 1 })],
    ['fs.read', { path: 'a.txt', maxBytes: NaN }, () => fs.read('a.txt', { maxBytes: NaN })],
  ];

  for (const [action, args, call] of refused) {
    let runtimeError = null;
    try { await call(); } catch (error) { runtimeError = error; }
    assert.ok(runtimeError, action + ' runtime accepted ' + JSON.stringify(args));

    const checked = actions.check(action, args);
    assert.equal(checked.ok, false, action + ' discovery accepted ' + JSON.stringify(args));
    assert.ok(
      checked.invalid.some((problem) => problem.why === runtimeError.message),
      action + ' did not report runtime refusal ' + JSON.stringify(runtimeError.message) + ': ' + JSON.stringify(checked),
    );
  }
});

test('fs.read discovery preserves the runtime byte-range values that are accepted', () => {
  for (const maxBytes of [0, -1, -0.5, -Infinity, Infinity, Number.MAX_SAFE_INTEGER]) {
    const checked = actions.check('fs.read', { path: 'a.txt', maxBytes });
    assert.equal(checked.ok, true, 'discovery refused maxBytes=' + String(maxBytes) + ': ' + JSON.stringify(checked));
  }
  assert.equal(actions.check('fs.read', { path: 'a.txt', offset: 0, maxBytes: 1 }).ok, true);
  assert.equal(actions.check('read_file', { path: 'a.txt', offset: 1, limit: Number.MAX_SAFE_INTEGER }).ok, true);
});

// The fixture names every runtime pre-flight, not selected incidents. A new dispatch-table
// row therefore has to bring one refusal and one accepted call with it. The expected reason
// comes from the owner validator at test time; copying message text here would let the test
// and the call drift independently while both still looked precise.
const RUNTIME_PREFLIGHTS = {
  'browse.exec': {
    run: (args) => validateJob({ timeoutMs: 8000, ...args }),
    refused: [{ args: { urls: ['data:text/html,ok'], waitUntil: 'networkidle' }, name: 'waitUntil' }],
    accepted: { urls: ['data:text/html,ok'], snapshot: true },
  },
  'browse.attach': {
    run: (args) => validateAttach(args),
    refused: [{ args: { targetId: 'tab-1', urlIncludes: 'example.com' }, name: 'targetId' }],
    accepted: { targetId: 'tab-1' },
  },
  'browse.captureMany': {
    run: (args) => {
      const { urls, outDir, ...rest } = args;
      const { job } = planCaptureMany(urls, rest);
      return validateJob({ timeoutMs: 8000, ...job });
    },
    refused: [
      { args: { urls: ['data:text/html,ok'], outDir: 'out', screenshot: true }, name: 'screenshot' },
      { args: { urls: ['data:text/html,ok'], outDir: 'out', screenshot: false }, name: 'screenshot' },
      { args: { urls: ['data:text/html,ok'], outDir: 'out', screenshot: { maxWidth: 640 } }, name: 'screenshot' },
      { args: { urls: ['data:text/html,ok'], outDir: 'out', pdf: { format: 'A4' } }, name: 'pdf' },
      { args: { urls: ['data:text/html,ok'], outDir: 'out', waitUntil: 'networkidle' }, name: 'waitUntil' },
    ],
    accepted: { urls: ['data:text/html,ok'], outDir: 'out', screenshot: false, pdf: { paperWidth: 8.27, paperHeight: 11.69 } },
  },
  'browse.searchMany': {
    run: (args) => validateSearchMany(args.queries, args),
    refused: [{ args: { queries: ['x'], engine: 'bing' }, name: 'engine' }],
    accepted: { queries: ['x'], engine: 'duckduckgo', since: new Date('2026-01-01T00:00:00Z') },
  },
  'browse.readText': {
    run: (args) => validateReadTextUrl(args.url),
    refused: [{ args: { url: 'file:///etc/hosts' }, name: 'url' }],
    accepted: { url: 'https://example.com', timeoutMs: 9000 },
  },
  'browse.approve': {
    run: (args) => requireApprovalId('browse.approve', args),
    refused: [{ args: { approvalId: '' }, name: 'approvalId' }],
    accepted: { approvalId: 'approval-11111111-2222-3333-4444-555555555555' },
  },
  'browse.reject': {
    run: (args) => requireApprovalId('browse.reject', args),
    refused: [{ args: { approvalId: '' }, name: 'approvalId' }],
    accepted: { approvalId: 'approval-11111111-2222-3333-4444-555555555555' },
  },
  'browse.downloadMedia': {
    run: (args) => validateDownloadMedia(args.urls, args),
    refused: [
      { args: { urls: [], outDir: 'out' }, name: 'urls' },
      { args: { urls: ['https://example.com/image.png'], outDir: '' }, name: 'outDir' },
    ],
    accepted: { urls: ['https://example.com/image.png'], outDir: 'out' },
  },
  'browse.watch': {
    run: (args) => validateWatchUrls(args.urls),
    refused: [{ args: { urls: [] }, name: 'urls' }],
    accepted: { urls: ['https://example.com'] },
  },
  'browse.prefetch': {
    run: (args) => validatePrefetchUrls(args.urls),
    refused: [{ args: { urls: [] }, name: 'urls' }],
    accepted: { urls: ['https://example.com'], timeoutMs: 5000, locale: 'ko-KR' },
  },
  'report.build': {
    run: (args) => planReportBuild(args),
    refused: [
      { args: { items: [], outFile: 'out.pdf', paper: { format: 'A4' } }, name: 'paper' },
      { args: { items: [], outFile: 'out.pdf', paper: { bogus: 1 } }, name: 'paper' },
      { args: { items: [], outFile: 'out.pdf', timeoutMs: -1 }, name: 'timeoutMs' },
    ],
    accepted: { outFile: 'out.pdf', title: 'x', paper: null, timeoutMs: 9000 },
  },
  'api.batch': {
    run: (args) => validateApiBatch(args.requests),
    refused: [{ args: { requests: [] }, name: null }],
    accepted: { requests: [{ adapter: 'youtube', url: 'https://example.com/watch?v=1' }] },
  },
};

test('the sweep covers every catalog entry backed by a runtime pre-flight', () => {
  assert.deepEqual(Object.keys(RUNTIME_PREFLIGHTS).sort(), [...RUNTIME_VALIDATED_PATHS].sort());
});

for (const [path, fixture] of Object.entries(RUNTIME_PREFLIGHTS)) {
  test(path + ' discovery agrees with its runtime pre-flight in both directions', () => {
    for (const refused of fixture.refused) {
      let runtimeError = null;
      try { fixture.run(refused.args); } catch (error) { runtimeError = error; }
      assert.ok(runtimeError, path + ' runtime accepted ' + JSON.stringify(refused.args));

      const checked = actions.check(path, refused.args);
      assert.equal(checked.ok, false, path + ' discovery accepted ' + JSON.stringify(refused.args));
      assert.equal(checked.invalid.length, 1, JSON.stringify(checked.invalid));
      assert.equal(checked.invalid[0].code, runtimeError.code);
      assert.equal(checked.invalid[0].why, runtimeError.message);
      assert.equal(checked.invalid[0].name ?? null, refused.name, JSON.stringify(checked.invalid));
    }

    assert.doesNotThrow(() => fixture.run(fixture.accepted));
    const checked = actions.check(path, fixture.accepted);
    assert.equal(checked.ok, true, path + ' discovery refused ' + JSON.stringify(checked.invalid || checked));
  });
}

// The pre-flight is shared rather than copied. If captureMany stopped calling planCaptureMany
// the two would drift apart again without any test noticing.
// recipes.run is the one rule that cannot sit in the dispatch table: the registry is this
// host instance's data. Discovery gets it from the host scope, and a caller who has no
// registry gets no answer rather than a guess, because guessing from an empty list would
// report every configured recipe as unknown.
test('an unknown recipe is refused only where the registry is actually known', () => {
  const withRegistry = createActions({ recipes: { known: { url: 'https://example.com/{q}' } } });
  const refused = withRegistry.check('recipes.run', { name: 'nope' });
  assert.equal(refused.ok, false);
  assert.equal(refused.invalid[0].code, 'EBADOPT');
  assert.match(refused.invalid[0].why, /unknown recipe/);
  assert.equal(withRegistry.check('recipes.run', { name: 'known' }).ok, true);

  // The real call refuses the same two, from the same function.
  assert.throws(() => validateRecipeRun('nope', { known: { url: 'https://example.com' } }), /unknown recipe/);
  assert.equal(validateRecipeRun('known', { known: { url: 'https://example.com' } }).url, 'https://example.com');

  // No registry, no value check: types only, as before.
  assert.equal(createActions().check('recipes.run', { name: 'nope' }).ok, true);
});

test('the capture plan discovery runs is the plan the call runs', () => {
  assert.throws(() => planCaptureMany(['data:text/html,ok'], { pdf: { format: 'A4' } }), /format is ENOTSUP/);
  assert.throws(() => validateJob({ urls: ['data:text/html,ok'], timeoutMs: 8000, screenshot: true }), /screenshot must be an object/);
  const { job } = planCaptureMany(['data:text/html,ok'], { screenshot: { type: 'jpeg' } });
  assert.deepEqual(job.screenshot, { type: 'jpeg' });
});

test('the extracted pre-flights are the checks their calls execute', async () => {
  async function sameRefusal(validate, call) {
    let expected = null;
    try { validate(); } catch (error) { expected = error; }
    assert.ok(expected, 'the pre-flight must refuse the example');
    await assert.rejects(call, (actual) => {
      assert.equal(actual.code, expected.code);
      assert.equal(actual.message, expected.message);
      return true;
    });
  }

  const media = createDownloadMedia({ fetchImpl: async () => { throw new Error('fetch must not run'); } });
  const watch = createWatch({ readText: async () => { throw new Error('read must not run'); } });
  const prefetch = createPrefetch({ readText: async () => { throw new Error('read must not run'); } });
  const report = createReport({ session: { run: async () => { throw new Error('session must not run'); } } });
  const api = createApi({ fetchImpl: async () => { throw new Error('fetch must not run'); } });
  const registry = { known: { url: 'https://example.com' } };
  const recipes = createRecipes({ registry, exec: async () => { throw new Error('exec must not run'); } });

  await sameRefusal(
    () => validateDownloadMedia([], { outDir: 'out' }),
    () => media([], { outDir: 'out' }),
  );
  await sameRefusal(() => validateWatchUrls([]), () => watch([]));
  await sameRefusal(() => validatePrefetchUrls([]), () => prefetch([]));
  for (const opts of [
    { items: [], outFile: 'out.pdf', paper: { format: 'A4' } },
    { items: [], outFile: 'out.pdf', paper: { bogus: 1 } },
    { items: [], outFile: 'out.pdf', timeoutMs: -1 },
  ]) {
    await sameRefusal(
      () => planReportBuild(opts),
      () => report.build(opts),
    );
  }
  await sameRefusal(() => validateApiBatch([]), () => api.batch([]));
  await sameRefusal(() => validateRecipeRun('unknown', registry), () => recipes.run('unknown'));
});
