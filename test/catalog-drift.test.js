// Issue #33 — actions.check refused options the runtime implements.
//
// The catalog is the only thing a guest reads before it calls, so the two directions of
// drift are both bugs: a signature that advertises an option the entry will report as
// unknown, and an entry that accepts an option its signature never mentions. The second
// is what made browse.exec read like a read-only fetcher while it could drive writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../src/host/actions.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';
import { createCaptureMany } from '../src/host/browse/capture.js';
import { validateJob } from '../src/host/browse/schema.js';

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

// A type that admits a value the runtime refuses is the same lie as a missing option, told the
// other way. captureMany's screenshot has to be typed boolean|object so a pdf-only capture can
// pass `screenshot: false`, and that made check() approve `screenshot: true`, which the job
// validator refuses. The runtime half of this test is what keeps it honest.
test('the one screenshot boolean the runtime refuses is refused by check too', () => {
  assert.throws(() => validateJob({ urls: ['data:text/html,ok'], timeoutMs: 8000, screenshot: true }), /screenshot must be an object/);

  const refused = actions.check('browse.captureMany', { urls: ['data:text/html,ok'], outDir: 'out', screenshot: true });
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(refused.invalid[0].name, 'screenshot');
  assert.equal(refused.invalid[0].code, 'EBADVAL');

  // false is the pdf-only shape and stays acceptable.
  const pdfOnly = actions.check('browse.captureMany', { urls: ['data:text/html,ok'], outDir: 'out', screenshot: false, pdf: { paperWidth: 8.27 } });
  assert.equal(pdfOnly.ok, true, JSON.stringify(pdfOnly));
  const shot = actions.check('browse.captureMany', { urls: ['data:text/html,ok'], outDir: 'out', screenshot: { type: 'jpeg' } });
  assert.equal(shot.ok, true, JSON.stringify(shot));
});

test('check accepts report.build title and timeoutMs, which report.js reads', () => {
  const r = actions.check('report.build', { items: [], outFile: 'out.pdf', title: 'x', timeoutMs: 9000 });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('check accepts the prefetch options the warmer forwards to the read', () => {
  const r = actions.check('browse.prefetch', { urls: ['https://example.com'], timeoutMs: 5000, locale: 'ko-KR' });
  assert.equal(r.ok, true, JSON.stringify(r));
});
