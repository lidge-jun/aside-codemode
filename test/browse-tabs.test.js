// The pool bounds workers, not tabs. A close that throws skips markClosed, leaves the
// tab open, and the worker immediately opens another - so the ceiling has to be counted,
// and counted at INTENT or four workers all read owned() === 0 and all four open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, summarizeTree, WIRE_LIMIT, WIRE_LIMIT_PORTABLE } from '../src/host/browse/script.js';
import { ACTION_STEP_SRC } from '../src/host/browse/actions-run.js';
import { validateJob, SLACK_MS } from '../src/host/browse/schema.js';

const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;

async function runCompiled(src, makePage, opts = {}) {
  const printed = [];
  const live = { count: 0, peak: 0 };
  const fn = new AsyncFn('openTab', 'snapshot', 'closeTab', 'sleep', 'pwd', 'console', src);
  await fn(
    // Plain, not async: an async function turns openThrowsSync into a rejected promise and
    // the script's synchronous catch — the one this file claims to test — is never entered.
    (url) => {
      if (opts.openThrowsSync) throw new Error('synchronous openTab failure');
      if (opts.openRejects) return Promise.reject(new Error('EOPEN simulated'));
      // An open that never answers: the tab may or may not exist, which is the case the
      // cleanup cap has to report rather than guess at.
      if (opts.openHangs) return new Promise(() => {});
      live.count += 1;
      if (live.count > live.peak) live.peak = live.count;
      return Promise.resolve(makePage(url, live));
    },
    async () => ({ tree: '- button "b" [ref=e1]' }),
    async () => {},
    (ms) => new Promise((r) => setTimeout(r, ms)),
    '/tmp',
    { log: (s) => printed.push(s) },
  );
  for (let i = printed.length - 1; i >= 0; i -= 1) {
    try { const o = JSON.parse(printed[i]); if (o && o.type === 'final') return { out: o, live }; } catch { /* not it */ }
  }
  return { out: null, live };
}

function makePage(opts = {}) {
  return (url, live) => ({
    url: async () => url,
    title: async () => 't',
    waitForLoadState: async () => { await new Promise((r) => setTimeout(r, opts.holdMs || 30)); },
    waitForSelector: async () => {},
    evaluate: async (arg) => {
      if (typeof arg === 'function') {
        if (String(arg).includes('location.href')) return url;
        return { textChars: 400, rawChars: 400, scriptChars: 0, skeletonNodes: 0, sample: 'x', requiredSelectorsMatched: [], requiredSelectorsMissing: [], data: {}, missing: [] };
      }
      if (arg === 'location.href') return url;
      return null;
    },
    locator: () => new Proxy({}, { get: () => async () => {} }),
    close: async () => {
      if (opts.closeThrows) throw new Error('close refused');
      if (opts.closeHangs) { await new Promise(() => {}); }
      live.count -= 1;
    },
  });
}

const urls = (n) => Array.from({ length: n }, (_, i) => 'https://a.test/' + i);

test('a batch larger than the budget still returns every url, and never exceeds it', async () => {
  const src = compile(validateJob({ urls: urls(12), concurrency: 4, timeoutMs: 20000 }, { maxTabs: 2, concurrency: 4 }));
  const { out, live } = await runCompiled(src, makePage());
  assert.equal(out.items.length, 12, 'every url is reported');
  assert.equal(out.items.filter((i) => i.ok).length, 12, 'and every one of them actually ran');
  assert.ok(live.peak <= 2, 'real concurrent tabs must respect maxTabs, got ' + live.peak);
  assert.ok(out.tabs.peak <= out.tabs.max, 'reported peak ' + out.tabs.peak + ' max ' + out.tabs.max);
  assert.equal(out.tabs.max, 2);
});

test('the counter moves at intent, so workers entering together cannot all open', async () => {
  // With a counter that moved at success, four workers would each read owned() === 0
  // before any of them resolved, and peak would reach 4. This is that regression.
  const src = compile(validateJob({ urls: urls(8), concurrency: 4, timeoutMs: 20000 }, { maxTabs: 1, concurrency: 4 }));
  const { out, live } = await runCompiled(src, makePage({ holdMs: 60 }));
  assert.equal(live.peak, 1, 'maxTabs 1 means one tab at a time, got ' + live.peak);
  assert.equal(out.items.filter((i) => i.code === 'ETABBUDGET').length, 0,
    'the wait is bounded by the item deadline, not a slice count, so nothing is refused for no reason');
});

test('a close that throws is not counted as closed and surfaces as a leak', async () => {
  const src = compile(validateJob({ urls: urls(2), concurrency: 1, timeoutMs: 8000 }, { maxTabs: 4, concurrency: 1 }));
  const { out } = await runCompiled(src, makePage({ closeThrows: true }));
  assert.equal(out.tabs.closed, 0, 'a refused close must never decrement');
  assert.ok(out.leakedUrls.length >= 1, 'and the tab must be reported as leaked');
  assert.ok(out.tabs.leaked >= 1);
});

test('a request that never became a tab gives its slot back', async () => {
  const src = compile(validateJob({ urls: urls(3), concurrency: 1, timeoutMs: 8000 }, { maxTabs: 1, concurrency: 1 }));
  const { out } = await runCompiled(src, makePage(), { openRejects: true });
  assert.equal(out.items.length, 3, 'without the rollback the pool wedges after the first failure');
  assert.ok(out.items.every((i) => i.code === 'EOPEN'));
  assert.equal(out.tabs.requested, 0, 'every request was rolled back');
  // wp4: a request that was refused is not a tab, and calling it a leak would send the
  // caller looking for something that never existed.
  assert.deepEqual(out.leakedUrls, [], 'a refused open is not a leaked tab');
});

// wp2: the refusal is a result like any other, so it has to name the request it refused.
// Without the id the host counts a skipped url as one that never came back at all.
test('a url refused by the tab budget still names its own request', async () => {
  const job = validateJob({ urls: urls(2), concurrency: 1, timeoutMs: 500 }, { maxTabs: 1, concurrency: 1 });
  const plan = [
    { url: job.urls[0], timeoutMs: 500, waitSelector: null, skip: false, jobId: 'j000' },
    { url: job.urls[1], timeoutMs: 1, waitSelector: null, skip: false, jobId: 'j001' },
  ];
  // A close that throws keeps the first tab owned, so the second url meets a full budget.
  const { out } = await runCompiled(compile(job, plan), makePage({ closeThrows: true }));
  const refused = out.items.find((i) => i.code === 'ETABBUDGET');
  assert.ok(refused, 'the second url must be refused by the budget');
  assert.equal(refused.jobId, 'j001');
  assert.equal(out.items.find((i) => i.jobId === 'j000').jobId, 'j000');
});

test('a synchronous openTab throw does not leave the counter permanently high', async () => {
  const src = compile(validateJob({ urls: urls(2), concurrency: 1, timeoutMs: 8000 }, { maxTabs: 1, concurrency: 1 }));
  const { out } = await runCompiled(src, makePage(), { openThrowsSync: true });
  assert.ok(out, 'the script must still print');
  assert.equal(out.tabs.requested, 0);
  assert.equal(out.items.length, 2);
});

test('a close that hangs costs one tab, not the whole run', async () => {
  const src = compile(validateJob({ urls: urls(2), concurrency: 1, timeoutMs: 9000 }, { maxTabs: 4, concurrency: 1 }));
  const t0 = Date.now();
  const { out } = await runCompiled(src, makePage({ closeHangs: true }));
  assert.ok(out, 'the payload must still be printed');
  assert.ok(Date.now() - t0 < 9000, 'the worker must be released by the per-close cap');
  assert.equal(out.items.length, 2, 'the second url must still be attempted');
  // wp4: a hung close used to run markClosed anyway, so the counter said the tab was gone
  // while it was still open and the next worker took the slot.
  assert.equal(out.tabs.closed, 0, 'a hang is not a close');
  assert.equal(out.leakedUrls.length, 2, 'a tab we could not close has to be named');
});

test('an open that never answers is named as a possible leak, once per request', async () => {
  // Two requests for the SAME url, both still opening when the budget expires. Keying the
  // report by url would collapse them into one and understate what may be open.
  const src = compile(validateJob({ urls: ['https://a.test/0', 'https://a.test/0'], concurrency: 2, timeoutMs: 700 }, { maxTabs: 4, concurrency: 2 }));
  const { out } = await runCompiled(src, makePage(), { openHangs: true });
  assert.ok(out, 'the payload must still be printed');
  assert.equal(out.leakedUrls.length, 2, 'two in-flight opens are two possible tabs');
});

test('a hung close leaves the tab open, and the run says so instead of counting it gone', async () => {
  const src = compile(validateJob({ urls: urls(2), concurrency: 1, timeoutMs: 9000 }, { maxTabs: 4, concurrency: 1 }));
  const { out, live } = await runCompiled(src, makePage({ closeHangs: true }));
  assert.equal(live.count, 2, 'the fake browser still holds both tabs');
  assert.equal(out.tabs.closed, 0);
  assert.equal(out.leakedUrls.length, 2);
});

test('the cleanup budget is derived from the host deadline, not the script clock', () => {
  const src = compile(validateJob({ urls: urls(1) }));
  assert.ok(src.includes('JOB.hostDeadlineAt'), 'the script must not re-anchor to its own start');
  assert.match(src, /"hostDeadlineAt":\d+/);
  assert.ok(src.includes('Promise.allSettled(closes)'), 'closes run concurrently under one budget');
  assert.equal(typeof SLACK_MS, 'number');
});

test('the provably dead guard branch is gone from the shipped script', () => {
  const src = compile(validateJob({ urls: urls(1), actions: [{ ref: 'e1', click: true }] }));
  assert.equal(src.includes('verifiedClean'), false, 'a comment is a weaker guard than absence');
});

// What session.run() actually hands to compile(): the issued runId on the job, and a plan
// whose rows come from the circuit breaker and then get a jobId each. Measuring
// compile(validateJob(job)) instead understates the source that travels by 338 characters
// on a twenty-url batch, which is how the job this file used to call the fullest legal one
// was 189 characters over the limit while the suite called it green.
function hostSource(raw) {
  const job = validateJob(raw);
  const plan = job.urls.map((url, i) => ({
    url,
    timeoutMs: job.timeoutMs,
    waitSelector: job.waitSelector,
    skip: false,
    breaker: 'closed',
    jobId: 'j' + String(i).padStart(3, '0'),
  }));
  return compile({ ...job, runId: 'run-0199c3a1-4f6e-7bb2-9c3d-5a7e1f2b8d40' }, plan);
}

const ACTING = {
  urls: urls(20), snapshot: 'interactive', refsFingerprint: 'f', snapshotAfter: true,
  actions: [{ ref: 'e1', click: true }],
};
const READING = {
  urls: urls(20), snapshot: 'interactive', refsFingerprint: 'f', extract: { a: { ref: 'e1' } },
};

test('the portable envelope fits the tightest command line any host has', () => {
  // Found live, not in a unit test: with both helpers always injected the script reached
  // 34,881 characters and every browse job on the Windows host died with spawn
  // ENAMETOOLONG. Windows caps a whole command line at 32,767, which is where the 30,000
  // portable budget comes from; no other platform is close to it.
  //
  // These jobs are the envelope this tool promises everywhere, not the largest ones the
  // schema accepts. A ref read cannot share a call with actions, so no single job carries
  // both helpers.
  const cases = {
    plain: hostSource({ urls: urls(1) }),
    twenty: hostSource({ urls: urls(20) }),
    snapshot: hostSource({ urls: urls(1), snapshot: 'interactive' }),
    actions: hostSource({ urls: urls(1), actions: [{ ref: 'e1', click: true }] }),
    both: hostSource({ urls: urls(1), snapshot: 'interactive', refsFingerprint: 'f', actions: [{ ref: 'e1', click: true }] }),
    acting: hostSource(ACTING),
    reading: hostSource(READING),
  };
  for (const [name, src] of Object.entries(cases)) {
    assert.ok(src.length <= WIRE_LIMIT_PORTABLE,
      name + ' is ' + src.length + ' characters, ' + (src.length - WIRE_LIMIT_PORTABLE)
      + ' over the ' + WIRE_LIMIT_PORTABLE + ' portable budget');
    assert.doesNotThrow(() => new AsyncFn('openTab,snapshot,closeTab,sleep,pwd,console', src), name + ' must still parse');
  }
  // Said in characters on purpose. Twice in one branch a change crossed the limit by a
  // single character and the failure named a length without naming what was left.
  const headroom = WIRE_LIMIT_PORTABLE - cases.acting.length;
  assert.ok(headroom >= 1000,
    'the fullest portable job has ' + headroom + ' characters of headroom, under the 1000 this'
    + ' budget keeps for the next in-script change');
});

test('the combinations outside the envelope depend on the platform, and say so when refused', () => {
  // The schema accepts these and they do not fit 30,000 by thousands of characters. On a
  // host whose command line is measured in hundreds of kilobytes that ceiling was borrowed
  // grief: helper:true simply could not be used with a full batch. The cap is the
  // platform's now, and what falls outside it is refused by name rather than by the OS.
  const beyond = {
    twentyActions: hostSource({ ...ACTING, actions: Array.from({ length: 20 }, () => ({ ref: 'e1', click: true })) }),
    helper: hostSource({ ...ACTING, helper: true }),
    treeNodes: hostSource({ ...ACTING, treeNodes: true }),
  };
  const names = Object.keys(beyond);
  assert.ok(names.length > 0, 'the sweep needs cases before it can mean anything');
  for (const name of names) {
    assert.ok(beyond[name].length > WIRE_LIMIT_PORTABLE,
      name + ' is ' + beyond[name].length + ' characters and no longer belongs in this sweep');
    assert.ok(beyond[name].length <= 50000,
      name + ' is ' + beyond[name].length + ' characters, past the 50000 a roomy command line allows');
  }
  assert.equal(WIRE_LIMIT, process.platform === 'win32' ? 30000 : 50000);
});

test('the action helper ships without its indentation', () => {
  // stripForWire deliberately keeps indentation, because the main template holds multi-line
  // template literals whose leading spaces are part of a string. This fragment holds none,
  // which is what makes dedenting it safe and worth 1,024 characters. If a backtick ever
  // appears here that reasoning stops holding, so the guard is the assertion rather than a
  // comment.
  assert.equal(ACTION_STEP_SRC.includes(String.fromCharCode(96)), false,
    'ACTION_STEP_SRC is dedented on the way out; a template literal inside it would have its'
    + ' own leading spaces eaten');
  assert.equal(/^ /m.test(ACTION_STEP_SRC), false, 'no line of the shipped fragment starts with a space');
});

test('only the helpers the job can reach are shipped', () => {
  const plain = compile(validateJob({ urls: urls(1) }));
  assert.equal(plain.includes('function summarizeTree'), false, 'no snapshot asked, no tree code');
  assert.equal(plain.includes('async function runActions'), false, 'no actions asked, no action code');
  const acting = compile(validateJob({ urls: urls(1), actions: [{ ref: 'e1', click: true }] }));
  assert.ok(acting.includes('async function runActions'));
  assert.ok(compile(validateJob({ urls: urls(1), refsFingerprint: 'f', actions: [{ ref: 'e1', click: true }] })).includes('function summarizeTree'),
    'a fingerprint guard needs the summariser even without a snapshot option');
});

test('stripping for the wire removes comments and nothing else', () => {
  const src = compile(validateJob({ urls: urls(1), snapshot: 'tree' }));
  for (const line of src.split('\n')) {
    assert.equal(line.trim().startsWith('//'), false, 'a whole-line comment survived: ' + line);
    assert.notEqual(line.trim(), '', 'a blank line survived');
  }
  assert.ok(src.includes('https://'), 'a // inside a string must not be touched');
  assert.ok(src.includes('  '), 'indentation is preserved, so template literals are safe');
});
