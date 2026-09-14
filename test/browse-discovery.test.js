// wp7 F12. Discovery and execution have to give the same answer. They used to disagree in
// both directions: check refused a snapshot the job accepted, and accepted a waitUntil the
// job refused. An agent that learns the shape from check and then gets ENOTSUP has learned
// nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../src/host/actions.js';
import { validateJob } from '../src/host/browse/schema.js';

const actions = createActions();
const urls = ['https://a.test'];
const runtimeAccepts = (opts) => {
  try { validateJob({ urls, timeoutMs: 8000, ...opts }); return true; } catch { return false; }
};
const checkAccepts = (opts) => actions.check('browse.exec', { urls, ...opts }).ok;

for (const [label, opts] of [
  ['snapshot: true', { snapshot: true }],
  ['snapshot as a mode', { snapshot: 'interactive' }],
  ['requireSelector as a bare string', { requireSelector: 'article' }],
  ['requireSelector as a list', { requireSelector: ['article'] }],
  ['a supported waitUntil', { waitUntil: 'load' }],
  ['an unsupported waitUntil', { waitUntil: 'networkidle' }],
  ['a screenshot option Aside does not expose', { screenshot: { maxWidth: 800 } }],
  ['a snapshotAfter mode', { snapshotAfter: true }],
  ['the inlined batch helper', { helper: true }],
  ['a helper flag that is not a boolean', { helper: 'yes' }],
]) {
  test('discovery and execution agree on ' + label, () => {
    assert.equal(
      checkAccepts(opts), runtimeAccepts(opts),
      label + ': check said ' + checkAccepts(opts) + ' and the runtime said ' + runtimeAccepts(opts),
    );
  });
}

test('an option the catalog never listed is still unknown', () => {
  const res = actions.check('browse.exec', { urls, nonsense: 1 });
  assert.equal(res.ok, false);
  assert.deepEqual(res.unknown, ['nonsense']);
});

test('a refusal names the option it is about', () => {
  const res = actions.check('browse.exec', { urls, waitUntil: 'networkidle' });
  assert.equal(res.ok, false);
  assert.ok(res.invalid.some((i) => i.name === 'waitUntil'), 'the caller has to know which option to change');
});

test('search and grepFile keep their own checkers', () => {
  // Their pattern options mean different things: a glob metacharacter is refused for a
  // substring filter and accepted for a regex. Routing both through one checker made
  // discovery call a valid grepFile regex invalid.
  const search = actions.check('search.files', { path: '.', pattern: 'a*' });
  assert.equal(search.ok, false);
  assert.ok(search.invalid.some((i) => i.name === 'pattern'));
  const grep = actions.check('fs.grepFile', { path: 'a.js', pattern: 'a*' });
  assert.equal(grep.ok, true, 'a regex quantifier is valid here');
});

// browse.exec is not the only browse action, and its job schema is not their schema. Putting
// one of the others through it reported every real option they have as an unknown job option.
for (const [path, args] of [
  ['browse.searchMany', { queries: ['q'], engine: 'duckduckgo', since: '2025-01-01' }],
  ['browse.tabs', {}],
  ['browse.readText', { url: 'https://a.test' }],
  ['browse.downloadMedia', { urls: ['https://a.test/x.png'], outDir: '/tmp' }],
  ['browse.prefetch', { urls: ['https://a.test'] }],
]) {
  test('discovery does not judge ' + path + ' by the browse.exec job schema', () => {
    const res = actions.check(path, args);
    assert.equal(res.ok, true, path + ' was refused: ' + JSON.stringify(res.invalid));
  });
}

test('a rule that spans two options sees both of them', () => {
  // snapshotAfter: 'diff' needs a tree to compare against. Asked about on its own it looks
  // illegal, and the call that carries the tree is the one an agent actually writes.
  const withTree = actions.check('browse.exec', { urls, snapshot: 'tree', snapshotAfter: 'diff' });
  assert.equal(withTree.ok, true, JSON.stringify(withTree.invalid));
  assert.equal(runtimeAccepts({ snapshot: 'tree', snapshotAfter: 'diff' }), true);
  const alone = actions.check('browse.exec', { urls, snapshotAfter: 'diff' });
  assert.equal(alone.ok, false);
  assert.ok(alone.invalid.some((i) => i.name === 'snapshotAfter'));
});

test('fullText and its cap are catalogued and accepted by both surfaces', () => {
  for (const opts of [{ fullText: true }, { fullText: true, maxTextChars: 5000 }, { maxTextChars: 0 }]) {
    assert.equal(checkAccepts(opts), runtimeAccepts(opts), JSON.stringify(opts));
  }
});
