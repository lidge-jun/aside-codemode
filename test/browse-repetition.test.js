// wp6: shared cache keys, media write gate, search honesty, watch/recipes/prefetch.
// Everything is injected; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, createCache, textHash, lineDiff } from '../src/host/browse/cache.js';
import { createDownloadMedia, DEFAULT_MAX_BYTES } from '../src/host/browse/media.js';
import { normaliseUrl, dedupe, parseDuckDuckGo, applyDateFilter, createSearchMany, ENGINES } from '../src/host/browse/search.js';
import { createWatch, createRecipes, createPrefetch } from '../src/host/browse/watch.js';

const png = () => { const b = Buffer.alloc(32); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b,0); b.write('IHDR',12,'latin1'); b.writeUInt32BE(10,16); b.writeUInt32BE(5,20); return b; };

test('the cache key separates namespaces, engines, accounts and locales', () => {
  const base = { namespace: 'readText', subject: 'https://x.test', accountRoot: '/a' };
  // A readText entry must never answer an extract question.
  assert.notEqual(cacheKey(base), cacheKey({ ...base, namespace: 'extract' }));
  // YouTube and DuckDuckGo are different indexes: same query, different answer.
  assert.notEqual(cacheKey({ ...base, engine: 'youtube' }), cacheKey({ ...base, engine: 'duckduckgo' }));
  // The browser carries a signed-in profile.
  assert.notEqual(cacheKey(base), cacheKey({ ...base, accountRoot: '/b' }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, locale: 'ko-KR' }));
  assert.equal(cacheKey(base), cacheKey({ ...base }));
});

function memoryCache(clock = { t: 1000 }) {
  const store = new Map();
  return createCache({ ttlMs: 1000, now: () => clock.t, deps: {
    mkdirSyncImpl: () => {},
    writeFileImpl: async (f, d) => { store.set(f, { d, at: clock.t }); },
    readFileImpl: async (f) => { if (!store.has(f)) throw new Error('ENOENT'); return store.get(f).d; },
    statImpl: async (f) => { if (!store.has(f)) throw new Error('ENOENT'); return { mtimeMs: store.get(f).at }; },
  } });
}

test('a cache entry expires and ttl is the only invalidation', async () => {
  const clock = { t: 1000 };
  const c = memoryCache(clock);
  const k = { namespace: 'n', subject: 's' };
  await c.put(k, { v: 1 });
  assert.equal((await c.get(k)).hit, true);
  clock.t = 2500;
  assert.equal((await c.get(k)).reason, 'expired');
});

test('media refuses to write anything the magic bytes do not call an image', async () => {
  // Content-Type is a claim the server makes; a block page can send image/png.
  const written = [];
  const dl = createDownloadMedia({
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('<html>not an image</html>') }),
    deps: { mkdirImpl: async () => {}, writeFileImpl: async (p) => { written.push(p); } },
  });
  const r = await dl(['https://x.test/a.png'], { outDir: '/out' });
  assert.equal(r.items[0].ok, false);
  assert.equal(r.items[0].code, 'ENOTIMAGE');
  assert.deepEqual(written, [], 'nothing may reach disk when the bytes are not an image');
});

test('media writes real image bytes and reports the true dimensions', async () => {
  const dl = createDownloadMedia({
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'application/octet-stream' }, arrayBuffer: async () => png() }),
    deps: { mkdirImpl: async () => {}, writeFileImpl: async () => {} },
  });
  const r = await dl(['https://x.test/a'], { outDir: '/out' });
  assert.equal(r.items[0].ok, true);
  assert.equal(r.items[0].mime, 'image/png');
  assert.equal(r.items[0].width, 10);
  assert.equal(r.items[0].height, 5);
});

test('an oversized download is refused rather than filling the disk', async () => {
  const dl = createDownloadMedia({
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.alloc(64) }),
    deps: { mkdirImpl: async () => {}, writeFileImpl: async () => {} },
  });
  const r = await dl(['https://x.test/a'], { outDir: '/out', maxBytes: 10 });
  assert.equal(r.items[0].code, 'ETOOBIG');
  assert.ok(DEFAULT_MAX_BYTES > 0);
});

test('urls are normalised and deduped before counting', () => {
  assert.equal(normaliseUrl('https://x.test/a/?utm_source=z#frag'), 'https://x.test/a');
  const rows = dedupe([{ url: 'https://x.test/a' }, { url: 'https://x.test/a/?utm_medium=q' }, { url: 'https://y.test' }]);
  assert.equal(rows.length, 2);
});

test('a DuckDuckGo challenge page is EBLOCKED, never zero results', () => {
  // DDG is the DEFAULT engine, so a challenge parsing as an empty result set would be the
  // silent lie that E8 made us refuse for Google, on the path most callers take.
  assert.throws(() => parseDuckDuckGo('<html>are you a robot</html>'), (e) => e.code === 'EBLOCKED');
  const rows = parseDuckDuckGo('<a class="result__a" href="https://x.test">Title</a>');
  assert.deepEqual(rows, [{ url: 'https://x.test', title: 'Title' }]);
});

test('a date filter reports what it dropped', () => {
  const rows = [{ url: 'a', published: '2020-01-01' }, { url: 'b', published: '2030-01-01' }, { url: 'c' }];
  const out = applyDateFilter(rows, '2025-01-01');
  assert.equal(out.filtered, 1, 'an empty result must be distinguishable from an aggressive filter');
  assert.equal(out.rows.length, 2, 'rows with no date are kept rather than silently dropped');
});

test('an aside engine bot challenge becomes EBLOCKED with a route that works', async () => {
  const session = { raw: async () => ({ error: 'Error: Google Search returned bot challenge HTML. Open https://www.google.com/search?q=x in the browser, solve it, then retry.', rows: [] }) };
  const sm = createSearchMany({ session });
  const r = await sm(['x'], { engine: 'google' });
  assert.equal(r.items[0].code, 'EBLOCKED');
  assert.equal(r.items[0].alternate, 'solve-in-browser');
  assert.match(r.items[0].error, /google\.com\/search/, 'the caller needs the url to open');
});

test('every result echoes the engine that produced it', async () => {
  const session = { raw: async () => ({ rows: [{ url: 'https://v.test/1', title: 'V' }] }) };
  const r = await createSearchMany({ session })(['q'], { engine: 'youtube' });
  assert.equal(r.engine, 'youtube');
  assert.equal(r.items[0].engine, 'youtube');
  assert.ok(ENGINES.duckduckgo && ENGINES.google && ENGINES.youtube);
});

test('an unknown engine lists the valid ones', async () => {
  await assert.rejects(createSearchMany({})(['q'], { engine: 'bing' }), (e) => e.code === 'EBADOPT');
});

test('watch reports first sight distinctly from a change, and says nothing when unchanged', async () => {
  let text = 'a\nb';
  const readText = async () => ({ markdown: text });
  const w = createWatch({ readText, cache: memoryCache() });
  const first = (await w(['https://x.test'])).items[0];
  assert.equal(first.changed, true);
  assert.equal(first.first, true, 'never seen must not read as changed');
  const same = (await w(['https://x.test'])).items[0];
  assert.equal(same.changed, false);
  assert.equal(same.diff, undefined, 'an unchanged url must not ship a body');
  text = 'a\nc';
  const moved = (await w(['https://x.test'])).items[0];
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.diff.added, ['c']);
  assert.deepEqual(moved.diff.removed, ['b']);
});

test('a recipe is data; code is refused so it cannot bypass the guest sandbox', async () => {
  const exec = async () => ({ ok: true, items: [], partial: [] });
  const r = createRecipes({ registry: { evil: () => {}, alsoEvil: 'return 1', good: { url: 'https://x.test/{id}' } }, exec });
  await assert.rejects(r.run('evil'), (e) => e.code === 'ENOTSUP');
  await assert.rejects(r.run('alsoEvil'), (e) => e.code === 'ENOTSUP');
  await assert.rejects(r.run('nope'), (e) => e.code === 'EBADOPT');
});

test('a data recipe interpolates its arguments and runs with no model turn', async () => {
  const seen = [];
  const exec = async (job) => { seen.push(job); return { ok: true, items: [{ url: job.urls[0], ok: true }], partial: [] }; };
  const r = createRecipes({ registry: { app: { url: 'https://x.test/app/{id}', waitSelector: '#main', extract: { title: 'h1' } } }, exec });
  const out = await r.run('app', { id: 'abc' });
  assert.equal(out.url, 'https://x.test/app/abc');
  assert.equal(seen[0].waitSelector, '#main');
  assert.deepEqual(seen[0].extract, { title: 'h1' });
});

test('prefetch reports failures instead of throwing them at the caller', async () => {
  // A warm-up that breaks the real run is worse than a cold cache.
  const readText = async (u) => { if (u.includes('bad')) throw new Error('nope'); return { markdown: 'hello', source: 'fetch' }; };
  const p = createPrefetch({ readText, cache: memoryCache() });
  const r = await p(['https://ok.test', 'https://bad.test']);
  assert.equal(r.ok, true, 'prefetch itself never fails the caller');
  assert.equal(r.warmed, 1);
  assert.equal(r.items[1].ok, false);
});

test('text hashing and line diffing are stable', () => {
  assert.equal(textHash('a'), textHash('a'));
  assert.notEqual(textHash('a'), textHash('b'));
  assert.equal(lineDiff('a\nb', 'a\nb').changed, 0);
});
