// The tree comes back as one string with the hierarchy carried by indentation. Pulling a
// grouped row out of it - a course, its assignment, its due date - meant splitting lines in
// guest code and running a small state machine, because there is no DOM query on this surface.
// The same string, parsed once where it is produced, answers that with a depth comparison.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTree } from '../src/host/browse/script.js';
import { validateJob } from '../src/host/browse/schema.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';
import { compile } from '../src/host/browse/script.js';

// Nodes are opt-in, so every check that wants them says so. A caller who does not ask keeps
// the payload it had before.
const withNodes = (tree, mode = 'tree', cap = 20000, opts = {}) => summarizeTree(tree, mode, cap, { nodes: true, ...opts });

const TREE = [
  '- document "과제: 262R 인간관계와 마음건강" [ref=e1]',
  '  - link "과제 및 평가" [ref=e21]',
  '  - heading "공지" [ref=e5]',
  '  - iframe [ref=f3e14]',
  '    - button "제출" [ref=e99]',
  '    - text: 제출 기한 2026-09-16',
].join('\n');

test('the tree arrives as nodes whose depth matches the indentation', () => {
  const out = withNodes(TREE);
  assert.ok(Array.isArray(out.nodes), 'no structured view at all');
  assert.equal(out.nodes.length, 6);
  assert.deepEqual(out.nodes.map((n) => n.depth), [0, 1, 1, 1, 2, 2]);
  assert.deepEqual(out.nodes.map((n) => n.role), ['document', 'link', 'heading', 'iframe', 'button', 'text']);
});

test('a row that carries its name after a colon is named too', () => {
  const out = withNodes(TREE);
  const due = out.nodes.find((n) => n.role === 'text');
  assert.equal(due.name, '제출 기한 2026-09-16', 'without this the grouping has nothing to read');
});

test('refs on nodes are the refs the flat list already gave', () => {
  const out = withNodes(TREE);
  const byRef = new Map(out.refs.map((r) => [r.ref, r]));
  for (const node of out.nodes) {
    if (!node.ref) continue;
    assert.ok(byRef.has(node.ref), 'node ref ' + node.ref + ' is not in refs');
    assert.equal(byRef.get(node.ref).role, node.role);
  }
});

// The grouping this exists for: take a parent and everything under it, without a regex.
test('a subtree can be collected by depth alone', () => {
  const out = withNodes(TREE);
  const start = out.nodes.findIndex((n) => n.role === 'iframe');
  const under = [];
  for (let i = start + 1; i < out.nodes.length && out.nodes[i].depth > out.nodes[start].depth; i++) under.push(out.nodes[i]);
  assert.deepEqual(under.map((n) => n.role), ['button', 'text']);
  assert.equal(under[1].name, '제출 기한 2026-09-16');
});

test('a password value never reaches the structured view', () => {
  // Aside writes the value OUTSIDE the brackets, which is the form the first version of this
  // check did not exercise at all.
  const tree = '- textbox "pw" [ref=e7] [type=password] value="hunter2"';
  const out = withNodes(tree);
  assert.equal(JSON.stringify(out.nodes).includes('hunter2'), false, 'the value came along for the ride');
  assert.equal(out.nodes[0].attrs.value, '[redacted]', 'the field should say a value was there');
});

test('a field named like a secret is redacted even without the type marker', () => {
  const out = withNodes('- textbox "Password" [ref=e8] value="hunter2"');
  assert.equal(out.nodes[0].attrs.value, '[redacted]');
});

test('a placeholder does not get to be the name', () => {
  const out = withNodes('- textbox [ref=e9] [placeholder="Search everything"]');
  assert.equal(out.nodes[0].name, null, 'a nameless field must not borrow its placeholder');
});

test('a line we cannot read is counted, not given an invented role', () => {
  const out = withNodes(['- link "ok" [ref=e1]', 'not a row at all', '???'].join('\n'));
  assert.equal(out.nodes.length, 1);
  assert.equal(out.nodesUnparsed, 2);
});

test('nodes are bounded, and say so when they hit the bound', () => {
  const many = Array.from({ length: 50 }, (_, i) => '- link "row ' + i + '" [ref=e' + i + ']').join('\n');
  const out = withNodes(many, 'tree', 20000, { maxNodes: 10 });
  assert.equal(out.nodes.length, 10);
  assert.equal(out.nodesTruncated, true);
});

// interactive mode drops headings and text rows on purpose, so the grouping this feature
// exists for is not available there. Pinned rather than discovered.
test('interactive mode has no text rows to group by, and the nodes say so', () => {
  const out = withNodes(TREE, 'interactive');
  assert.equal(out.nodes.some((n) => n.role === 'text'), false);
});

// A structured view that blows the envelope is not a view: the shrinker drops keys and the
// caller loses the tree as well. Nodes spend the same budget the tree does.
// The regression that made this opt-in: a middle-sized page fitted the 65536-byte envelope
// before nodes existed and did not after. The check is on the whole payload, because the
// envelope is what the caller loses.
test('a page that fitted before still fits when nobody asked for nodes', () => {
  const rows = [];
  for (let i = 0; i < 280; i++) {
    rows.push('  - link "row ' + i + ' with a fairly long accessible name for budget testing" [ref=e' + i + ']');
  }
  const tree = rows.join('\n');
  const plain = summarizeTree(tree, 'tree', 20000);
  assert.equal(plain.nodes.length, 0, 'nodes must not ride along uninvited');
  assert.ok(JSON.stringify(plain).length < 65536, 'the default payload grew: ' + JSON.stringify(plain).length);
});

test('asking for nodes keeps them inside their own budget', () => {
  const rows = [];
  for (let i = 0; i < 1200; i++) {
    rows.push('  - link "row ' + i + ' with a fairly long accessible name for budget testing" [ref=e' + i + ']');
  }
  const out = withNodes(rows.join('\n'));
  assert.equal(out.nodesTruncated, true, 'a 1200-row page should not fit');
  assert.ok(JSON.stringify(out.nodes).length <= 12000, 'nodes overflowed their budget: ' + JSON.stringify(out.nodes).length);
  assert.ok(out.nodes.length > 0);
});

// The flag has to exist on the two jobs a caller actually sends, or the parser is unreachable.
test('a job can ask for nodes, and does not get them by accident', () => {
  const asked = validateJob({ urls: ['https://a.test'], snapshot: 'tree', treeNodes: true }, { enabled: true });
  assert.equal(asked.treeNodes, true);
  const quiet = validateJob({ urls: ['https://a.test'], snapshot: 'tree' }, { enabled: true });
  assert.equal(quiet.treeNodes, false);

  const attached = validateAttach({ targetId: 'T1', snapshot: 'tree', treeNodes: true });
  assert.equal(attached.treeNodes, true);
  assert.equal(validateAttach({ targetId: 'T1', snapshot: 'tree' }).treeNodes, false);
});

// The generated script travels as a command-line argument with a hard ceiling, and the
// fullest acting job runs near it. How near is measured where it is enforced, in
// test/browse-tabs.test.js, which fails below 1,000 characters of headroom; a number
// repeated here would go stale the first time the script changed. A parser nobody asked
// for is not allowed to spend that margin.
test('the parser is only in the wire when the job asked for it', () => {
  const base = { urls: ['https://a.test'], snapshot: 'tree' };
  const without = compile(validateJob(base, { enabled: true }));
  const withIt = compile(validateJob({ ...base, treeNodes: true }, { enabled: true }));
  assert.equal(without.includes('summarizeNodes'), false, 'the parser rode along uninvited');
  assert.ok(withIt.includes('summarizeNodes'));
  assert.ok(withIt.length > without.length);
});
