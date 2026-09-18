import test from 'node:test';
import assert from 'node:assert/strict';

import { createSearchMany } from '../src/host/browse/search.js';

function ddgHtml(rows) {
  return rows.map(({ url, title }) => `<a class="result__a" href="${url}">${title}</a>`).join('\n');
}

test('searchMany dedupes URLs across queries while preserving first-seen order', async () => {
  const fetchImpl = async (url) => {
    const query = new URL(url).searchParams.get('q');
    const rows = query === 'first'
      ? [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test', title: 'B' }]
      : [{ url: 'https://a.test/', title: 'A again' }, { url: 'https://c.test', title: 'C' }];
    return { text: async () => ddgHtml(rows) };
  };

  const result = await createSearchMany({ fetchImpl })(['first', 'second']);

  assert.deepEqual(result.items.map((item) => item.rows.map((row) => row.url)), [
    ['https://a.test', 'https://b.test'],
    ['https://c.test'],
  ]);
  assert.deepEqual(result.items.map((item) => item.query), ['first', 'second']);
  assert.deepEqual(result.items.map((item) => item.deduped), [0, 1]);
  assert.equal(result.deduped, 1);
});

test('searchMany reports a requested date filter as unapplied when dates are unknown', async () => {
  const fetchImpl = async () => ({
    text: async () => ddgHtml([{ url: 'https://a.test', title: 'A' }]),
  });

  const result = await createSearchMany({ fetchImpl })(['undated'], { since: '2030-01-01' });
  const item = result.items[0];

  assert.equal(item.filtered, 0);
  assert.deepEqual(item.dateFilter, {
    requested: true,
    applied: false,
    evaluated: 0,
    unknown: 1,
  });
  assert.deepEqual(result.dateFilter, {
    requested: true,
    applied: false,
    evaluated: 0,
    unknown: 1,
  });
});

// Issue #38: #32's fix disclosed the dateFilter object and this test asserted it, but
// production still computed ok from items.every(i => i.ok), so a caller reading the
// documented success bit got an UNFILTERED result set presented as a successful filtered
// search. The split is pinned here in one assertion so neither half can drift alone:
// ok stays "no query threw"; complete answers "did I get what I asked for".
test('searchMany keeps ok true but reports complete false when since could not be applied', async () => {
  const fetchImpl = async () => ({
    text: async () => ddgHtml([{ url: 'https://a.test', title: 'A' }]),
  });

  const result = await createSearchMany({ fetchImpl })(['undated'], { since: '2030-01-01' });

  assert.equal(result.ok, true, 'no query threw, so ok is still true');
  assert.equal(result.complete, false, 'a requested filter was never applied');
  assert.equal(result.dateFilter.requested, true);
  assert.equal(result.dateFilter.applied, false);
});

test('searchMany reports complete true when nothing the caller asked for was lost', async () => {
  const fetchImpl = async () => ({
    text: async () => ddgHtml([{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test', title: 'B' }]),
  });

  const result = await createSearchMany({ fetchImpl })(['plain'], {});

  assert.equal(result.ok, true);
  assert.equal(result.complete, true);
});

test('searchMany applies a date filter to dated rows and reports unknown dates', async () => {
  const session = {
    raw: async () => ({
      rows: [
        { url: 'https://old.test', title: 'Old', published: '2020-01-01' },
        { url: 'https://new.test', title: 'New', published: '2030-01-01' },
        { url: 'https://unknown.test', title: 'Unknown' },
      ],
    }),
  };

  const result = await createSearchMany({ session })(['dated'], {
    engine: 'youtube',
    since: '2025-01-01',
  });
  const item = result.items[0];

  assert.deepEqual(item.rows.map((row) => row.url), ['https://new.test', 'https://unknown.test']);
  assert.equal(item.filtered, 1);
  assert.deepEqual(item.dateFilter, {
    requested: true,
    applied: true,
    evaluated: 2,
    unknown: 1,
  });
  assert.equal(result.filtered, 1);
});
