// Driving the page by accessibility ref.
//
// The verbs are not the risk: the probe showed every one of them present on the locator.
// The risk is that a ref belongs to the snapshot that produced it, and one click measurably
// renumbered a tree from 3,126 to 23,530 characters. Acting on a stale ref would click the
// wrong element and report success, so most of these pin the refusal, not the happy path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runActions, ACTION_STEP_SRC } from '../src/host/browse/actions-run.js';
import { validateActions, validateJob, MAX_ACTION_STEPS } from '../src/host/browse/schema.js';
import { compile } from '../src/host/browse/script.js';
import { compileAttach, createAttach } from '../src/host/browse/attach.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';
import { CAPABILITY_MATRIX } from '../src/host/browse/probe.js';

function fakePage(opts = {}) {
  const calls = [];
  const urls = opts.urls || ['https://a.test/one'];
  let idx = 0;
  const missing = new Set(opts.missing || []);
  const throws = opts.throws || {};
  const slow = opts.slow || {};
  const locator = (target) => new Proxy({}, {
    get(_t, name) {
      if (missing.has(name)) return undefined;
      return async (...args) => {
        calls.push({ on: 'locator', target, name, args });
        if (slow[name]) await new Promise((r) => setTimeout(r, slow[name]));
        if (throws[name]) throw new Error(throws[name]);
        if (name === 'click' && opts.clickNavigates) idx = Math.min(idx + 1, urls.length - 1);
        return undefined;
      };
    },
  });
  return {
    calls,
    locator,
    evaluate: async (expr) => {
      if (expr === 'location.href') return urls[idx];
      calls.push({ on: 'page', name: 'evaluate', args: [expr] });
      return null;
    },
    waitForSelector: async (s) => { calls.push({ on: 'page', name: 'waitForSelector', args: [s] }); },
    waitForLoadState: async (s) => { calls.push({ on: 'page', name: 'waitForLoadState', args: [s] }); },
    goBack: async () => { calls.push({ on: 'page', name: 'goBack', args: [] }); },
    reload: async () => { calls.push({ on: 'page', name: 'reload', args: [] }); },
  };
}

const steps = (raw) => validateActions(raw);

test('a step needs exactly one verb and at most one target', () => {
  assert.throws(() => steps([{ ref: 'e1' }]), /needs exactly one verb/);
  assert.throws(() => steps([{ ref: 'e1', click: true, hover: true }]), /needs exactly one verb/);
  assert.throws(() => steps([{ ref: 'e1', selector: '#a', click: true }]), /only one of ref or selector/);
  assert.throws(() => steps([{ click: true }]), /needs a ref or a selector/);
  assert.throws(() => steps([{ ref: 'e1', nope: 1 }]), /unknown actions\[0\] key/);
  assert.throws(() => steps([{ reload: true, ref: 'e1' }]), /takes no ref or selector/);
});

test('verb values are typed, and the refusals name the measured reason', () => {
  assert.throws(() => steps([{ ref: 'e1', fill: 7 }]), /must be a string/);
  assert.throws(() => steps([{ waitForLoadState: 'networkidle' }]), /must be one of load, domcontentloaded, stable/);
  assert.throws(() => steps([{ scroll: 'sideways' }]), /must be 'top', 'bottom' or a non-negative integer/);
  assert.throws(() => steps([{ sleepMs: 999999 }]), /at most 10000ms/);
  const tooMany = [];
  for (let i = 0; i <= MAX_ACTION_STEPS; i += 1) tooMany.push({ ref: 'e1', click: true });
  assert.throws(() => steps(tooMany), /2143ms/, 'the cap explains itself with the measurement');
});

test('a validated step records how it will be executed', () => {
  const [a, b, c] = steps([{ ref: 'f1e2', fill: 'hi' }, { waitFor: '.results' }, { scroll: 'bottom' }]);
  assert.deepEqual({ verb: a.verb, target: a.target, targetKind: a.targetKind, value: a.value, via: a.via },
    { verb: 'fill', target: 'f1e2', targetKind: 'ref', value: 'hi', via: 'locator' });
  assert.equal(b.targetKind, 'selector', 'waitFor carries its selector as the verb value');
  assert.equal(c.via, 'page');
});

test('verbs reach the locator, which is where this surface actually has them', async () => {
  const page = fakePage();
  const r = await runActions(page, steps([
    { ref: 'e5', click: true },
    { ref: 'f1e2', fill: 'hello' },
    { ref: 'f1e3', selectOption: 'b' },
    { selector: '#q', press: 'Enter' },
  ]), { urlAtSnapshot: 'https://a.test/one' });
  assert.equal(r.ok, true);
  assert.equal(r.ran, 4);
  const locCalls = page.calls.filter((c) => c.on === 'locator');
  assert.deepEqual(locCalls.map((c) => c.name), ['click', 'fill', 'selectOption', 'press']);
  assert.deepEqual(locCalls[1].args, ['hello']);
  assert.equal(locCalls[3].target, '#q', 'a css target uses the same locator path');
  assert.ok(r.steps.every((s) => s.ms >= 0));
});

test('page-level verbs go to the page, not the locator', async () => {
  const page = fakePage();
  const r = await runActions(page, steps([{ waitForLoadState: 'stable' }, { goBack: true }, { scroll: 'top' }]), {});
  assert.equal(r.ok, true);
  assert.deepEqual(page.calls.filter((c) => c.on === 'page').map((c) => c.name),
    ['waitForLoadState', 'goBack', 'evaluate']);
});

test('a method the surface does not have is ENOTSUP, not a silent success', async () => {
  const page = fakePage({ throws: { dblclick: 'loc.dblclick is not a function' } });
  const r = await runActions(page, steps([{ ref: 'e1', dblclick: true }]), {});
  assert.equal(r.ok, false);
  assert.equal(r.steps[0].code, 'ENOTSUP');
  assert.match(r.steps[0].error, /is not a function/);
});

test('an ordinary failure is EACTION and keeps the real message', async () => {
  const page = fakePage({ throws: { click: 'element is not visible' } });
  const r = await runActions(page, steps([{ ref: 'e1', click: true }]), {});
  assert.equal(r.steps[0].code, 'EACTION');
  assert.equal(r.steps[0].error, 'element is not visible');
});

test('a ref step refuses once the page has navigated away from its snapshot', async () => {
  const page = fakePage({ urls: ['https://a.test/one', 'https://a.test/two'], clickNavigates: true });
  const r = await runActions(page, steps([{ ref: 'e5', click: true }, { ref: 'e9', click: true }]),
    { urlAtSnapshot: 'https://a.test/one' });
  assert.equal(r.steps[0].ok, true, 'the first click is against the tree we read');
  assert.equal(r.steps[1].ok, false);
  assert.equal(r.steps[1].code, 'EREFSTALE');
  assert.match(r.steps[1].error, /https:\/\/a\.test\/one/);
  assert.match(r.steps[1].error, /https:\/\/a\.test\/two/);
  assert.equal(r.navigated, true);
  assert.equal(r.urlAfter, 'https://a.test/two');
});

test('a selector step is unaffected by navigation, because a selector is not a ref', async () => {
  const page = fakePage({ urls: ['https://a.test/one', 'https://a.test/two'], clickNavigates: true });
  const r = await runActions(page, steps([{ ref: 'e5', click: true }, { selector: '#next', click: true }]),
    { urlAtSnapshot: 'https://a.test/one' });
  assert.equal(r.ok, true);
  assert.equal(r.steps[1].targetKind, 'selector');
});

test('allowStaleRefs is the caller taking the risk on purpose', async () => {
  const page = fakePage({ urls: ['https://a.test/one', 'https://a.test/two'], clickNavigates: true });
  const r = await runActions(page, steps([{ ref: 'e5', click: true }, { ref: 'e9', click: true }]),
    { urlAtSnapshot: 'https://a.test/one', allowStaleRefs: true });
  assert.equal(r.ok, true);
});

test('stopOnError skips the rest and says so; false runs everything', async () => {
  const mk = () => fakePage({ throws: { click: 'boom' } });
  const stop = await runActions(mk(), steps([{ ref: 'e1', click: true }, { ref: 'e2', hover: true }]), {});
  assert.equal(stop.steps[1].code, 'ESKIP');
  assert.equal(stop.ran, 0);
  const go = await runActions(mk(), steps([{ ref: 'e1', click: true }, { ref: 'e2', hover: true }]), { stopOnError: false });
  assert.equal(go.steps[1].ok, true);
  assert.equal(go.ok, false, 'one failure still fails the run');
});

test('a step past the deadline is EDEADLINE, so a half-run is visible', async () => {
  const page = fakePage();
  const r = await runActions(page, steps([{ ref: 'e1', click: true }]), { deadlineAt: Date.now() - 1 });
  assert.equal(r.steps[0].code, 'EDEADLINE');
  assert.equal(page.calls.filter((c) => c.on === 'locator').length, 0, 'nothing was touched');
});

test('a hostile target cannot break out of the generated script', () => {
  const nasty = 'a"b\\\\c\nd\u0027e';
  const src = compile(validateJob({ urls: ['https://a.test'], actions: [{ selector: nasty, click: true }] }));
  assert.equal(src.includes('\n' + 'd' + "'" + 'e'), false, 'a raw newline must not land in the source');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction('openTab,snapshot,closeTab,sleep,pwd,console', src),
    'the compiled script must still parse');
  const job = JSON.parse(src.slice(src.indexOf('const JOB = ') + 12, src.indexOf(';\n', src.indexOf('const JOB = '))));
  assert.equal(job.actions[0].target, nasty, 'the target survives intact as data');
});

test('the step runner is injected into both generated scripts, not copied', () => {
  assert.ok(compile(validateJob({ urls: ['https://a.test'], actions: [{ ref: 'e1', click: true }] }))
    .includes('async function runActions'));
  assert.ok(compileAttach(validateAttach({ urlIncludes: 'x', actions: [{ ref: 'e1', click: true }] }))
    .includes('async function runActions'));
  assert.ok(ACTION_STEP_SRC.includes('EREFSTALE'), 'the guard travels with the code');
});

test('the capability matrix stops implying this surface cannot type', () => {
  assert.ok(CAPABILITY_MATRIX.page.absent.includes('press'), 'still absent on the page, that was true');
  assert.ok(CAPABILITY_MATRIX.locator.present.includes('press'), 'and present on the locator, that is the correction');
  for (const m of ['fill', 'hover', 'selectOption', 'focus', 'isVisible', 'boundingBox']) {
    assert.ok(CAPABILITY_MATRIX.locator.present.includes(m), m + ' was measured present on the locator');
  }
  assert.match(CAPABILITY_MATRIX.locator.note, /calling and catching/);
  assert.match(CAPABILITY_MATRIX.locator.refs, /f1e1/);
});

// ---------------------------------------------------------------------------
// Regressions from the independent audit of cca7797. Every one of these was
// reproducible against the shipped code and none were covered by the tests above.
// ---------------------------------------------------------------------------

test('a dollar sequence in a target or value survives compilation intact', () => {
  // String.prototype.replace substitutes $&, $` and $' in the REPLACEMENT, after
  // JSON.stringify has already escaped the data. fill:'a$&b' typed a__JOB__b into the
  // page: parsed fine, silently wrong. A function replacer disables that.
  const payloads = ['a$&b', "x$'y", 'p$`q', '$$$&$`', 'tail$'];
  for (const value of payloads) {
    const src = compile(validateJob({ urls: ['https://a.test'], actions: [{ ref: 'e1', fill: value }] }));
    const start = src.indexOf('const JOB = ');
    const job = JSON.parse(src.slice(start + 12, src.indexOf(';\n', start)));
    assert.equal(job.actions[0].value, value, 'the value must reach the page unchanged: ' + value);
    assert.equal(src.includes('__JOB__'), false, 'the placeholder must not survive');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    assert.doesNotThrow(() => new AsyncFunction('openTab,snapshot,closeTab,sleep,pwd,console', src), value);
  }
});

test('the same dollar sequences survive through compileAttach', () => {
  const src = compileAttach(validateAttach({ urlIncludes: 'x', actions: [{ selector: "a$'b", click: true }] }));
  assert.ok(src.includes("a$'b"), 'the selector reaches the script as written');
  assert.equal(src.includes('__REQ__'), false);
});

test('a fingerprint catches a renumbering that never changed the url', async () => {
  // The url-only guard cannot see this, and this is the dangerous case: the ref still
  // resolves and now names a different element, so Aside does not complain either.
  const page = fakePage({ urls: ['https://app.test/#dash'] });
  const r = await runActions(page, steps([{ ref: 'e7', click: true }]), {
    urlAtSnapshot: 'https://app.test/#dash',
    refsFingerprint: 'r12-abc',
    fingerprintOf: async () => 'r12-zzz',
  });
  assert.equal(r.steps[0].ok, false);
  assert.equal(r.steps[0].code, 'EREFSTALE');
  assert.match(r.steps[0].error, /renumbered/);
  assert.equal(r.steps[0].refGuard, 'fingerprint');
  assert.equal(page.calls.filter((c) => c.on === 'locator').length, 0, 'nothing was clicked');
});

test('a matching fingerprint lets the step through and is only checked once', async () => {
  let calls = 0;
  const page = fakePage({ urls: ['https://app.test/#dash'] });
  const r = await runActions(page, steps([{ ref: 'e1', click: true }, { ref: 'e2', hover: true }]), {
    urlAtSnapshot: 'https://app.test/#dash',
    refsFingerprint: 'r12-abc',
    fingerprintOf: async () => { calls += 1; return 'r12-abc'; },
  });
  assert.equal(r.ok, true);
  assert.equal(calls, 1, 're-snapshotting per step would cost more than the actions');
});

test('the guard names its own strength instead of implying a guarantee', async () => {
  const weak = await runActions(fakePage(), steps([{ ref: 'e1', click: true }]), { urlAtSnapshot: 'https://a.test/one' });
  assert.equal(weak.refGuard, 'url-only');
  assert.equal(weak.steps[0].refGuard, 'url-only');
  const strong = await runActions(fakePage(), steps([{ ref: 'e1', click: true }]), {
    urlAtSnapshot: 'https://a.test/one', refsFingerprint: 'f', fingerprintOf: async () => 'f',
  });
  assert.equal(strong.refGuard, 'fingerprint');
});

test('an unreadable page fails the ref step closed, it does not disable the guard', async () => {
  const page = fakePage();
  page.evaluate = async () => { throw new Error('Execution context was destroyed'); };
  const r = await runActions(page, steps([{ ref: 'e1', click: true }]), { urlAtSnapshot: 'https://a.test/one' });
  assert.equal(r.steps[0].ok, false);
  assert.equal(r.steps[0].code, 'EREFUNKNOWN');
  assert.equal(page.calls.filter((c) => c.on === 'locator').length, 0);
});

test('a step that overruns is cut off instead of running past the budget', async () => {
  const page = fakePage({ slow: { click: 400 } });
  const t0 = Date.now();
  const r = await runActions(page, steps([{ ref: 'e1', click: true, timeoutMs: 60 }]), {});
  assert.equal(r.steps[0].ok, false);
  assert.equal(r.steps[0].code, 'ESTEPTIMEOUT');
  assert.ok(Date.now() - t0 < 350, 'the deadline used to be checked only BETWEEN steps');
});

test('running out of budget reports EDEADLINE on every unreached step, not ESKIP', async () => {
  const page = fakePage({ slow: { click: 80 } });
  const r = await runActions(page, steps([
    { ref: 'e1', click: true }, { ref: 'e2', click: true }, { ref: 'e3', click: true },
  ]), { deadlineAt: Date.now() + 40 });
  const codes = r.steps.map((s) => s.code);
  assert.equal(codes.includes('ESKIP'), false, 'no step failed, the clock ran out');
  assert.ok(codes.every((c) => c === 'EDEADLINE' || c === 'ESTEPTIMEOUT' || c === undefined));
});

test('a broken page script is not recorded as a missing capability', async () => {
  // window.gtag is not a function is the PAGE's bug. Labelling it ENOTSUP would poison
  // the capability knowledge this module exists to keep honest.
  const page = fakePage();
  page.evaluate = async (expr) => {
    if (expr === 'location.href') return 'https://a.test/one';
    throw new Error('window.gtag is not a function');
  };
  const r = await runActions(page, steps([{ scroll: 'bottom' }]), {});
  assert.equal(r.steps[0].code, 'EACTION', 'the page failed, not the surface');
});

test('V8 phrasing for a missing method is still ENOTSUP', async () => {
  const page = fakePage({ throws: { selectOption: "Cannot read properties of undefined (reading 'selectOption')" } });
  const r = await runActions(page, steps([{ ref: 'e1', selectOption: 'b' }]), {});
  assert.equal(r.steps[0].code, 'ENOTSUP');
  const ni = fakePage({ throws: { press: 'locator.press: Not implemented' } });
  const r2 = await runActions(ni, steps([{ ref: 'e1', press: 'Enter' }]), {});
  assert.equal(r2.steps[0].code, 'ENOTSUP');
});

test('a value-less verb demands the affirmative', () => {
  assert.throws(() => steps([{ ref: 'e1', click: false }]), /takes no value/);
  assert.throws(() => steps([{ ref: 'e1', click: null }]), /takes no value/);
  assert.doesNotThrow(() => steps([{ waitFor: '.x' }]), 'waitFor carries its selector, not a flag');
  assert.equal(steps([{ ref: 'e1', click: true, timeoutMs: 500 }])[0].timeoutMs, 500);
});

test('the action budget always ends before the script deadline that would drop the item', () => {
  const src = compile(validateJob({ urls: ['https://a.test'], actions: [{ ref: 'e1', click: true }] }));
  assert.ok(src.includes('ACTION_HARD_STOP_AT'));
  assert.ok(src.includes('ACTION_RESERVE_MS'));
  assert.ok(src.includes('actionDeadlineNow()'), 'per item, not one constant for the batch');
  const reserve = /ACTION_RESERVE_MS = Math\.max\(1500/.test(src);
  assert.ok(reserve, 'the reserve must be non-zero or the item is lost with its side effect');
});

test('attach refuses to call a run ok when its actions failed', async () => {
  const session = {
    raw: async () => ({ rows: [{ kind: 'page', tab: { targetId: 'B' }, href: 'https://a/', title: 't',
      render: { textChars: 9, reasons: [], requiredSelectorsMatched: [], requiredSelectorsMissing: [], sample: 'x', stage: 'pre-actions' },
      contentVerified: null, actions: [{ i: 0, verb: 'click', ok: false, code: 'EACTION' }], actionsOk: false, refGuard: 'url-only' }] }),
  };
  const a = createAttach({ config: { browseCaps: { enabled: true } }, session });
  const r = await a.attach({ urlIncludes: 'x', actions: [{ ref: 'e1', click: true }] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EACTION');
  assert.equal(r.refGuard, 'url-only');
  assert.equal(r.render.stage, 'pre-actions');
});

test('attach gives the repl longer than the action budget it just granted', async () => {
  const seen = [];
  const session = { raw: async (_src, opts) => { seen.push(opts.hostMs); return { rows: [] }; } };
  const a = createAttach({ config: { browseCaps: { enabled: true } }, session });
  await a.attach({ urlIncludes: 'x', actionBudgetMs: 60000, actions: [{ ref: 'e1', click: true }] });
  assert.ok(seen[0] > 60000, 'a 60s budget under a 26.5s host deadline loses the whole report');
  assert.ok(seen[0] <= 120000, 'and it still has to fit the REPL cap');
});
