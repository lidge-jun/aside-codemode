// wp7. A failed observation is not content. These cases pin the four places that used to
// store one as if it were: an http refusal, a login wall, an empty browser fallback, and a
// watch baseline overwritten by whichever of those arrived.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadText } from '../src/host/browse/read-text.js';
import { createWatch, createPrefetch } from '../src/host/browse/watch.js';
import { cacheKey } from '../src/host/browse/cache.js';

const html = (body) => '<html><body>' + body + '</body></html>';
const res = (status, body, url) => ({
  status, url: url || 'https://a.test',
  text: async () => body,
  headers: { get: () => null },
});
const article = html('<article>' + 'word '.repeat(200) + '</article>');

test('an http refusal is reported as one, not as an empty page', async () => {
  for (const [status, kind] of [[401, 'auth'], [403, 'auth'], [429, 'rate-limited'], [503, 'upstream']]) {
    const readText = createReadText({ fetchImpl: async () => res(status, html('<p>nope</p>')) });
    const out = await readText('https://a.test');
    assert.equal(out.ok, false, status + ' must not read as a successful page');
    assert.equal(out.blockKind, kind);
    assert.equal(out.fallbackReason, 'http-' + status);
  }
});

test('a sign-in page is named rather than stored as the article', async () => {
  // policy.detect wants a login-shaped destination AND a password prompt, or a redirect to
  // another host. A page that merely says "sign in" is not enough, and that is deliberate.
  const readText = createReadText({
    fetchImpl: async () => res(200, html('<h1>Sign in</h1><label>Password</label><p>' + 'x'.repeat(400) + '</p>'), 'https://a.test/login'),
  });
  const out = await readText('https://a.test/article');
  assert.equal(out.ok, false);
  assert.equal(out.blockKind, 'login-wall');
  assert.equal(out.finalUrl, 'https://a.test/login');
});

test('a browser fallback that returns no text is degraded, not a read', async () => {
  const readText = createReadText({
    fetchImpl: async () => res(200, html('<div id="root"></div>')),
    browse: { exec: async () => ({ items: [{ ok: true, text: '' }] }) },
  });
  const out = await readText('https://a.test');
  assert.equal(out.ok, false);
  assert.equal(out.degraded, true);
  assert.match(out.degradedReason, /no text/);
});

test('a browser fallback asks for the body and returns it', async () => {
  let asked = null;
  const readText = createReadText({
    fetchImpl: async () => res(200, html('<div id="root"></div>')),
    browse: { exec: async (job) => { asked = job; return { items: [{ ok: true, text: 'the real article body' }] }; } },
  });
  const out = await readText('https://a.test');
  assert.equal(asked.fullText, true, 'without this the only text available is a 160-character sample');
  assert.equal(out.ok, true);
  assert.equal(out.text, 'the real article body');
  assert.equal(out.format, 'markdown');
});

test('a warm entry is used, and a failed one is never stored', async () => {
  const store = new Map();
  const cache = {
    get: async (parts) => (store.has(cacheKey(parts)) ? { hit: true, value: store.get(cacheKey(parts)) } : { hit: false }),
    put: async (parts, value) => { store.set(cacheKey(parts), value); },
  };
  let fetches = 0;
  const ok = createReadText({ fetchImpl: async () => { fetches += 1; return res(200, article); }, cache });
  await ok('https://a.test');
  const second = await ok('https://a.test');
  assert.equal(fetches, 1, 'the second read came from the cache prefetch warmed');
  assert.equal(second.cached, true);

  const bad = createReadText({ fetchImpl: async () => res(503, html('<p>down</p>')), cache });
  await bad('https://b.test');
  assert.equal(store.size, 1, 'a refusal is not an observation worth keeping');
});

test('a date filter separates cache entries, because it changes the answer', () => {
  const base = { namespace: 'search', subject: 'q', engine: 'youtube', accountRoot: '' };
  assert.notEqual(
    cacheKey({ ...base, since: '2025-01-01' }),
    cacheKey({ ...base, since: '2010-01-01' }),
    'a narrow search answered a wide one from the same entry and the dropped rows stayed dropped',
  );
  assert.equal(cacheKey({ ...base, since: null }), cacheKey(base));
});

test('an outage does not become the page it interrupted', async () => {
  const store = new Map();
  const cache = {
    get: async (parts) => (store.has(cacheKey(parts)) ? { hit: true, value: store.get(cacheKey(parts)) } : { hit: false }),
    put: async (parts, value) => { store.set(cacheKey(parts), value); },
  };
  const reads = [
    { ok: true, markdown: '# Real article', status: 200 },
    { ok: false, markdown: '', status: 503, blockKind: 'upstream' },
    { ok: true, markdown: '# Real article', status: 200 },
  ];
  let i = 0;
  const watch = createWatch({ readText: async () => reads[i++], cache });
  const first = await watch(['https://a.test']);
  assert.equal(first.items[0].first, true);
  const during = await watch(['https://a.test']);
  assert.equal(during.items[0].code, 'EOBSERVE', 'the outage is reported, not recorded');
  assert.equal(during.items[0].changed, null);
  const after = await watch(['https://a.test']);
  assert.equal(after.items[0].changed, false, 'the page never actually changed');
});

// A cache that both readText and the watchers share, built the way browse.js builds it.
function sharedCache() {
  const store = new Map();
  return {
    store,
    get: async (parts) => (store.has(cacheKey(parts)) ? { hit: true, value: store.get(cacheKey(parts)) } : { hit: false }),
    put: async (parts, value) => { store.set(cacheKey(parts), value); },
  };
}

test('a watch reads the page, not the entry it wrote fifteen minutes ago', async () => {
  const cache = sharedCache();
  const bodies = [article, html('<article>' + 'other '.repeat(200) + '</article>')];
  let i = 0;
  const readText = createReadText({ fetchImpl: async () => res(200, bodies[Math.min(i++, 1)]), cache });
  const watch = createWatch({ readText: (u, o) => readText(u, o), cache });
  const first = await watch(['https://a.test']);
  assert.equal(first.items[0].first, true);
  const second = await watch(['https://a.test']);
  assert.equal(second.items[0].changed, true, 'readText served the warm entry and the change was invisible');
});

test('prefetch leaves an entry the next reader can use as an answer', async () => {
  const cache = sharedCache();
  let fetches = 0;
  const readText = createReadText({ fetchImpl: async () => { fetches += 1; return res(200, article); }, cache });
  const prefetch = createPrefetch({ readText: (u, o) => readText(u, o), cache });
  const warm = await prefetch(['https://a.test']);
  assert.equal(warm.items[0].ok, true);
  const read = await readText('https://a.test');
  assert.equal(fetches, 1, 'the warm entry was the one prefetch made');
  assert.equal(read.cached, true);
  assert.equal(read.ok, true, 'a thinner second write left the reader with no ok');
  assert.equal(read.chars, read.text.length);
});

test('prefetch reports a refusal as one instead of counting it warm', async () => {
  const cache = sharedCache();
  const readText = createReadText({ fetchImpl: async () => res(503, html('<p>down</p>')), cache });
  const prefetch = createPrefetch({ readText: (u, o) => readText(u, o), cache });
  const out = await prefetch(['https://a.test']);
  assert.equal(out.items[0].ok, false);
  assert.equal(out.items[0].blockKind, 'upstream');
  assert.equal(out.warmed, 0);
  assert.equal(cache.store.size, 0);
});

test('a warm entry shorter than the caller asked for is not the answer', async () => {
  const cache = sharedCache();
  let fetches = 0;
  const readText = createReadText({ fetchImpl: async () => { fetches += 1; return res(200, article); }, cache });
  const short = await readText('https://a.test');
  assert.equal(short.ok, true);
  const demanding = await readText('https://a.test', { minChars: short.chars + 1 });
  assert.equal(fetches, 2, 'minChars is not in the key, so the hit has to be measured');
  assert.notEqual(demanding.cached, true);
});
