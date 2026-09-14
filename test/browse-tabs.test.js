// The pool bounds workers, not tabs. A close that throws skips markClosed, leaves the
// tab open, and the worker immediately opens another - so the ceiling has to be counted,
// and counted at INTENT or four workers all read owned() === 0 and all four open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, summarizeTree } from '../src/host/browse/script.js';
import { validateJob, SLACK_MS } from '../src/host/browse/schema.js';

const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;

async function runCompiled(src, makePage, opts = {}) {
  const printed = [];
  const live = { count: 0, peak: 0 };
  const fn = new AsyncFn('openTab', 'snapshot', 'closeTab', 'sleep', 'pwd', 'console', src);
  await fn(
    async (url) => {
      if (opts.openThrowsSync) throw new Error('synchronous openTab failure');
      if (opts.openRejects) throw new Error('EOPEN simulated');
      live.count += 1;
      if (live.count > live.peak) live.peak = live.count;
      return makePage(url, live);
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

