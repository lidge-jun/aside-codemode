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
  assert.ok(compile(validateJob({ urls: ['https://a.test'], refsFingerprint: 'r1-test', actions: [{ ref: 'e1', click: true }] }))
    .includes('async function runActions'));
  assert.ok(compileAttach(validateAttach({ urlIncludes: 'x', refsFingerprint: 'r1-test', actions: [{ ref: 'e1', click: true }] }))
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
    const src = compile(validateJob({ urls: ['https://a.test'], refsFingerprint: 'r1-test', actions: [{ ref: 'e1', fill: value }] }));
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
  assert.match(r.steps[0].error, /the tree changed/);
  assert.equal(r.steps[0].refGuard, 'fingerprint');
  assert.equal(page.calls.filter((c) => c.on === 'locator').length, 0, 'nothing was clicked');
});

test('a ref step AFTER a mutating step is re-checked, not waved through', async () => {
  // The second audit round: checking once meant step 1's click could renumber the tree and
  // step 2 got only a url check while still being labelled fingerprint.
  let n = 0;
  const page = fakePage({ urls: ['https://app.test/#dash'] });
  const r = await runActions(page, steps([{ ref: 'e1', click: true }, { ref: 'e2', hover: true }]), {
    urlAtSnapshot: 'https://app.test/#dash',
    refsFingerprint: 'r12-abc',
    fingerprintOf: async () => { n += 1; return n === 1 ? { full: 'r12-abc' } : { full: 'r19-zzz' }; },
  });
  assert.equal(n, 2, 'the click marked the tree dirty, so the next ref step must re-check');
  assert.equal(r.steps[0].ok, true);
  assert.equal(r.steps[1].ok, false);
  assert.equal(r.steps[1].code, 'EREFSTALE');
});

test('no ref step is ever waved through, whatever sits between them', async () => {
  // Every ref-targeted verb mutates, so today a check always precedes every ref step. That
  // is the property that matters and the one round 2 broke. __INERT exists for the
  // read-only ref reads planned in 030; until then it is deliberately minimal, because
  // scroll mounts rows on an infinite list, waitFor succeeds BECAUSE the dom changed, and
  // waitForLoadState waits for content to arrive.
  const count = async (list) => {
    let n = 0;
    const page = fakePage({ urls: ['https://app.test/#dash'] });
    const r = await runActions(page, steps(list), {
      urlAtSnapshot: 'https://app.test/#dash',
      refsFingerprint: 'r12-abc',
      fingerprintOf: async () => { n += 1; return { full: 'r12-abc' }; },
    });
    return { checks: n, refSteps: r.steps.filter((s) => s.targetKind === 'ref').length, guards: r.refGuards };
  };
  const lists = [
    [{ ref: 'e1', hover: true }, { sleepMs: 5 }, { ref: 'e2', hover: true }],
    [{ ref: 'e1', hover: true }, { scroll: 'bottom' }, { ref: 'e2', hover: true }],
    [{ ref: 'e1', hover: true }, { waitForLoadState: 'stable' }, { ref: 'e2', hover: true }],
    [{ ref: 'e1', hover: true }, { selector: '#x', click: true }, { ref: 'e2', hover: true }],
    [{ ref: 'e1', click: true }, { ref: 'e2', click: true }, { ref: 'e3', click: true }],
  ];
  for (const list of lists) {
    const got = await count(list);
    assert.equal(got.checks, got.refSteps, 'one check per ref step: ' + JSON.stringify(list));
    assert.ok(got.guards.every((g) => g === 'fingerprint'), 'and each labelled with what it got');
  }
  assert.equal(Object.keys({ sleepMs: 1 }).length, 1);
});

test('the structure fingerprint survives text that moves on its own', async () => {
  const page = fakePage();
  const r = await runActions(page, steps([{ ref: 'e1', click: true }]), {
    refsFingerprint: 's4-abc',
    fingerprintOf: async () => ({ full: 'r4-changed-by-a-clock', structure: 's4-abc' }),
  });
  assert.equal(r.ok, true, 'a clock in an accessible name must not refuse every ref forever');
});

test('refsFingerprint without a way to recompute it reports the weaker guard', async () => {
  const page = fakePage();
  const r = await runActions(page, steps([{ ref: 'e1', click: true }]), {
    urlAtSnapshot: 'https://a.test/one', refsFingerprint: 'r1-aaa',
  });
  assert.equal(r.steps[0].refGuard, 'url-only', 'it must not claim the strong guard it cannot run');
});

test('a ref step measures how stale its authorisation already was', async () => {
  // The check and the verb are not atomic and cannot be made so. Reporting zero, or
  // reporting nothing, would imply otherwise.
  const page = fakePage();
  const r = await runActions(page, steps([{ ref: 'e1', click: true }]), {
    refsFingerprint: 'f',
    fingerprintOf: async () => { await new Promise((res) => setTimeout(res, 25)); return { full: 'f' }; },
  });
  assert.equal(r.ok, true);
  assert.equal(typeof r.steps[0].guardAgeMs, 'number');
  assert.ok(r.steps[0].guardAgeMs >= 0, 'the window is measured, not assumed away');
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
  assert.ok(codes.includes('EDEADLINE'), 'the clock genuinely ran out');
  assert.ok(codes.every((c) => c === 'EDEADLINE' || c === 'ESTEPTIMEOUT'),
    'every step must be accounted for, got ' + JSON.stringify(codes));
});

test("one step's own timeout is not reported as the shared budget running out", async () => {
  const page = fakePage({ slow: { click: 400 } });
  const r = await runActions(page, steps([{ ref: 'e1', click: true, timeoutMs: 40 }, { ref: 'e2', hover: true }]), {
    deadlineAt: Date.now() + 10000,
  });
  assert.equal(r.steps[0].code, 'ESTEPTIMEOUT');
  assert.equal(r.steps[1].code, 'ESKIP');
  assert.match(r.steps[1].error, /own timeoutMs/);
  assert.equal(/budget ran out/.test(r.steps[1].error), false, 'there were ~10s left');
});

test('a missing locator or evaluate is still ENOTSUP for the verb that needed it', async () => {
  const noLoc = fakePage();
  noLoc.locator = () => { throw new Error('page.locator is not a function'); };
  const a = await runActions(noLoc, steps([{ ref: 'e1', click: true }]), {});
  assert.equal(a.steps[0].code, 'ENOTSUP', 'the most fundamental absence on this surface');
  const noEval = fakePage();
  noEval.evaluate = async (e) => { if (e === 'location.href') return 'https://a/'; throw new Error('page.evaluate is not a function'); };
  const b = await runActions(noEval, steps([{ scroll: 'bottom' }]), {});
  assert.equal(b.steps[0].code, 'ENOTSUP');
});

test('a raw line separator cannot land in the generated source', () => {
  const src = compile(validateJob({ urls: ['https://a.test'], refsFingerprint: 'r1-test', actions: [{ ref: 'e1', fill: 'a\u2028b\u2029c' }] }));
  assert.equal(src.includes('\u2028'), false, 'U+2028 must be escaped, not trusted to the REPL parser');
  assert.ok(src.includes('\\u2028'));
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

// Grepping the compiled source proves nothing about what it does. This runs it.
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
async function runCompiled(src, page, opts = {}) {
  const printed = [];
  const fn = new AsyncFn('openTab', 'snapshot', 'closeTab', 'sleep', 'pwd', 'console', src);
  await fn(
    async () => page,
    async () => ({ tree: opts.tree || '- button "b" [ref=e1]' }),
    async () => {},
    (ms) => new Promise((r) => setTimeout(r, ms)),
    '/tmp',
    { log: (s) => printed.push(s) },
  );
  for (let i = printed.length - 1; i >= 0; i -= 1) {
    try { const o = JSON.parse(printed[i]); if (o && o.type === 'final') return o; } catch { /* not it */ }
  }
  return null;
}

function compiledPage(opts = {}) {
  const seen = [];
  const slow = opts.slow || {};
  return {
    seen,
    url: async () => 'https://a.test/one',
    title: async () => 't',
    waitForLoadState: async () => {},
    waitForSelector: async () => {},
    screenshot: async () => { if (slow.screenshot) await new Promise((r) => setTimeout(r, slow.screenshot)); return Buffer.from('x'); },
    evaluate: async (arg) => {
      if (typeof arg === 'function') {
        // The template reads the url with a function too; only the render probe wants an object.
        if (String(arg).includes('location.href')) return 'https://a.test/one';
        return { textChars: 500, rawChars: 500, scriptChars: 0, skeletonNodes: 0, sample: 'x', requiredSelectorsMatched: [], requiredSelectorsMissing: [], data: {}, missing: [] };
      }
      if (arg === 'location.href') return 'https://a.test/one';
      return null;
    },
    locator: () => new Proxy({}, { get: (_t, name) => async () => { seen.push(name); } }),
  };
}

test('a capture that fits the reserve no longer loses the item it follows', async () => {
  // The reserve is derived from the work that still has to happen, so a screenshot that
  // used to eat the whole remaining budget now has room bought for it.
  const page = compiledPage({ slow: { screenshot: 3000 } });
  const src = compile(validateJob({
    urls: ['https://a.test'], timeoutMs: 4000,
    actions: [{ selector: '#go', click: true }],
    screenshot: { type: 'png' },
  }));
  const out = await runCompiled(src, page);
  assert.deepEqual(page.seen, ['click'], 'the side effect happened');
  assert.equal(out.items.length, 1, 'and the item survived to report it');
  assert.equal(out.actionLog.length, 1);
});

test('when the item IS lost, the step that already ran is still on the record', async () => {
  // No reserve can cover an arbitrarily slow capture. What must never happen is a live page
  // being clicked and the run reporting nothing at all about it.
  const page = compiledPage({ slow: { screenshot: 9000 } });
  const src = compile(validateJob({
    urls: ['https://a.test'], timeoutMs: 4000,
    actions: [{ selector: '#go', click: true }],
    screenshot: { type: 'png' },
  }));
  const out = await runCompiled(src, page);
  assert.deepEqual(page.seen, ['click'], 'the click fired');
  assert.equal(out.items.length, 0, 'and the item did not survive');
  assert.ok(out.partial.includes('inner-deadline'));
  assert.equal(out.actionLog.length, 1, 'the evidence must outlive the item');
  assert.equal(out.actionLog[0].verb, 'click');
  assert.equal(out.actionLog[0].ok, true);
});

test('the reserve grows with the work that still has to happen after the steps', () => {
  const bare = compile(validateJob({ urls: ['https://a.test'], refsFingerprint: 'r1-test', actions: [{ ref: 'e1', click: true }] }));
  const heavy = compile(validateJob({ urls: ['https://a.test'], refsFingerprint: 'r1-test', actions: [{ ref: 'e1', click: true }], screenshot: { type: 'png' }, pdf: {}, snapshot: 'tree' }));
  assert.ok(bare.includes('ACTION_RESERVE_MS'));
  assert.ok(heavy.includes('JOB.screenshot ? 3000 : 0'), 'a capture must buy itself room');
  assert.throws(() => validateJob({ urls: ['https://a.test'], timeoutMs: 1000, refsFingerprint: 'r1-test', actions: [{ ref: 'e1', click: true }] }),
    /cannot fit an action list/, 'an impossible budget is refused up front, not at runtime');
});

test('attach refuses to call a run ok when its actions failed', async () => {
  const session = {
    raw: async () => ({ rows: [{ kind: 'page', tab: { targetId: 'B' }, href: 'https://a/', title: 't',
      render: { textChars: 9, reasons: [], requiredSelectorsMatched: [], requiredSelectorsMissing: [], sample: 'x', stage: 'pre-actions' },
      contentVerified: null, actions: [{ i: 0, verb: 'click', ok: false, code: 'EACTION' }], actionsOk: false, refGuard: 'url-only' }] }),
  };
  const a = createAttach({ config: { browseCaps: { enabled: true } }, session });
  const r = await a.attach({ urlIncludes: 'x', refsFingerprint: 'r1-test', approveWrites: true, actions: [{ ref: 'e1', click: true }] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EACTION');
  assert.equal(r.refGuard, 'url-only');
  assert.equal(r.render.stage, 'pre-actions');
});

test('attach gives the repl longer than the action budget it just granted', async () => {
  const seen = [];
  const session = { raw: async (_src, opts) => { seen.push(opts.hostMs); return { rows: [] }; } };
  const a = createAttach({ config: { browseCaps: { enabled: true } }, session });
  await a.attach({ urlIncludes: 'x', actionBudgetMs: 60000, refsFingerprint: 'r1-test', approveWrites: true, actions: [{ ref: 'e1', click: true }] });
  assert.ok(seen[0] > 60000, 'a 60s budget under a 26.5s host deadline loses the whole report');
  assert.ok(seen[0] <= 120000, 'and it still has to fit the REPL cap');
});
