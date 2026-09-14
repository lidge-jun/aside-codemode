// Snapshot cache. The key is the whole point: the browser carries a signed-in profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, compactTree, createSnapshotCache } from '../src/host/browse/snapshot-cache.js';

test('the account root is part of the key, so one profile cannot serve another', () => {
  // Without this the shared cache is a cross-account leak wearing the costume of a speed-up.
  const a = cacheKey({ url: 'https://x.test', accountRoot: '/home/alice/.aside/u/0' });
  const b = cacheKey({ url: 'https://x.test', accountRoot: '/home/bob/.aside/u/0' });
  assert.notEqual(a, b);
});

test('waitSelector and roles change the key because they change the tree', () => {
  const base = { url: 'https://x.test', accountRoot: '/r' };
  assert.notEqual(cacheKey(base), cacheKey({ ...base, waitSelector: '#main' }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, roles: ['heading'] }));
  assert.equal(cacheKey({ ...base, roles: ['a', 'b'] }), cacheKey({ ...base, roles: ['b', 'a'] }), 'role order must not matter');
});

test('the same inputs always produce the same key', () => {
  const k = { url: 'https://x.test', accountRoot: '/r', roles: ['heading'], waitSelector: '#m' };
  assert.equal(cacheKey(k), cacheKey({ ...k }));
});

test('compact mode keeps only the requested roles', () => {
  const tree = 'heading Example\nlink Home\nbutton Go\nparagraph Text';
  const out = compactTree(tree, ['heading', 'link']);
  assert.equal(out, 'heading Example\nlink Home');
  assert.equal(compactTree(tree, []), tree, 'no roles means no filtering');
});

test('an entry past its ttl is a miss, and ttl is the only invalidation', async () => {
  let clock = 10000;
  const store = new Map();
  const deps = {
    mkdirSyncImpl: () => {},
    writeFileImpl: async (f, d) => { store.set(f, { d, at: clock }); },
    readFileImpl: async (f) => { if (!store.has(f)) throw new Error('ENOENT'); return store.get(f).d; },
    statImpl: async (f) => { if (!store.has(f)) throw new Error('ENOENT'); return { mtimeMs: store.get(f).at }; },
  };
  const c = createSnapshotCache({ ttlMs: 1000, now: () => clock, deps });
  const k = { url: 'https://x.test', accountRoot: '/r' };
  await c.put(k, 'heading A');
  assert.equal((await c.get(k)).hit, true);
  clock = 11500;
  const miss = await c.get(k);
  assert.equal(miss.hit, false);
  assert.equal(miss.reason, 'expired');
});

test('a revisit returns only what changed', () => {
  const c = createSnapshotCache({ deps: { mkdirSyncImpl: () => {} } });
  const d = c.diff('a\nb\nc', 'a\nc\nd');
  assert.deepEqual(d.added, ['d']);
  assert.deepEqual(d.removed, ['b']);
  assert.equal(d.changed, 2);
});
