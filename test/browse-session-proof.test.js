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
  // Bind the document to the page whose evaluate is running, not to the last tab opened.
  // With one worker those are the same thing; with four they are not, and the signed-in
  // page would be measured against a signed-out document. The callback is synchronous, so
  // no other page can slip in between the assignment and the read.
  const bind = (page) => {
    const inner = page.evaluate.bind(page);
    page.evaluate = (fn, arg) => { current = page; return inner(fn, arg); };
    return page;
  };
  const ctx = vm.createContext({
    openTab: async (url) => { current = bind(pages(url)); return current; },
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

test('three misses stop the run, and the items that never started say a person is needed', async () => {
  // Three, not one. A marker can be missing because a page half rendered, and cancelling a
  // batch that would have worked sends someone to sign in for nothing. The two extra
  // attempts cost two navigations and no clicks: an item whose marker is missing returns
  // before it acts. concurrency is pinned at 1 because the default is 4, and at 4 all five
  // items would be in flight before the third miss lands.
  const urls = ['a', 'b', 'c', 'd', 'e'].map((s) => 'https://portal.test/' + s);
  const job = validateJob({ urls, timeoutMs: 5000, concurrency: 1, loggedInMarker: 'Signed in as' });
  const opened = [];
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => { opened.push(u); return makePage(u, fakeDocument(OUT)); });
  await done;
  const out = payload();
  assert.equal(opened.length, 3, 'the fourth item must not have opened a tab');
  // Count first. An earlier version of this test walked slice(1) of a one-element array, so
  // every() answered true about nothing and passed while the run was abandoning its queue.
  // An assertion that walks a set has to establish the set is not empty.
  assert.equal(out.items.length, 5, 'every requested item must come back with an answer');
  const tried = out.items.slice(0, 3);
  const never = out.items.slice(3);
  assert.equal(tried.length, 3);
  assert.equal(never.length, 2);
  assert.ok(tried.every((i) => i.code === 'ENOTLOGGEDIN'),
    'an item that looked and did not find the marker made a definite observation: '
    + JSON.stringify(tried.map((i) => i.code)));
  assert.ok(never.every((i) => i.code === 'ELOGINREQUIRED' && i.reason === 'logged-out'),
    'an item that never started is not skipped, it is waiting on a person: '
    + JSON.stringify(never.map((i) => [i.code, i.reason])));
  assert.ok(never.every((i) => itemStatus(i) === 'needs_input'));
});

test('an item still acting when the session proves gone stops, and does not claim to know', async () => {
  // The hazard the threshold does not cover. An item whose marker was missing never reaches
  // its actions, so raising the threshold buys no extra clicks. What does click is a peer
  // that already passed the marker check and is working through its step list when somebody
  // else proves the session is gone. Its remaining steps must not run, and it must not come
  // back saying the clicks landed or that they definitely did not.
  const urls = ['a', 'b', 'c', 'd'].map((s) => 'https://portal.test/' + s);
  const job = validateJob({
    urls, timeoutMs: 5000, concurrency: 4, loggedInMarker: 'Signed in as',
    actions: [{ ref: 'e1', click: true }, { ref: 'e1', click: true }, { ref: 'e1', click: true }],
    allowStaleRefs: true,
  });
  let release = null;
  const held = new Promise((r) => { release = r; });
  let clicks = 0;
  const pages = (u) => {
    // One page is signed in and slow; the other three are signed out and fast, so they land
    // the three misses while the first is still inside its step list.
    const signedIn = u.endsWith('/a');
    const page = makePage(u, fakeDocument(signedIn ? IN : OUT));
    page.locator = () => ({
      async click() {
        clicks += 1;
        if (clicks === 1) await held;
      },
    });
    return page;
  };
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), pages);
  // Let the signed-out items run to completion, then let the acting item continue.
  await new Promise((r) => setTimeout(r, 50));
  release();
  await done;
  const out = payload();
  const acting = out.items.find((i) => i.url.endsWith('/a'));
  assert.ok(acting, 'the acting item has to be in the payload before anything is asserted about it');
  assert.equal(acting.code, 'ESESSIONGONE');
  assert.equal(itemStatus(acting), 'indeterminate',
    'started and cut off is exactly what indeterminate is for');
  const refused = acting.actions.filter((s) => s.code === 'ESESSIONGONE');
  assert.ok(refused.length >= 1, 'at least one step has to have been refused: ' + JSON.stringify(acting.actions));
  assert.ok(clicks < 3, 'the steps after the stop must not have clicked, got ' + clicks + ' clicks');
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

// A selector that never appeared used to end the item with no code, which threw away the
// diagnosis: on a page you are not signed in to, the sign-in is why the selector is absent,
// and the marker was never given the chance to say so. The run did not stop either.
test('a selector that never appeared does not hide the reason it never appeared', async () => {
  const urls = ['https://portal.test/a', 'https://portal.test/b'];
  const job = validateJob({ urls, timeoutMs: 5000, concurrency: 1, loggedInMarker: 'Signed in as', waitSelector: '.course-list' });
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => {
    const page = makePage(u, fakeDocument(OUT));
    page.waitForSelector = async () => { throw new Error('Timeout 5000ms exceeded'); };
    return page;
  });
  await done;
  const out = payload();
  assert.equal(out.items.length, 2);
  assert.ok(out.items.every((i) => i.code === 'ENOTLOGGEDIN'),
    'the selector timeout buried the sign-in: ' + JSON.stringify(out.items.map((i) => i.code)));
  // Two urls cannot reach three misses, so both are looked at and both answer for
  // themselves. Stopping early is what the five-url test above is for.
});

// When the session is fine, the selector really is the story, and it says which one.
test('a selector that never appeared on a signed-in page names itself', async () => {
  const job = validateJob({ urls: ['https://portal.test/a'], timeoutMs: 5000, concurrency: 1, loggedInMarker: 'Signed in as', waitSelector: '.course-list' });
  const { done, payload } = runScript(compile({ ...job, runId: 'run-x' }), (u) => {
    const page = makePage(u, fakeDocument(IN));
    page.waitForSelector = async () => { throw new Error('Timeout 5000ms exceeded'); };
    return page;
  });
  await done;
  const it = payload().items[0];
  assert.equal(it.code, 'EWAITSELECTOR');
  assert.match(it.error, /\.course-list/);
});
