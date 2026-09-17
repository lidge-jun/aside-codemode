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
