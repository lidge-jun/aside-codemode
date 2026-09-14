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
import { compileAttach } from '../src/host/browse/attach.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';
import { CAPABILITY_MATRIX } from '../src/host/browse/probe.js';

function fakePage(opts = {}) {
  const calls = [];
  const urls = opts.urls || ['https://a.test/one'];
  let idx = 0;
  const missing = new Set(opts.missing || []);
  const throws = opts.throws || {};
  const locator = (target) => new Proxy({}, {
    get(_t, name) {
      if (missing.has(name)) return undefined;
      return async (...args) => {
        calls.push({ on: 'locator', target, name, args });
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

