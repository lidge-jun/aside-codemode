// wp6. What changed after the actions ran. Two independent reasons refuse the comparison,
// and a refusal hands back the new observation rather than a diff nobody can trust.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, parseRows, diffRefs, attachDiff } from '../src/host/browse/diff.js';
import { createBrowseSession } from '../src/host/browse/session.js';
import { validateJob } from '../src/host/browse/schema.js';

const obs = (url, tree) => ({ url, rows: parseRows(tree) });

test('a row is read as identity, state, attributes and depth, and they do not blur', () => {
  const row = parseRow('    - checkbox "Agree" [ref=e2] [checked] [placeholder="parent input"] value="on"');
  assert.equal(row.ref, 'e2');
  assert.equal(row.role, 'checkbox');
  assert.equal(row.name, 'Agree');
  assert.equal(row.depth, 2);
  assert.deepEqual(row.state, ['checked'], 'only allowlisted markers are state');
  assert.equal(row.attrs.placeholder, 'parent input', 'a placeholder is an attribute, not a state');
  assert.equal(row.attrs.value, 'on');
});

test('a tree that was re-minted under the same url refuses the comparison', () => {
  const before = obs('https://a.test', '- button "One" [ref=e1]\n- button "Two" [ref=e2]');
  const after = obs('https://a.test', '- button "One" [ref=e7]\n- button "Two" [ref=e8]');
  const d = diffRefs(before, after);
  assert.equal(d.comparable, false);
  assert.equal(d.reason, 're-minted', 'the url never moved, so only the rows can tell us');
  assert.equal(d.overlap, 0);
  assert.equal(d.beforeCount, 2);
});

test('a navigation refuses even when the two pages look alike', () => {
  const tree = '- button "One" [ref=e1]\n- button "Two" [ref=e2]';
  const d = diffRefs(obs('https://a.test', tree), obs('https://b.test', tree));
  assert.equal(d.comparable, false);
  assert.equal(d.reason, 'navigated');
  assert.equal(d.overlap, 1, 'the rows matched perfectly and it is still a different document');
});

test('a toggled checkbox is a state change on the row that moved', () => {
  const before = obs('https://a.test', '- checkbox "Agree" [ref=e1]\n- button "Go" [ref=e2]');
  const after = obs('https://a.test', '- checkbox "Agree" [ref=e1] [checked]\n- button "Go" [ref=e2]');
  const d = diffRefs(before, after);
  assert.equal(d.comparable, true);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].ref, 'e1');
  assert.deepEqual(d.changed[0].state, { from: [], to: ['checked'] });
  assert.equal(d.same, 1, 'the untouched button is not reported as a change');
});

test('text that appeared after a failed submit shows up as a static row', () => {
  const before = obs('https://a.test', '- button "Submit" [ref=e1]');
  const after = obs('https://a.test', '- button "Submit" [ref=e1]\n- text "Email is required"');
  const d = diffRefs(before, after);
  assert.equal(d.comparable, true);
  assert.equal(d.staticRows.added.length, 1);
  assert.match(d.staticRows.added[0], /Email is required/);
  assert.deepEqual(d.added, [], 'a row with no ref is not a new ref');
});

test('wrapping content in a dialog is a depth move, not a change', () => {
  const before = obs('https://a.test', '- button "Go" [ref=e1]\n- link "Home" [ref=e2]');
  const after = obs('https://a.test', '  - button "Go" [ref=e1]\n  - link "Home" [ref=e2]');
  const d = diffRefs(before, after);
  assert.equal(d.comparable, true);
  assert.equal(d.depthChanged.length, 2);
  assert.deepEqual(d.changed, [], 'nothing about these rows actually changed');
});

test('an option moving its selection is a pair of static rows, not a ref state', () => {
  // Aside prints option rows without a ref, so there is no ref whose state could move.
  const before = obs('https://a.test', '- combobox "Plan" [ref=e1]\n  - option "Free" (selected)\n  - option "Pro"');
  const after = obs('https://a.test', '- combobox "Plan" [ref=e1]\n  - option "Free"\n  - option "Pro" (selected)');
  const d = diffRefs(before, after);
  assert.equal(d.comparable, true);
  assert.equal(d.staticRows.added.length, 2);
  assert.equal(d.staticRows.removed.length, 2);
  assert.ok(d.staticRows.added.some((r) => /Pro" \(selected\)/.test(r)));
});

test('a password field reports that it moved and never what it moved to', () => {
  const before = obs('https://a.test', '- textbox "Password" [ref=e1] [type=password] value=""');
  const after = obs('https://a.test', '- textbox "Password" [ref=e1] [type=password] value="hunter2"');
  const d = diffRefs(before, after);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].attrs.to.value, '[redacted]');
  assert.equal(d.changed[0].attrs.from.value, '[redacted]');
  assert.ok(!JSON.stringify(d).includes('hunter2'), 'the secret must not survive anywhere in the report');
});

test('a password that appears for the first time is redacted too', async () => {
  // added[] carries the raw line, so redacting only inside changed[] left the value in the
  // report by another door.
  const before = obs('https://a.test', '- button "Sign in" [ref=e1]');
  const after = obs('https://a.test', '- button "Sign in" [ref=e1]\n- textbox "Password" [ref=e2] [type=password] value="hunter2"');
  const d = diffRefs(before, after);
  assert.equal(d.added.length, 1);
  assert.match(d.added[0], /\[redacted\]/);
  assert.ok(!JSON.stringify(d).includes('hunter2'));
});

test('a refused comparison hands back a tree with the secrets taken out', () => {
  const item = {
    url: 'https://a.test', finalUrl: 'https://b.test', urlBeforeActions: 'https://a.test',
    snapshot: { tree: '- button "Go" [ref=e1]', fingerprint: 'r1-abc' },
    snapshotAfter: {
      tree: '- textbox "Password" [ref=e2] [type=password] value="hunter2"',
      url: 'https://b.test', snapshotId: 'x|https://b.test', fingerprint: 'x',
    },
  };
  attachDiff(item);
  assert.match(item.snapshotAfter.reset.tree, /\[redacted\]/);
  assert.ok(!item.snapshotAfter.reset.tree.includes('hunter2'));
});

test('a row with no name does not borrow one from its placeholder', () => {
  const row = parseRow('- textbox [ref=e1] [placeholder="Search everything"]');
  assert.equal(row.name, '', 'the placeholder is not the accessible name');
  assert.equal(row.attrs.placeholder, 'Search everything');
});

test('attachDiff gives a refused comparison the new observation instead', () => {
  const item = {
    url: 'https://a.test', finalUrl: 'https://b.test', urlBeforeActions: 'https://a.test',
    snapshot: { tree: '- button "Go" [ref=e1]', fingerprint: 'r1-abc' },
    snapshotAfter: { tree: '- button "Go" [ref=e1]', url: 'https://b.test', snapshotId: 'r1-abc|https://b.test', fingerprint: 'r1-abc' },
  };
  attachDiff(item);
  assert.equal(item.snapshotAfter.diff.reason, 'navigated');
  assert.equal(item.snapshotAfter.baseSnapshotId, 'r1-abc|https://a.test');
  assert.equal(item.snapshotAfter.reset.snapshotId, 'r1-abc|https://b.test');
  assert.match(item.snapshotAfter.reset.tree, /button "Go"/);
});

test("a job asking for a diff without a snapshot is refused: there is nothing to compare against", () => {
  assert.throws(
    () => validateJob({ urls: ['https://a.test'], timeoutMs: 8000, snapshotAfter: 'diff', actions: [{ click: true, selector: '#go' }] }),
    (e) => e.code === 'EBADVAL' && /needs snapshot/.test(e.message),
  );
  assert.throws(
    () => validateJob({ urls: ['https://a.test'], timeoutMs: 5000, snapshotAfter: 'sometimes' }),
    (e) => e.code === 'EBADVAL',
  );
  // bytes ships a byte count, not a tree. Accepting it would report the whole page as new.
  assert.throws(
    () => validateJob({ urls: ['https://a.test'], timeoutMs: 5000, snapshot: true, snapshotAfter: 'diff' }),
    (e) => e.code === 'EBADVAL' && /tree.*interactive/.test(e.message),
  );
  assert.equal(
    validateJob({ urls: ['https://a.test'], timeoutMs: 5000, snapshot: 'tree', snapshotAfter: 'diff' }).snapshotAfter,
    'diff',
  );
});

test('the run attaches the comparison to every item that carries an observation', async () => {
  const finalLine = JSON.stringify({
    type: 'final', leakedUrls: [], partial: [],
    items: [{
      jobId: 'j000', url: 'https://a.test', ok: true, finalUrl: 'https://a.test',
      urlBeforeActions: 'https://a.test',
      snapshot: { tree: '- checkbox "Agree" [ref=e1]', fingerprint: 'r1-abc' },
      snapshotAfter: { tree: '- checkbox "Agree" [ref=e1] [checked]', url: 'https://a.test', snapshotId: 'r1-abc|https://a.test', fingerprint: 'r1-abc' },
    }],
  });
  const session = createBrowseSession({
    resolveAside: async () => 'C:/fake/aside.exe',
    spawnAside: async () => ({ stdout: finalLine + '\n[ok | 5ms]', killed: false }),
  });
  const res = await session.run({
    urls: ['https://a.test'], timeoutMs: 8000, snapshot: 'interactive', snapshotAfter: 'diff',
    actions: [{ click: true, selector: '#go' }], approveWrites: true,
  });
  const d = res.items[0].snapshotAfter.diff;
  assert.equal(d.comparable, true);
  assert.deepEqual(d.changed[0].state, { from: [], to: ['checked'] });
});
