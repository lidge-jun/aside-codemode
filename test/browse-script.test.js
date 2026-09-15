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
    async evaluate(fn, arg) { return typeof fn === 'function' ? fn(arg) : undefined; },
    async waitForLoadState() {},
    async waitForSelector() {},
    async screenshot() { return Buffer.alloc(10); },
    async pdf() { return Buffer.alloc(10); },
    async close() { page.closed = true; },
  };
  return page;
}

function runScript(source, { openTab, sleep, fs }) {
  const lines = [];
  const ctx = vm.createContext({
    openTab,
    sleep,
    snapshot: async () => ({ tree: 'x', refs: [], diff: '' }),
    console: { log: (s) => lines.push(String(s)) },
    // The compiled script writes artifacts through the Aside repl fs global and reports
    // its session pwd, so the fake context has to provide both or the run throws before
    // it can print a payload.
    fs: fs || { mkdir: async () => {}, writeFile: async () => {} },
    pwd: '/fake/session',
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

// wp2: the host issues jobId and runId, the script only echoes them. Asserting that on the
// COMPILED script matters because the session tests feed fake stdout that already carries
// the ids — they would stay green with every echo deleted from the generated source.
const planned = (urls) => urls.map((url, i) => ({
  url, timeoutMs: 5000, waitSelector: null, skip: false, jobId: 'j' + String(i).padStart(3, '0'),
}));

test('every outcome the script can emit carries the jobId it was given', async () => {
  const urls = ['https://ok.test', 'https://sync.test', 'https://async.test', 'https://skip.test'];
  const plan = planned(urls);
  plan[3].skip = true;
  const source = compile({ ...job(urls), runId: 'run-fixed' }, plan);
  const { done, payload } = runScript(source, {
    // A plain function, deliberately: an async one turns the throw below into a rejected
    // promise and the synchronous catch in the script is never entered.
    openTab: (url) => {
      if (url.includes('sync')) throw new Error('synchronous refusal');
      if (url.includes('async')) return Promise.reject(new Error('late refusal'));
      return Promise.resolve(makePage(url));
    },
    sleep: () => new Promise(() => {}),
  });
  await done.catch(() => {});
  const out = payload();
  assert.equal(out.items.length, 4);
  for (const item of out.items) {
    assert.match(String(item.jobId), /^j00\d$/, 'every item must name the request it answers');
  }
  const byId = new Map(out.items.map((i) => [i.jobId, i]));
  assert.equal(byId.get('j000').ok, true, 'the healthy url is the success path');
  assert.equal(byId.get('j001').code, 'EOPEN');
  assert.equal(byId.get('j002').code, 'EOPEN');
  assert.equal(byId.get('j003').code, 'ESKIP');
  // The ids belong to the request, not to completion order.
  assert.equal(byId.get('j000').url, 'https://ok.test');
  assert.equal(byId.get('j003').url, 'https://skip.test');
});

// The remaining outcomes the script can print. Each one is its own items.push, so each one
// is its own chance to drop the id the host asked it to carry.
function makeRichPage(url, opts = {}) {
  return {
    targetId: url,
    async url() { return url; },
    async title() { return opts.title || 'Example'; },
    async evaluate(fn, arg) {
      if (arg && Array.isArray(arg.selectors)) {
        return {
          textChars: opts.textChars === undefined ? 400 : opts.textChars,
          rawChars: 400, scriptChars: 0, scriptRatio: 0,
          requiredSelectorsMatched: [], requiredSelectorsMissing: [],
          skeletonNodes: 0, sample: 'x',
        };
      }
      return url;
    },
    async waitForLoadState() { if (opts.waitThrows) throw new Error('navigation blew up'); },
    async waitForSelector() {},
    async screenshot() { return Buffer.alloc(10); },
    async pdf() { return Buffer.alloc(10); },
    async close() {},
  };
}

test('the blocked, unrendered and thrown outcomes name their request too', async () => {
  const urls = ['https://captcha.test', 'https://thin.test', 'https://throw.test'];
  const source = compile(
    { ...validateJob({ urls, timeoutMs: 5000, concurrency: 1, minTextChars: 100, requireContent: true }), runId: 'run-fixed' },
    planned(urls),
  );
  const { done, payload } = runScript(source, {
    openTab: (url) => Promise.resolve(makeRichPage(url, {
      title: url.includes('captcha') ? 'verify you are human' : 'Example',
      textChars: url.includes('thin') ? 3 : 400,
      waitThrows: url.includes('throw'),
    })),
    sleep: () => new Promise(() => {}),
  });
  await done.catch(() => {});
  const byId = new Map(payload().items.map((i) => [i.jobId, i]));
  assert.equal(byId.size, 3, 'three distinct ids must come back');
  assert.equal(byId.get('j000').code, 'EBLOCKED');
  assert.equal(byId.get('j000').blockKind, 'captcha');
  assert.equal(byId.get('j001').code, 'EUNRENDERED');
  assert.equal(byId.get('j002').ok, false);
  assert.match(byId.get('j002').error, /navigation blew up/);
});

test('runId travels in the job payload so an effect can name the run that caused it', () => {
  const source = compile({ ...job(['https://a.test']), runId: 'run-fixed' }, planned(['https://a.test']));
  assert.ok(source.includes('"runId":"run-fixed"'), 'the compiled JOB must carry the host runId');
  assert.ok(source.includes('"jobId":"j000"'), 'the compiled plan must carry the issued jobId');
  const without = compile(job(['https://a.test']));
  assert.ok(without.includes('"runId":null'), 'a job compiled without a runId says so rather than omitting it');
});
