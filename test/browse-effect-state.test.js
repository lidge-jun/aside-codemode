// wp4. A timeout ends a wait; it does not cancel a click Aside already handed to the page.
// These cases pin the only honest answer to "did that side effect land": started, confirmed,
// or indeterminate — and they pin that nothing retries an action whose outcome is unknown.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createBrowseSession, parseEffects, settleEffects, runStatus } from '../src/host/browse/session.js';
import { compile } from '../src/host/browse/script.js';
import { validateJob } from '../src/host/browse/schema.js';

const resolveAside = async () => 'C:/fake/aside.exe';
const fakeSpawn = (stdout, killed = false) => async () => ({ stdout, killed });
const effectLine = (o) => JSON.stringify({ type: 'effect', effect: o });
const finalLine = (o) => JSON.stringify({ type: 'final', items: [], leakedUrls: [], partial: [], ...o });
const job = { urls: ['https://a.test'], timeoutMs: 5000 };

test('an effect that started and never confirmed is indeterminate, not failed', () => {
  const rows = parseEffects([
    effectLine({ operationId: 'o1', jobId: 'j000', verb: 'click', state: 'started' }),
  ].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(settleEffects(rows, { killed: false })[0].state, 'indeterminate');
});

test('a confirmed effect stays confirmed, and a kill takes that back', () => {
  const rows = parseEffects([
    effectLine({ operationId: 'o1', jobId: 'j000', verb: 'click', state: 'started' }),
    effectLine({ operationId: 'o1', jobId: 'j000', verb: 'click', state: 'confirmed' }),
  ].join('\n'));
  assert.equal(settleEffects(rows, { killed: false })[0].state, 'confirmed');
  // The process died before it could print; a confirmation we may not have received is not
  // a confirmation we have.
  assert.equal(settleEffects(rows, { killed: true })[0].state, 'indeterminate');
});

test('an unconfirmed effect keeps a batch of successes from reporting completion', async () => {
  const stdout = [
    effectLine({ operationId: 'o1', jobId: 'j000', verb: 'click', state: 'started' }),
    finalLine({ items: [{ jobId: 'j000', url: 'https://a.test', ok: true }] }),
    '[ok | 5ms]',
  ].join('\n');
  const res = await createBrowseSession({ resolveAside, spawnAside: fakeSpawn(stdout) }).run(job);
  assert.equal(res.effects.length, 1);
  assert.equal(res.effects[0].state, 'indeterminate');
  assert.equal(res.status, 'partial');
  assert.equal(res.ok, false);
  assert.ok(res.partial.includes('effect-indeterminate'));
});

test('a confirmed effect leaves a clean run clean', async () => {
  const stdout = [
    effectLine({ operationId: 'o1', jobId: 'j000', verb: 'click', state: 'started' }),
    effectLine({ operationId: 'o1', state: 'confirmed' }),
    finalLine({ items: [{ jobId: 'j000', url: 'https://a.test', ok: true }] }),
    '[ok | 5ms]',
  ].join('\n');
  const res = await createBrowseSession({ resolveAside, spawnAside: fakeSpawn(stdout) }).run(job);
  assert.equal(res.effects[0].state, 'confirmed');
  assert.equal(res.status, 'completed');
});

test('a killed run still reports what it touched, all of it unconfirmed', async () => {
  const stdout = [
    effectLine({ operationId: 'o1', jobId: 'j000', verb: 'fill', state: 'started' }),
    effectLine({ operationId: 'o1', state: 'confirmed' }),
  ].join('\n');
  const res = await createBrowseSession({ resolveAside, spawnAside: fakeSpawn(stdout, true) }).run(job);
  assert.equal(res.status, 'indeterminate');
  assert.equal(res.effects.length, 1, 'the transcript outlives the payload');
  assert.equal(res.effects[0].state, 'indeterminate');
});

test('runStatus refuses to call a run complete while an effect is unresolved', () => {
  const items = [{ status: 'completed' }];
  assert.equal(runStatus({ marker: 'ok', items, leakedUrls: [], effects: [] }), 'completed');
  assert.equal(runStatus({
    marker: 'ok', items, leakedUrls: [],
    effects: [{ operationId: 'o1', state: 'indeterminate' }],
  }), 'partial');
});

test('losing the marker is not the same as being killed', async () => {
  // The run finished its work and failed to print its trailing marker. It still told the
  // truth about what it confirmed, so folding that back to unknown would lose real evidence.
  const stdout = [
    effectLine({ operationId: 'o1', jobId: 'j000', verb: 'click', state: 'started' }),
    effectLine({ operationId: 'o1', state: 'confirmed' }),
  ].join('\n');
  const res = await createBrowseSession({ resolveAside, spawnAside: fakeSpawn(stdout, false) }).run(job);
  assert.equal(res.status, 'indeterminate', 'no marker still means we cannot judge the run');
  assert.deepEqual(res.partial, ['no-marker']);
  assert.equal(res.effects[0].state, 'confirmed', 'a confirmation we actually saw survives');
});

// The compiled script is what actually prints these lines, so the emission itself is run
// rather than read.
function runScript(source, { openTab, sleep, locator }) {
  const lines = [];
  const ctx = vm.createContext({
    openTab,
    sleep,
    snapshot: async () => ({ tree: '- button "b" [ref=e1]', refs: [], diff: '' }),
    console: { log: (s) => lines.push(String(s)) },
    fs: { mkdir: async () => {}, writeFile: async () => {} },
    pwd: '/fake/session',
    Buffer, setTimeout, Promise, JSON, Date,
  });
  const done = vm.runInContext('(async () => {' + source + '})()', ctx);
  return {
    done,
    effects: () => lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((o) => o && o.type === 'effect').map((o) => o.effect),
  };
}

function pageWith(locator) {
  return {
    targetId: 'p',
    async url() { return 'https://a.test'; },
    async title() { return 'Example'; },
    async evaluate(fn, arg) {
      if (arg && Array.isArray(arg.selectors)) {
        return { textChars: 400, rawChars: 400, scriptChars: 0, scriptRatio: 0,
          requiredSelectorsMatched: [], requiredSelectorsMissing: [], skeletonNodes: 0, sample: 'x' };
      }
      return 'https://a.test';
    },
    async waitForLoadState() {},
    async waitForSelector() {},
    async screenshot() { return Buffer.alloc(10); },
    async pdf() { return Buffer.alloc(10); },
    locator,
    async close() {},
  };
}

const actionJob = (actions) => ({
  ...validateJob({ urls: ['https://a.test'], timeoutMs: 5000, concurrency: 1, actions, stopOnError: false }),
  runId: 'run-fixed',
});
const plan = [{ url: 'https://a.test', timeoutMs: 5000, waitSelector: null, skip: false, jobId: 'j000' }];

test('a click that answers in time is confirmed, and the id names its request', async () => {
  const source = compile(actionJob([{ click: true, selector: '#go' }]), plan);
  const { done, effects } = runScript(source, {
    openTab: () => Promise.resolve(pageWith(() => ({ click: async () => {} }))),
    sleep: () => new Promise(() => {}),
  });
  await done.catch(() => {});
  const rows = effects();
  assert.equal(rows.length, 2, 'started and confirmed');
  assert.equal(rows[0].state, 'started');
  assert.equal(rows[1].state, 'confirmed');
  assert.equal(rows[0].jobId, 'j000');
  assert.equal(rows[0].runId, 'run-fixed');
  assert.equal(rows[0].operationId, rows[1].operationId);
});

test('a click that outruns its own timeout is left started, and is not tried again', async () => {
  let calls = 0;
  const source = compile(actionJob([{ click: true, selector: '#go', timeoutMs: 20 }]), plan);
  const { done, effects } = runScript(source, {
    openTab: () => Promise.resolve(pageWith(() => ({ click: () => { calls += 1; return new Promise(() => {}); } }))),
    sleep: () => new Promise(() => {}),
  });
  await done.catch(() => {});
  const rows = effects();
  assert.equal(rows.length, 1, 'no confirmation can be printed for a click still in flight');
  assert.equal(rows[0].state, 'started');
  assert.equal(calls, 1, 'an action whose outcome is unknown must never be repeated');
});

test('waiting is not a side effect, and scrolling is', async () => {
  const source = compile(actionJob([{ sleepMs: 1 }, { waitFor: '#a' }, { scroll: 'bottom' }]), plan);
  const { done, effects } = runScript(source, {
    openTab: () => Promise.resolve(pageWith(() => ({ click: async () => {} }))),
    sleep: () => new Promise(() => {}),
  });
  await done.catch(() => {});
  const verbs = [...new Set(effects().map((e) => e.verb))];
  assert.deepEqual(verbs, ['scroll'], 'only the step that can move the page leaves a record');
});

test('a confirmation without a start still counts, and repeats do not multiply', () => {
  // stdout can be clipped at the front, and a retried print can repeat a line. Neither
  // should change what we believe about the page.
  const confirmedOnly = settleEffects(parseEffects([
    effectLine({ operationId: 'o1', jobId: 'j000', verb: 'click', state: 'confirmed' }),
  ].join('\n')));
  assert.equal(confirmedOnly.length, 1);
  assert.equal(confirmedOnly[0].state, 'confirmed');
  const repeated = settleEffects(parseEffects([
    effectLine({ operationId: 'o1', jobId: 'j000', verb: 'click', state: 'started' }),
    effectLine({ operationId: 'o1', state: 'confirmed' }),
    effectLine({ operationId: 'o1', state: 'confirmed' }),
  ].join('\n')));
  assert.equal(repeated.length, 1, 'one operation is one row however often it is printed');
  assert.equal(repeated[0].state, 'confirmed');
});

test('two items without issued ids still get one operation each', async () => {
  // compile() can be called without a plan, so jobId is absent. Composing the id from the
  // verb alone made both items share run-j-s0 and the host folded them into one effect.
  const source = compile(
    { ...validateJob({ urls: ['https://a.test', 'https://b.test'], timeoutMs: 5000, concurrency: 1, actions: [{ click: true, selector: '#go' }], stopOnError: false }), runId: 'run-fixed' },
    null,
  );
  const { done, effects } = runScript(source, {
    openTab: () => Promise.resolve(pageWith(() => ({ click: async () => {} }))),
    sleep: () => new Promise(() => {}),
  });
  await done.catch(() => {});
  const ids = [...new Set(effects().map((e) => e.operationId))];
  assert.equal(ids.length, 2, 'each item owns its own operation id');
  assert.equal(settleEffects(effects()).length, 2, 'and the host keeps them apart');
});
