// AC 8 — actions discovery contracts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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

test('file action namespace aliases resolve without duplicating list rows', () => {
  const aliases = {
    'fs.read_file': 'read_file',
    'fs.write_file': 'write_file',
    'fs.edit_file': 'edit_file',
  };
  const listed = actions.list().map((row) => row.path);

  for (const [alias, canonical] of Object.entries(aliases)) {
    assert.equal(actions.describe(alias), actions.describe(canonical));
    assert.equal(actions.find(alias)[0].path, canonical);
    assert.equal(listed.includes(alias), false, alias + ' is a spelling of one action, not another action');
  }

  assert.equal(actions.check('fs.read_file', { path: 'a.txt', offset: 1, limit: 1 }).ok, true);
  assert.equal(actions.check('fs.write_file', { file_path: 'new.txt', content: '' }).ok, true);
  assert.equal(actions.check('fs.edit_file', { path: 'a.txt', appendText: 'x' }).ok, true);
});

test('browse.searchMany catalog declares Date and discovery accepts it', () => {
  const date = new Date('2026-01-01T00:00:00Z');
  const described = actions.describe('browse.searchMany');
  assert.equal(described.inputs.since.type, 'string|date');
  assert.match(described.signature, /Date/);
  assert.equal(actions.check('browse.searchMany', { queries: ['q'], since: date }).ok, true);
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

test('check does not require arguments the call defaults or treats as absent', () => {
  assert.equal(actions.check('report.build', { outFile: 'out.pdf' }).ok, true);
  assert.equal(actions.check('fs.exists', {}).ok, true);
  assert.equal(actions.check('recipes.describe', {}).ok, true);
});

test('optional null follows each runtime family instead of one blanket type rule', () => {
  // report.build normalizes a null paper to its A4 default.
  assert.equal(actions.check('report.build', { outFile: 'out.pdf', paper: null }).ok, true);
  assert.equal(actions.check('browse.exec', {
    urls: ['data:text/html,ok'], snapshot: null,
  }).ok, true);

  // A null pdf is not omission in the browse job schema, so its validator keeps deciding.
  const browsePdf = actions.check('browse.exec', {
    urls: ['data:text/html,ok'], pdf: null,
  });
  assert.equal(browsePdf.ok, false);
  assert.equal(browsePdf.invalid[0].name, 'pdf');

  // Search validates null as a supplied value, not as omission. Keeping this refusal proves
  // the checker did not turn the report exception into a catalog-wide null allowance.
  const search = actions.check('search.files', { path: '.', max: null });
  assert.equal(search.ok, false);
  assert.deepEqual(search.typeErrors, [{ name: 'max', want: 'number', got: 'null' }]);
});

test('grepFile discovery admits every measured pattern and line-cap form', () => {
  const guestRegexp = vm.runInContext('/needle/', vm.createContext({}));
  assert.equal(actions.check('fs.grepFile', { path: 'a.txt', pattern: guestRegexp }).ok, true);
  assert.equal(actions.check('fs.grepFile', { path: 'a.txt', pattern: '' }).ok, true);
  assert.equal(actions.check('fs.grepFile', {
    path: 'a.txt', pattern: 'needle', maxLineBytes: 256,
  }).ok, true);
  assert.equal(actions.check('fs.grepFile', {
    path: 'a.txt', pattern: 'needle', maxLineBytes: null,
  }).ok, true);
  assert.equal(actions.check('fs.grepFile', { path: 'a.txt', pattern: '[' }).ok, false);
});

test('unknown path throws with did-you-mean candidates', () => {
  assert.throws(() => actions.describe('search.contents'), /did you mean: search.content/);
});

// Wrong-name guidance is asserted through the CLI in test/guest-guidance.test.js, because
// the host object tested here is never the object the guest holds.
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
