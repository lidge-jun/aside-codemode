// API adapters. fetch is injected; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ADAPTERS, AdapterError } from '../src/host/browse/adapters.js';

const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('adapters without an honest public endpoint refuse themselves', async () => {
  // Shipping a stub that fails on the first real call would be worse than saying so.
  const api = createApi({ fetchImpl: ok({}) });
  const r = await api.batch([{ adapter: 'play', id: 'x' }, { adapter: 'slack', channel: 'x' }]);
  assert.equal(r.ok, false);
  for (const item of r.items) {
    assert.equal(item.code, 'ENOTSUP');
    assert.match(item.error, /credentials|token|public/i, 'the refusal must say why');
  }
  assert.equal(ADAPTERS.play.public, false);
  assert.equal(ADAPTERS.youtube.public, true);
});

test('an unknown adapter lists the valid ones', async () => {
  const r = await createApi({ fetchImpl: ok({}) }).batch([{ adapter: 'nope' }]);
  assert.equal(r.items[0].code, 'EBADOPT');
  assert.match(r.items[0].error, /youtube/);
});

test('youtube reads oembed metadata', async () => {
  const api = createApi({ fetchImpl: ok({ title: 'T', author_name: 'A', thumbnail_url: 'u' }) });
  const r = await api.batch([{ adapter: 'youtube', url: 'https://youtu.be/x' }]);
  assert.equal(r.items[0].ok, true);
  assert.equal(r.items[0].data.title, 'T');
  assert.equal(r.items[0].data.provider, 'youtube');
});

test('a 404 from youtube is named rather than returned as empty metadata', async () => {
  const api = createApi({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  const r = await api.batch([{ adapter: 'youtube', url: 'https://youtu.be/x' }]);
  assert.equal(r.items[0].code, 'ENOTFOUND');
});

test('itunes accepts lookup by id or search by term and rejects neither', async () => {
  const seen = [];
  const fetchImpl = async (u) => { seen.push(u); return { ok: true, status: 200, json: async () => ({ results: [{ trackId: 1, trackName: 'N', kind: 'song' }] }) }; };
  const api = createApi({ fetchImpl });
  await api.batch([{ adapter: 'itunes', id: '123' }, { adapter: 'itunes', term: 'x' }]);
  assert.match(seen[0], /lookup\?id=123/);
  assert.match(seen[1], /search\?term=x/);
  const bad = await api.batch([{ adapter: 'itunes' }]);
  assert.equal(bad.items[0].code, 'EBADVAL');
});

test('one failing adapter never empties the others', async () => {
  const api = createApi({ fetchImpl: ok({ results: [] }) });
  const r = await api.batch([{ adapter: 'itunes', term: 'x' }, { adapter: 'slack' }]);
  assert.equal(r.items[0].ok, true);
  assert.equal(r.items[1].ok, false);
  assert.deepEqual(r.partial, ['item-failure']);
});
