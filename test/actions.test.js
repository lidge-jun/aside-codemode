// AC 8 — actions discovery contracts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../src/host/actions.js';

const actions = createActions();

test('list returns the catalog, filter narrows by prefix', () => {
  // Asserted as a floor, not an exact count: the catalog grows, and pinning
  // the number made every new action a test edit with no safety value.
  assert.ok(actions.list().length >= 11);
  const searchOnly = actions.list('search');
  assert.deepEqual(searchOnly.map((a) => a.path), ['search.files', 'search.content', 'search.count']);
  const fsOnly = actions.list('fs.');
  assert.ok(fsOnly.every((a) => a.path.startsWith('fs.')));
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

test('execution namespace guesses teach the direct guest call', () => {
  const expected = {
    fs: ["fs.read(path)", "actions.describe('fs.read')"],
    search: ["search.content({ path, query })", "actions.describe('search.content')"],
    browse: ["browse.exec({})", "actions.describe('browse.exec')"],
    api: ["api.batch([])", "actions.describe('api.batch')"],
    report: ["report.build({})", "actions.describe('report.build')"],
    recipes: ["recipes.list()", "actions.describe('recipes.list')"],
  };
  for (const [name, calls] of Object.entries(expected)) {
    assert.throws(() => actions[name], (error) => calls.every((call) => error.message.includes(call)));
  }
});

test('dispatcher guesses say actions is discovery only', () => {
  for (const name of ['call', 'run', 'invoke', 'exec', 'describeAll', 'get']) {
    assert.throws(
      () => actions[name],
      (error) => error.message.includes('actions is discovery only') && error.message.includes("actions.describe('fs.read')"),
    );
  }
});

test('unknown action properties preserve ordinary object behavior', async () => {
  assert.equal(actions.other, undefined);
  assert.equal(actions.then, undefined);
  assert.equal(actions.catch, undefined);
  assert.equal(actions[Symbol.iterator], undefined);
  assert.deepEqual(Object.keys(actions), ['list', 'find', 'describe', 'check']);
  assert.deepEqual(JSON.parse(JSON.stringify(actions)), {});
  assert.equal(await actions, actions);
});

test('describe without a path teaches exact-path discovery', () => {
  for (const call of [() => actions.describe(), () => actions.describe(undefined)]) {
    assert.throws(call, (error) => (
      error.message.includes('exact action path')
      && error.message.includes("actions.describe('fs.read')")
      && error.message.includes('actions.list()')
      && error.message.includes('actions.find(query)')
    ));
  }
  assert.throws(() => actions.describe('api'), /did you mean: api\./);
});

test('list is synchronous and rejects promise-style catch and finally', async () => {
  const rows = actions.list();
  assert.throws(() => rows.catch(() => {}), /synchronous.*drop the await\/.catch/);
  assert.throws(() => rows.finally(() => {}), /synchronous.*drop the await\/.catch/);
  assert.equal(rows.then, undefined);
  assert.deepEqual(await rows, rows);
  assert.equal(JSON.stringify(rows), JSON.stringify([...rows]));
  assert.deepEqual(Object.keys(rows), Object.keys([...rows]));
});
