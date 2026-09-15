// Proof that a session is live comes from the caller, and this runs the compiled script to
// show what happens when the proof is absent. An expired portal answers 200 with the right
// title, so every signal the batch used to look at stayed green while the page held a
// sign-in form. The marker is the one thing that disagrees.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compile } from '../src/host/browse/script.js';
import { validateJob, BrowseOptionError } from '../src/host/browse/schema.js';
import { createBrowseSession, itemStatus } from '../src/host/browse/session.js';

// Enough DOM for the render probe: a body with text, script bodies that are part of
// textContent, and a clone whose remove() actually takes them back out again.
function fakeDocument(text, scripts = []) {
  const body = {
    innerText: text,
    textContent: text + scripts.join(''),
    cloneNode() {
      let content = text + scripts.join('');
      const nodes = scripts.map((s) => ({ remove() { content = content.replace(s, ''); } }));
      return { querySelectorAll: () => nodes, get textContent() { return content; } };
    },
  };
  return {
    body,
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === 'script' ? scripts.map((s) => ({ textContent: s })) : []),
  };
}

function makePage(url, doc) {
  const page = {
    targetId: url, closed: false,
    href: url,
    async url() { return url; },
    async title() { return 'Example'; },
    async evaluate(fn, arg) { return typeof fn === 'function' ? fn(arg) : undefined; },
    async waitForLoadState() {}, async waitForSelector() {},
    async close() { page.closed = true; },
    doc,
  };
  return page;
}

function runScript(source, pages) {
  const lines = [];
  let current = null;
  const ctx = vm.createContext({
    openTab: async (url) => { current = pages(url); return current; },
    sleep: () => new Promise(() => {}),
    snapshot: async () => ({ tree: 'x', refs: [], diff: '' }),
    console: { log: (s) => lines.push(String(s)) },
    fs: { mkdir: async () => {}, writeFile: async () => {} },
    pwd: '/fake/session', Buffer, setTimeout, Promise, JSON,
    // The compiled probe reads these as bare globals inside page.evaluate.
    get document() { return current && current.doc; },
    get location() { return { href: current && current.href }; },
  });
  const done = vm.runInContext('(async () => {' + source + '})()', ctx);
  return { done, payload: () => JSON.parse(lines[lines.length - 1]) };
}

const IN = 'Signed in as somebody';
const OUT = 'Please sign in to continue';

test('a page without the marker is a request for a person, not a failure', async () => {
  const job = validateJob({ urls: ['https://portal.test/a'], timeoutMs: 5000, concurrency: 1, loggedInMarker: 'Signed in as' });
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => makePage(u, fakeDocument(OUT)));
  await done;
  const out = payload();
  assert.equal(out.items[0].code, 'ENOTLOGGEDIN');
  assert.equal(itemStatus(out.items[0]), 'needs_input');
});

test('the same page with the marker present is an ordinary success', async () => {
  const job = validateJob({ urls: ['https://portal.test/a'], timeoutMs: 5000, concurrency: 1, loggedInMarker: 'Signed in as' });
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => makePage(u, fakeDocument(IN)));
  await done;
  assert.equal(payload().items[0].ok, true);
});

// A bootstrap payload that mentions the marker is not a signed-in page.
test('the marker is not matched against script bodies', async () => {
  const job = validateJob({ urls: ['https://portal.test/a'], timeoutMs: 5000, concurrency: 1, loggedInMarker: 'Signed in as' });
  const doc = fakeDocument(OUT, ['var boot = {"label":"Signed in as somebody"};']);
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => makePage(u, doc));
  await done;
  assert.equal(payload().items[0].code, 'ENOTLOGGEDIN', 'text nobody can see must not count as proof');
});

test('one lost session stops the rest of the run instead of opening tabs that cannot work', async () => {
  const urls = ['https://portal.test/a', 'https://portal.test/b', 'https://portal.test/c'];
  const job = validateJob({ urls, timeoutMs: 5000, concurrency: 1, loggedInMarker: 'Signed in as' });
  const opened = [];
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => { opened.push(u); return makePage(u, fakeDocument(OUT)); });
  await done;
  const out = payload();
  assert.equal(opened.length, 1, 'the second item must not have opened a tab');
  assert.equal(out.items[0].code, 'ENOTLOGGEDIN');
  assert.ok(out.items.slice(1).every((i) => i.code === 'ESKIP' && i.reason === 'logged-out'));
});

test('a caller who would rather see them all fail can say so', async () => {
  const urls = ['https://portal.test/a', 'https://portal.test/b'];
  const job = validateJob({ urls, timeoutMs: 5000, concurrency: 1, loggedInMarker: 'Signed in as', stopWhenLoggedOut: false });
  const opened = [];
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => { opened.push(u); return makePage(u, fakeDocument(OUT)); });
  await done;
  assert.equal(opened.length, 2);
  assert.ok(payload().items.every((i) => i.code === 'ENOTLOGGEDIN'));
});

const resolveAside = async () => 'C:/fake/aside.exe';
const fakeSpawn = (stdout) => async () => ({ stdout, killed: false });
const envelope = (items) => JSON.stringify({ type: 'final', items, leakedUrls: [], partial: [] }) + '\n[ok | 5ms]';

test('a run that only needs a sign-in reports that, and says so in its reasons', async () => {
  const stdout = envelope([
    { jobId: 'j000', url: 'https://portal.test/a', ok: false, code: 'ENOTLOGGEDIN' },
    { jobId: 'j001', url: 'https://portal.test/b', ok: false, code: 'ESKIP', reason: 'logged-out' },
  ]);
  const res = await createBrowseSession({ resolveAside, spawnAside: fakeSpawn(stdout) })
    .run({ urls: ['https://portal.test/a', 'https://portal.test/b'], timeoutMs: 5000 });
  assert.equal(res.status, 'needs_input');
  assert.equal(res.complete, false);
  assert.ok(res.partial.includes('logged-out'));
});

const base = { urls: ['https://a.test'], timeoutMs: 5000 };
const refuses = (job, re) => assert.throws(() => validateJob(job), (e) => e instanceof BrowseOptionError && e.code === 'EBADVAL' && re.test(e.message));

test('the marker is checked before a process is spawned', () => {
  assert.equal(validateJob({ ...base, loggedInMarker: 'Sign out' }).loggedInMarker, 'Sign out');
  assert.equal(validateJob({ ...base, loggedInMarker: 'Sign out' }).stopWhenLoggedOut, true);
  assert.equal(validateJob({ ...base, loggedInMarker: 'Sign out', stopWhenLoggedOut: false }).stopWhenLoggedOut, false);
  refuses({ ...base, loggedInMarker: '' }, /non-empty/);
  refuses({ ...base, loggedInMarker: 7 }, /non-empty/);
  refuses({ ...base, loggedInMarker: '([unclosed' }, /not a valid regular expression/);
  // Without a marker nothing can detect the logout, so the flag would be a promise the
  // tool cannot keep.
  refuses({ ...base, stopWhenLoggedOut: true }, /only means something beside loggedInMarker/);
  assert.equal(validateJob(base).loggedInMarker, null);
  assert.equal(validateJob(base).stopWhenLoggedOut, false);
});

// The regression the earlier version of this file could not see. A url that never loaded
// lands on a real rendered document with a body, so the marker finds nothing and answers
// logout. With the default stop that killed the whole batch, and the caller was told to
// sign in about a network failure.
const ERROR_PAGE = 'chrome-error://chromewebdata/';

test('a url that never loaded is not mistaken for a lost session', async () => {
  const urls = ['https://nope.invalid/a', 'https://portal.test/b'];
  const job = validateJob({ urls, timeoutMs: 5000, concurrency: 1, loggedInMarker: 'Signed in as' });
  const opened = [];
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => {
    const bad = u.indexOf('nope') > -1;
    const page = makePage(u, fakeDocument(bad ? 'This site can not be reached' : IN));
    if (bad) page.href = ERROR_PAGE;
    opened.push(u);
    return page;
  });
  await done;
  const out = payload();
  assert.equal(out.items.length, 2, 'the batch must not have stopped');
  assert.equal(opened.length, 2, 'the second url must still have been opened');
  const dead = out.items.find((i) => i.url === urls[0]);
  assert.equal(dead.code, 'EDEADEND', 'a network failure was reported as a logout');
  assert.equal(itemStatus(dead), 'failed');
  assert.equal(out.items.find((i) => i.url === urls[1]).ok, true, 'a good url was punished for a bad one');
});

// The destination is decided before the content check too, for the same reason.
test('a url that never loaded is not mistaken for an unrendered page', async () => {
  const job = validateJob({ urls: ['https://nope.invalid/a'], timeoutMs: 5000, concurrency: 1, requireContent: 'Quarterly report' });
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => {
    const page = makePage(u, fakeDocument('This site can not be reached'));
    page.href = ERROR_PAGE;
    return page;
  });
  await done;
  assert.equal(payload().items[0].code, 'EDEADEND');
});
