// AC 8 — actions discovery contracts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../src/host/actions.js';

const actions = createActions();

test('list returns the catalog, filter narrows by prefix', () => {
  assert.equal(actions.list().length, 5);
  const searchOnly = actions.list('search');
  assert.deepEqual(searchOnly.map((a) => a.path), ['search.files', 'search.content']);
});

test('find ranks by token coverage', () => {
  const rows = actions.find('search content ripgrep');
  assert.ok(rows.length > 0);
  assert.equal(rows[0].path, 'search.content');
});

test('check reports missing, unknown and type errors without calling', () => {
  const r = actions.check('search.content', {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(), ['path', 'query']);
  const r2 = actions.check('search.content', { query: 'x', path: 'y', bogus: 1, max: 'NaN' });
  assert.deepEqual(r2.unknown, ['bogus']);
  assert.deepEqual(r2.typeErrors, [{ name: 'max', want: 'number', got: 'string' }]);
  const r3 = actions.check('search.content', { query: 'x', path: 'y' });
  assert.equal(r3.ok, true);
});

test('unknown path throws with did-you-mean candidates', () => {
  assert.throws(() => actions.describe('search.contents'), /did you mean: search.content/);
});
