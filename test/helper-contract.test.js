// wp8. cm runs inside Aside's REPL, so it is evaluated here the way the REPL evaluates it:
// as source, against fake globals, with nothing imported. What is checked is the contract -
// the same checkResultEnvelope that the host batch has to satisfy.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { helperSource, HELPER_VERSION } from '../src/host/browse/helper-bundle.js';
import { checkResultEnvelope } from '../src/host/browse/result-contract.js';
import { createBrowseSession } from '../src/host/browse/session.js';

// openTab is a plain function on purpose. Making it async turns a synchronous throw into a
// rejected promise, which is a different code path from the one Aside actually takes.
function loadCm({ open, closeMs = 0, closeFails = false } = {}) {
  const opened = [];
  const context = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    openTab(url) {
      if (open) return open(url);
      const tab = {
        url,
        close: () => new Promise((resolve, reject) => setTimeout(
          () => (closeFails ? reject(new Error('close refused')) : resolve()), closeMs,
        )),
      };
      opened.push(tab);
      return Promise.resolve(tab);
    },
  };
  vm.createContext(context);
  vm.runInContext(helperSource().src, context);
  return { cm: context.cm, opened };
}

const urls = (n) => Array.from({ length: n }, (_, i) => ({ url: 'https://a.test/' + i }));

test('the loaded helper reports the version the host thinks it shipped', () => {
  const { cm } = loadCm();
  assert.equal(cm.version, HELPER_VERSION);
});

test('the tab budget holds and every item keeps its own jobId', async () => {
  let live = 0;
  let peak = 0;
  const { cm } = loadCm();
  const out = await cm.run({
    items: urls(6),
    limit: 2,
    maxTabs: 2,
    async onItem(tab, item, jobId) {
      live += 1;
      if (live > peak) peak = live;
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return { seen: item.url, jobId };
    },
  });
  assert.deepEqual(checkResultEnvelope(out), []);
  assert.equal(out.status, 'completed');
  assert.equal(out.items.length, 6);
  assert.ok(out.tabs.peak <= 2, 'peak was ' + out.tabs.peak);
  assert.ok(peak <= 2, 'two callbacks ran against three tabs');
  out.items.forEach((item, i) => {
    assert.equal(item.jobId, 'j' + String(i).padStart(3, '0'));
    assert.equal(item.value.jobId, item.jobId, 'a value landed under the wrong job');
    assert.equal(item.value.seen, 'https://a.test/' + i);
  });
  assert.deepEqual(out.checkpoint, out.items.map((i) => i.jobId));
});

test('one refused open is partial, and the other five survive it', async () => {
  const { cm } = loadCm({
    open(url) {
      if (url.endsWith('/3')) throw new Error('404 tab');
      return Promise.resolve({ url, close: () => Promise.resolve() });
    },
  });
  const out = await cm.run({ items: urls(6), limit: 2, maxTabs: 2, onItem: async () => 'read' });
  assert.deepEqual(checkResultEnvelope(out), []);
  assert.equal(out.status, 'partial');
  assert.equal(out.completed, 5);
  assert.equal(out.items[3].status, 'failed');
  assert.equal(out.items[3].code, 'EOPEN');
  // The refused open must refund its reservation, or the budget stays spent and every item
  // after it dies with ETABBUDGET for a tab that was never created.
  assert.equal(out.items.filter((i) => i.code === 'ETABBUDGET').length, 0);
  assert.equal(out.tabs.requested, 5);
});

test('work the deadline cut off is indeterminate, and is not retried', async () => {
  let calls = 0;
  const { cm } = loadCm();
  const out = await cm.run({
    items: urls(4),
    limit: 1,
    maxTabs: 2,
    deadlineMs: 30,
    async onItem() { calls += 1; await new Promise((r) => setTimeout(r, 40)); return 'slow'; },
  });
  assert.deepEqual(checkResultEnvelope(out), []);
  assert.ok(out.items.some((i) => i.code === 'EDEADLINE'), JSON.stringify(out.items));
  assert.equal(out.status, 'partial');
  assert.equal(calls, out.completed, 'an item was run more than once');
  assert.equal(out.complete, false);
});

test('a close that never answers is a named leak, not a lost result', async () => {
  const { cm } = loadCm({ closeMs: 5000 });
  const out = await cm.run({ items: urls(1), limit: 1, maxTabs: 2, onItem: async () => 'read' });
  assert.deepEqual(checkResultEnvelope(out), []);
  assert.equal(out.items.length, 1, 'the result was swallowed by the close');
  assert.equal(out.items[0].value, 'read');
  assert.equal(out.tabs.leaked, 1);
  assert.equal(out.tabs.leakedTabs[0].why, 'capped');
  assert.equal(out.status, 'partial', 'a leaked tab cannot be reported as a clean run');
});

test('a close that rejects is reported, and the item is still returned', async () => {
  const { cm } = loadCm({ closeFails: true });
  const out = await cm.run({ items: urls(2), limit: 2, maxTabs: 2, onItem: async () => 'read' });
  assert.deepEqual(checkResultEnvelope(out), []);
  assert.equal(out.items.length, 2);
  assert.equal(out.tabs.leaked, 2);
  assert.equal(out.tabs.leakedTabs[0].why, 'failed');
});

test('a callback that throws fails its own item and confirms no effect', async () => {
  const { cm } = loadCm();
  const out = await cm.run({
    items: urls(2),
    limit: 2,
    maxTabs: 2,
    onItem: async (tab, item) => { if (item.url.endsWith('/1')) throw new Error('bad selector'); return 'read'; },
  });
  assert.deepEqual(checkResultEnvelope(out), []);
  assert.equal(out.items[1].status, 'failed');
  assert.match(out.items[1].error, /bad selector/);
  const failed = out.effects.find((e) => e.jobId === 'j001');
  assert.equal(failed.state, 'indeterminate', 'a callback that threw mid-action may still have acted');
  assert.equal(out.effects.find((e) => e.jobId === 'j000').state, 'confirmed');
});

test('cm.run needs a callback and says so instead of returning an empty run', async () => {
  const { cm } = loadCm();
  await assert.rejects(() => cm.run({ items: urls(1) }), /onItem/);
});

test('the host batch and the helper answer the same contract check', async () => {
  // The run carries a real effect, confirmed and unconfirmed, because an empty effects array
  // proves nothing about the half of the contract that is about effect state.
  const lines = [
    JSON.stringify({ type: 'effect', effect: { operationId: 'op-1', jobId: 'j000', state: 'confirmed' } }),
    JSON.stringify({ type: 'effect', effect: { operationId: 'op-2', jobId: 'j000', state: 'started' } }),
    JSON.stringify({
      type: 'final',
      items: [{ jobId: 'j000', url: 'https://a.test', ok: true }],
      leakedUrls: [], partial: [],
    }),
  ].join('\n');
  const session = createBrowseSession({
    resolveAside: async () => 'C:/fake/aside.exe',
    spawnAside: async () => ({ stdout: lines + '\n[ok | 5ms]', killed: false }),
  });
  const hosted = await session.run({ urls: ['https://a.test'], timeoutMs: 5000 });
  assert.deepEqual(checkResultEnvelope(hosted), [], 'the host envelope drifted from the shared contract');
  assert.equal(hosted.schema, 'browse/2');
  assert.equal(hosted.effects.length, 2);
  assert.deepEqual(hosted.effects.map((e) => e.state).sort(), ['confirmed', 'indeterminate'],
    'an unconfirmed effect must settle to indeterminate before it reaches a reader');

  const { cm } = loadCm();
  const helped = await cm.run({ items: urls(1), limit: 1, maxTabs: 2, onItem: async () => 'read' });
  assert.deepEqual(checkResultEnvelope(helped), []);
  assert.equal(helped.schema, 'cm/1');
  // Array.from because the helper's arrays are minted inside the vm context, and strict deep
  // equality compares prototypes. The values are what is being asserted, not the realm.
  assert.deepEqual(Array.from(helped.effects, (e) => e.state), ['confirmed']);
});
