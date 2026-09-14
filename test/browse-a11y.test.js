// Aside is accessibility-first and codemode was throwing that away.
//
// script.js fetches the real a11y snapshot for EVERY page, because block detection reads
// it, and then kept only tree.length. The tree was already paid for and already in memory;
// the only thing missing was a way to ask for it. These pin that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, summarizeTree } from '../src/host/browse/script.js';
import { validateJob, normalizeSnapshot } from '../src/host/browse/schema.js';
import { compileAttach } from '../src/host/browse/attach.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';

// Real Aside snapshot rows, including the child-frame row that makes iframe content
// reachable without knowing the frame url.
const TREE = [
  '- document "과제: 262R 인간관계와 마음건강" [ref=e1]',
  '  - link "과제 및 평가" [ref=e21]',
  '  - heading "공지" [ref=e5]',
  '  - iframe [ref=f3e14]',
  '    - button "제출" [ref=e99]',
  '    - text: 제출 기한 2026-09-16',
].join('\n');

test('snapshot accepts the old boolean and the new modes, and refuses anything else', () => {
  assert.equal(normalizeSnapshot(undefined), false);
  assert.equal(normalizeSnapshot(false), false);
  assert.equal(normalizeSnapshot(true), 'bytes', 'the historical true must keep meaning length-only');
  assert.equal(normalizeSnapshot('tree'), 'tree');
  assert.equal(normalizeSnapshot('interactive'), 'interactive');
  assert.throws(() => normalizeSnapshot('everything'), /snapshot must be/);
  assert.throws(() => validateJob({ urls: ['https://a.test'], maxTreeChars: 0 }), /maxTreeChars/);
});

test('tree mode returns the whole tree, child frames included', () => {
  const out = summarizeTree(TREE, 'tree', 20000);
  assert.ok(out.tree.includes('[ref=f3e14]'), 'a child frame is a row in the tree, not a separate fetch');
  assert.ok(out.tree.includes('제출 기한 2026-09-16'), 'content inside the frame comes with it');
  assert.equal(out.refCount, 5);
});

test('interactive mode keeps what you can act on and drops the rest', () => {
  const full = summarizeTree(TREE, 'tree', 20000);
  const small = summarizeTree(TREE, 'interactive', 20000);
  assert.ok(small.chars < full.chars, 'the whole point is that it is smaller');
  assert.ok(small.tree.includes('[ref=e21]'), 'the link survives');
  assert.ok(small.tree.includes('[ref=e99]'), 'the button survives');
  assert.ok(small.tree.includes('[ref=f3e14]'), 'the frame survives, it is how you reach inside');
  assert.equal(small.tree.includes('[ref=e5]'), false, 'a heading is not actionable');
  assert.equal(small.tree.includes('제출 기한'), false, 'plain text rows are dropped');
});

test('refs carry role and name so a ref click can be chosen by meaning', () => {
  const { refs } = summarizeTree(TREE, 'interactive', 20000);
  const link = refs.find((r) => r.ref === 'e21');
  assert.deepEqual(
    { role: link.role, name: link.name, actionable: link.actionable },
    { role: 'link', name: '과제 및 평가', actionable: true },
  );
  const frame = refs.find((r) => r.ref === 'f3e14');
  assert.equal(frame.role, 'iframe');
  assert.equal(frame.actionable, true);
  assert.equal(refs.find((r) => r.ref === 'e5').actionable, false);
});

test('a huge tree is capped and says so instead of silently shipping megabytes', () => {
  const out = summarizeTree(TREE, 'tree', 20);
  assert.equal(out.truncated, true);
  assert.equal(out.tree.length, 20);
  assert.ok(out.chars > 20, 'chars reports the real size, not the truncated one');
});

test('an empty or missing tree does not throw', () => {
  for (const v of ['', null, undefined]) {
    const out = summarizeTree(v, 'interactive', 100);
    assert.equal(out.refCount, 0);
    assert.equal(out.truncated, false);
  }
});

test('the summariser is injected into the compiled script, not reimplemented there', () => {
  const src = compile(validateJob({ urls: ['https://a.test'], snapshot: 'interactive' }));
  assert.ok(src.includes('function summarizeTree'), 'one source of truth, injected');
  assert.match(src, /"snapshot":"interactive"/);
  assert.match(src, /"maxTreeChars":20000/);
});

test('the tree is fetched for every page regardless, so exposing it costs nothing extra', () => {
  const src = compile(validateJob({ urls: ['https://a.test'] }));
  // Not inside an if (JOB.snapshot) guard: block detection needs it on every item.
  assert.ok(src.includes('const snap = await snapshot(page)'), 'the unconditional fetch must stay');
  assert.ok(src.indexOf('const snap = await snapshot(page)') < src.indexOf('if (JOB.snapshot)'),
    'the fetch happens before anyone asks for the snapshot option');
});

test('browse.attach can ask for the same tree from the live tab', () => {
  const req = validateAttach({ urlIncludes: 'korea.ac.kr', snapshot: 'interactive' });
  assert.equal(req.snapshot, 'interactive');
  const src = compileAttach(req);
  assert.ok(src.includes('function summarizeTree'));
  assert.ok(src.includes('await snapshot(page)'));
  assert.equal(validateAttach({ urlIncludes: 'x', snapshot: true }).snapshot, 'tree');
  assert.throws(() => validateAttach({ urlIncludes: 'x', snapshot: 'all' }), /snapshot must be/);
});

