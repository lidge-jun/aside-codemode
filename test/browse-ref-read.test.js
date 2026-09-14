// wp5. A ref names a row in one observation. Reading one is therefore only meaningful
// against the fingerprint of that observation, and reading it AFTER acting means a second
// call on the same tab. These cases pin both, and pin that a checkbox's value is never
// mistaken for whether it is checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { validateJob, validateExtract } from '../src/host/browse/schema.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';
import { compile, summarizeTree } from '../src/host/browse/script.js';

const TREE = [
  '- textbox "Name" [ref=e1]',
  '- checkbox "Agree" [ref=e2] [checked]',
  '- button "Go" [ref=e3]',
].join('\n');
const FINGERPRINT = summarizeTree(TREE, 'interactive', 200000).fingerprint;

const refJob = (extract, over = {}) => ({
  urls: ['https://a.test'], timeoutMs: 5000, concurrency: 1,
  extract, refsFingerprint: FINGERPRINT, ...over,
});

test('a ref read without the observation that produced it is refused before the run', () => {
  assert.throws(
    () => validateJob({ urls: ['https://a.test'], timeoutMs: 5000, extract: { agree: { ref: 'e2' } } }),
    (e) => e.code === 'EBADVAL' && /refsFingerprint/.test(e.message) && /browse\.attach/.test(e.message),
  );
});

test('a ref read cannot travel with the actions that would invalidate it, and the refusal says where to go', () => {
  assert.throws(
    () => validateJob(refJob({ agree: { ref: 'e2' } }, { actions: [{ click: true, selector: '#go' }], timeoutMs: 8000 })),
    (e) => e.code === 'EBADVAL' && /browse\.attach/.test(e.message) && /snapshotAfter/.test(e.message),
  );
});

test('a ref that is not shaped like a ref is refused', () => {
  assert.throws(() => validateJob(refJob({ agree: { ref: 'button#go' } })), (e) => e.code === 'EBADVAL');
  // f-prefixed refs address rows inside a child frame and are legal.
  assert.equal(validateJob(refJob({ agree: { ref: 'f2e7' } })).extract.agree.ref, 'f2e7');
});

test('a css selector read is unaffected by any of this', () => {
  const job = validateJob({ urls: ['https://a.test'], timeoutMs: 5000, extract: { title: 'h1' }, actions: [{ click: true, selector: '#go' }], timeoutMs: 8000 });
  assert.equal(job.extract.title, 'h1');
});

test('attach takes the ref read and the observation it needs', () => {
  const a = validateAttach({ targetId: 't1', refsFingerprint: FINGERPRINT, extract: { agree: { ref: 'e2' } }, snapshotAfter: true });
  assert.equal(a.extract.agree.ref, 'e2');
  assert.equal(a.snapshotAfter, true);
  // attach has no css extraction engine, so a selector is refused instead of dropped.
  assert.throws(
    () => validateAttach({ targetId: 't1', extract: { title: 'h1' } }),
    (e) => /reads by ref only/.test(e.message),
  );
  assert.throws(
    () => validateAttach({ targetId: 't1', snapshotAfter: 'yes' }),
    (e) => /snapshotAfter must be a boolean/.test(e.message),
  );
  assert.throws(
    () => validateAttach({ targetId: 't1', refsFingerprint: FINGERPRINT, extract: { agree: { ref: 'e2' } }, actions: [{ click: true, selector: '#go' }] }),
    (e) => /cannot share a call with actions/.test(e.message),
  );
});

test('validateExtract is the one definition both surfaces use', () => {
  assert.throws(() => validateExtract({ a: { ref: 'e1' } }, {}), (e) => e.code === 'EBADVAL');
  assert.deepEqual(validateExtract({ a: 'h1' }, {}), { a: 'h1' });
  assert.equal(validateExtract(undefined, {}), null);
});

function runRefScript(job, { tree = TREE, locators = {} } = {}) {
  const lines = [];
  const page = {
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
    locator: (sel) => locators[sel] || {},
    async close() {},
  };
  const ctx = vm.createContext({
    openTab: () => Promise.resolve(page),
    sleep: () => new Promise(() => {}),
    snapshot: async () => ({ tree, refs: [], diff: '' }),
    console: { log: (s) => lines.push(String(s)) },
    fs: { mkdir: async () => {}, writeFile: async () => {} },
    pwd: '/fake/session',
    Buffer, setTimeout, Promise, JSON, Date, URL, RegExp, String, Object, Array,
  });
  const done = vm.runInContext('(async () => {' + compile(validateJob(job), null) + '})()', ctx);
  return { done, payload: () => JSON.parse(lines[lines.length - 1]) };
}

test('a checkbox answers with its value AND its checked state, in different fields', async () => {
  const { done, payload } = runRefScript(refJob({ agree: { ref: 'e2' } }), {
    locators: { 'aria-ref=e2': { inputValue: async () => 'on', innerText: async () => '' } },
  });
  await done.catch(() => {});
  const field = payload().items[0].data.data.agree;
  assert.equal(field.ok, true);
  assert.equal(field.read, 'inputValue', 'a checkbox is read by value, never by its rendered text');
  assert.equal(field.value, 'on');
  assert.equal(field.checked, true, 'the state is its own answer');
});

test('an empty textbox is a value, not an absence', async () => {
  const { done, payload } = runRefScript(refJob({ name: { ref: 'e1' } }), {
    locators: { 'aria-ref=e1': { inputValue: async () => '', innerText: async () => '' } },
  });
  await done.catch(() => {});
  const out = payload().items[0].data;
  assert.equal(out.data.name.ok, true);
  assert.equal(out.data.name.value, '');
  assert.ok(!out.missing.includes('name'), 'an empty field answered the question');
});

test('a ref that is not in the tree is missing, and says which one', async () => {
  const { done, payload } = runRefScript(refJob({ ghost: { ref: 'e9' } }));
  await done.catch(() => {});
  const out = payload().items[0].data;
  assert.equal(out.data.ghost.code, 'ENOREF');
  assert.equal(out.data.ghost.ref, 'e9');
  assert.ok(out.missing.includes('ghost'));
});

test('a tree that was re-minted refuses the read instead of answering from the new one', async () => {
  // Same page, different observation: the guard is the fingerprint, not the url.
  const moved = ['- textbox "Name" [ref=e7]', '- button "Go" [ref=e8]'].join('\n');
  const { done, payload } = runRefScript(refJob({ name: { ref: 'e1' } }), {
    tree: moved,
    locators: { 'aria-ref=e1': { inputValue: async () => 'WRONG', innerText: async () => 'WRONG' } },
  });
  await done.catch(() => {});
  const field = payload().items[0].data.data.name;
  assert.equal(field.code, 'ESTALEREF');
  assert.equal(field.guard, 'fingerprint');
  assert.ok(!('value' in field), 'a refused read returns no value at all');
});

test('acting then asking for the new observation returns the fingerprint the next call needs', async () => {
  const { done, payload } = runRefScript({
    urls: ['https://a.test'], timeoutMs: 8000, concurrency: 1,
    actions: [{ click: true, selector: '#go' }], snapshotAfter: true,
  }, {
    locators: { '#go': { click: async () => {} } },
  });
  await done.catch(() => {});
  const after = payload().items[0].snapshotAfter;
  assert.equal(after.fingerprint, FINGERPRINT, 'the observation the actions left behind');
  assert.equal(after.refCount, 3);
  // The id the next call hands back. It carries the document as well as the rows.
  assert.equal(after.snapshotId, FINGERPRINT + '|https://a.test');
});

test('an observation can be asked for without acting at all', async () => {
  // The option used to be injected inside the actions branch, so a job that only wanted the
  // fingerprint got nothing back and no error either.
  const { done, payload } = runRefScript({
    urls: ['https://a.test'], timeoutMs: 5000, concurrency: 1, snapshotAfter: true,
  });
  await done.catch(() => {});
  const after = payload().items[0].snapshotAfter;
  assert.equal(after.fingerprint, FINGERPRINT);
  assert.equal(after.snapshotId, FINGERPRINT + '|https://a.test');
});

test('the id from one observation authorises a read on the same document only', async () => {
  const goodId = FINGERPRINT + '|https://a.test';
  const ok = runRefScript(refJob({ name: { ref: 'e1' } }, { refsFingerprint: goodId }), {
    locators: { 'aria-ref=e1': { inputValue: async () => 'Jun', innerText: async () => '' } },
  });
  await ok.done.catch(() => {});
  assert.equal(ok.payload().items[0].data.data.name.value, 'Jun');

  // Same rows, different document: the tree looks identical, so the row hash alone would
  // have said yes. The refs belong to the other page.
  const elsewhere = runRefScript(refJob({ name: { ref: 'e1' } }, { refsFingerprint: FINGERPRINT + '|https://elsewhere.test' }), {
    locators: { 'aria-ref=e1': { inputValue: async () => 'WRONG', innerText: async () => '' } },
  });
  await elsewhere.done.catch(() => {});
  const field = elsewhere.payload().items[0].data.data.name;
  assert.equal(field.code, 'ESTALEREF');
  assert.ok(!('value' in field));
});
