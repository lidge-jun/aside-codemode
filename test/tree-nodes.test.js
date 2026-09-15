// The tree comes back as one string with the hierarchy carried by indentation. Pulling a
// grouped row out of it - a course, its assignment, its due date - meant splitting lines in
// guest code and running a small state machine, because there is no DOM query on this surface.
// The same string, parsed once where it is produced, answers that with a depth comparison.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTree } from '../src/host/browse/script.js';

const TREE = [
  '- document "과제: 262R 인간관계와 마음건강" [ref=e1]',
  '  - link "과제 및 평가" [ref=e21]',
  '  - heading "공지" [ref=e5]',
  '  - iframe [ref=f3e14]',
  '    - button "제출" [ref=e99]',
  '    - text: 제출 기한 2026-09-16',
].join('\n');

test('the tree arrives as nodes whose depth matches the indentation', () => {
  const out = summarizeTree(TREE, 'tree', 20000);
  assert.ok(Array.isArray(out.nodes), 'no structured view at all');
  assert.equal(out.nodes.length, 6);
  assert.deepEqual(out.nodes.map((n) => n.depth), [0, 1, 1, 1, 2, 2]);
  assert.deepEqual(out.nodes.map((n) => n.role), ['document', 'link', 'heading', 'iframe', 'button', 'text']);
});

test('a row that carries its name after a colon is named too', () => {
  const out = summarizeTree(TREE, 'tree', 20000);
  const due = out.nodes.find((n) => n.role === 'text');
  assert.equal(due.name, '제출 기한 2026-09-16', 'without this the grouping has nothing to read');
});

test('refs on nodes are the refs the flat list already gave', () => {
  const out = summarizeTree(TREE, 'tree', 20000);
  const byRef = new Map(out.refs.map((r) => [r.ref, r]));
  for (const node of out.nodes) {
    if (!node.ref) continue;
    assert.ok(byRef.has(node.ref), 'node ref ' + node.ref + ' is not in refs');
    assert.equal(byRef.get(node.ref).role, node.role);
  }
});

// The grouping this exists for: take a parent and everything under it, without a regex.
test('a subtree can be collected by depth alone', () => {
  const out = summarizeTree(TREE, 'tree', 20000);
  const start = out.nodes.findIndex((n) => n.role === 'iframe');
  const under = [];
  for (let i = start + 1; i < out.nodes.length && out.nodes[i].depth > out.nodes[start].depth; i++) under.push(out.nodes[i]);
  assert.deepEqual(under.map((n) => n.role), ['button', 'text']);
  assert.equal(under[1].name, '제출 기한 2026-09-16');
});

test('a password value never reaches the structured view', () => {
  const tree = '- textbox "pw" [ref=e7] [type=password] value="hunter2"';
  const out = summarizeTree(tree, 'tree', 20000);
  assert.equal(JSON.stringify(out.nodes).includes('hunter2'), false, 'the value came along for the ride');
});

test('nodes are bounded, and say so when they hit the bound', () => {
  const many = Array.from({ length: 50 }, (_, i) => '- link "row ' + i + '" [ref=e' + i + ']').join('\n');
  const out = summarizeTree(many, 'tree', 20000, { maxNodes: 10 });
  assert.equal(out.nodes.length, 10);
  assert.equal(out.nodesTruncated, true);
});

// interactive mode drops headings and text rows on purpose, so the grouping this feature
// exists for is not available there. Pinned rather than discovered.
test('interactive mode has no text rows to group by, and the nodes say so', () => {
  const out = summarizeTree(TREE, 'interactive', 20000);
  assert.equal(out.nodes.some((n) => n.role === 'text'), false);
});

// A structured view that blows the envelope is not a view: the shrinker drops keys and the
// caller loses the tree as well. Nodes spend the same budget the tree does.
test('nodes share the tree budget instead of adding a second payload', () => {
  const rows = [];
  for (let i = 0; i < 1200; i++) {
    rows.push('  - link "row ' + i + ' with a fairly long accessible name for budget testing" [ref=e' + i + ']');
  }
  const out = summarizeTree(rows.join('\n'), 'tree', 20000);
  assert.equal(out.nodesTruncated, true, 'a 1200-row page should not fit');
  assert.ok(JSON.stringify(out.nodes).length <= 20000 * 2, 'nodes are still unbounded: ' + JSON.stringify(out.nodes).length);
  assert.ok(out.nodes.length > 0, 'the budget cannot be so tight that nothing survives');
});
