// C5 acceptance. This RUNS the compiled script with fake Aside globals instead of
// grepping it, because the failure it guards against — a tab opened after the inner
// deadline — is a behaviour, and 003 C5 explicitly refuses a grep as proof.
//
// No wall clock is used as an oracle: the fake `sleep` hands back a promise this test
// resolves by hand, so the deadline fires exactly when the test says it does.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compile, deadlineMath, SLACK_MS } from '../src/host/browse/script.js';
import { validateJob } from '../src/host/browse/schema.js';

function makePage(targetId) {
  const page = {
    targetId,
    closed: false,
    async url() { return 'https://' + String(targetId).replace(/^https?:\/\//, ''); },
    async title() { return 'Example'; },
    async waitForLoadState() {},
    async waitForSelector() {},
    async screenshot() { return Buffer.alloc(10); },
    async pdf() { return Buffer.alloc(10); },
    async close() { page.closed = true; },
  };
  return page;
}

function runScript(source, { openTab, sleep }) {
  const lines = [];
  const ctx = vm.createContext({
    openTab,
    sleep,
    snapshot: async () => ({ tree: 'x', refs: [], diff: '' }),
    console: { log: (s) => lines.push(String(s)) },
    Buffer,
    setTimeout,
    Promise,
    JSON,
  });
  const done = vm.runInContext('(async () => {' + source + '})()', ctx);
  return { done, payload: () => JSON.parse(lines[lines.length - 1]) };
}

const job = (urls) => validateJob({ urls, timeoutMs: 5000, concurrency: 1 });

test('deadlineMath keeps the inner deadline below the host deadline', () => {
  const d = deadlineMath(5000);
  assert.equal(d.innerMs, 5000);
  assert.equal(d.hostMs, 5000 + SLACK_MS);
  assert.ok(d.innerMs < d.hostMs);
});

test('a clean run closes every tab and reports an empty leakedUrls', async () => {
  const pages = [];
  const { done, payload } = runScript(compile(job(['https://a.test', 'https://b.test'])), {
    openTab: async (url) => { const p = makePage(url); pages.push(p); return p; },
    sleep: () => new Promise(() => {}),
  });
  await done;
  const out = payload();
  assert.equal(out.leakedUrls.length, 0, 'a clean run must not report a leak');
  assert.deepEqual(out.partial, []);
  assert.equal(out.items.length, 2);
  assert.ok(pages.every((p) => p.closed), 'every opened page must be closed');
});

test('a page that resolves AFTER the inner deadline is still closed', async () => {
  // The leak this guards is permanent: 001 E5 measured that a tab surviving the CLI
  // cannot be closed by any later session.
  let releaseSlow;
  let releaseDeadline;
  const slow = makePage('slow');
  const { done, payload } = runScript(compile(job(['https://slow.test'])), {
    openTab: () => new Promise((res) => { releaseSlow = () => res(slow); }),
    sleep: () => new Promise((res) => { releaseDeadline = res; }),
  });
  await new Promise((r) => setImmediate(r));
  releaseDeadline();
  await new Promise((r) => setImmediate(r));
  assert.equal(slow.closed, false, 'precondition: the page has not resolved yet');
  releaseSlow();
  await done;
  assert.equal(slow.closed, true, 'a late page must still be closed');
  assert.equal(payload().leakedUrls.length, 0);
});

test('one failing url does not empty the other results', async () => {
  const { done, payload } = runScript(compile(job(['https://ok.test', 'https://bad.test'])), {
    openTab: async (url) => { if (url.includes('bad')) throw new Error('boom'); return makePage(url); },
    sleep: () => new Promise(() => {}),
  });
  await done.catch(() => {});
  const out = payload();
  assert.ok(out.items.some((i) => i.ok), 'the healthy url must still report a result');
});

test('the compiled source never reaches for an API Aside does not have', () => {
  const src = compile(job(['https://a.test']));
  for (const forbidden of ['page.route', 'maxWidth', 'closeTab', 'tab.page', 'tab.id', 'file://']) {
    assert.ok(!src.includes(forbidden), `compiled source must not contain ${forbidden}`);
  }
});
