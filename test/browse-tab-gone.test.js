// A bound tab that disappears.
//
// agent-browser shipped the mistake this guards against and had to fix it: parallel
// sessions sharing one Chrome hijacked each other's tabs, because the default when a bound
// tab was missing was to take the nearest one. Our selection order already refuses that for
// a named tab - the value of this file is that it stays refused, and that the failure says
// enough for a caller to do something other than guess.
//
// playwright-mcp #1588 is the case for saying enough: given an undifferentiated "target
// closed", a model retries a navigation that cannot work, because the state it would have
// branched on was never reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createAttach, compileAttach } from '../src/host/browse/attach.js';
import { createTabJournal } from '../src/host/browse/tab-journal.js';

const dirFor = (name) => path.join(os.tmpdir(), 'codemode-tabgone-test-' + process.pid + '-' + name);
const ev = (o) => JSON.stringify({ type: 'tab', ...o });

// The compiled attach script, run against a fake tab list, so the selection really is the
// shipped one and not a re-description of it.
function runAttachScript(req, tabs, { attachThrows = false } = {}) {
  const src = compileAttach(req);
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  const printed = [];
  const fn = new AsyncFn('listBrowserTabs', 'attachBrowserTab', 'attachActiveBrowserTab', 'console', src);
  return fn(
    async () => tabs,
    async (targetId) => {
      if (attachThrows) throw new Error('No target with given id found');
      throw new Error('attachBrowserTab must not be reached for ' + targetId);
    },
    async () => { throw new Error('the active tab must not be adopted when a tab was named'); },
    { log: (s) => printed.push(String(s)) },
  ).then(() => JSON.parse(printed[printed.length - 1]));
}

const OPEN_TABS = [
  { targetId: 'T-someones-email', url: 'https://mail.test/inbox', title: 'Inbox', active: true },
  { targetId: 'T-someones-bank', url: 'https://bank.test/', title: 'Bank', active: false },
];

test('a tab that was named and is gone does not become the tab next to it', async () => {
  const out = await runAttachScript({ mode: 'read', targetId: 'T-ours' }, OPEN_TABS);
  const err = out.rows.find((r) => r.kind === 'error');
  assert.ok(err, 'the run has to have produced an error row: ' + JSON.stringify(out.rows.map((r) => r.kind)));
  assert.equal(err.code, 'ETABGONE');
  assert.equal(err.targetId, 'T-ours');
  assert.equal(out.rows.some((r) => r.kind === 'page'), false, 'no page may be returned when the named tab is gone');
});

test('a tab that goes between the list and the attach reads the same as one already gone', async () => {
  // The race the first test cannot reach: it was in the list, and by the time we asked for
  // it, it was not. Before this it surfaced as a generic attach failure, which is the
  // undifferentiated answer the whole code split exists to stop producing.
  const tabs = OPEN_TABS.concat([{ targetId: 'T-ours', url: 'https://portal.test/course/7', title: 'Course', active: false }]);
  const out = await runAttachScript({ mode: 'read', targetId: 'T-ours' }, tabs, { attachThrows: true });
  const err = out.rows.find((r) => r.kind === 'error');
  assert.ok(err, 'rows were ' + JSON.stringify(out.rows.map((r) => r.kind)));
  assert.equal(err.code, 'ETABGONE');
  assert.equal(err.targetId, 'T-ours');
  assert.equal(out.rows.some((r) => r.kind === 'page'), false);
});

test('a selector that matched nothing is a different failure from a tab that is gone', async () => {
  const out = await runAttachScript({ mode: 'read', urlIncludes: 'nowhere.test' }, OPEN_TABS);
  const err = out.rows.find((r) => r.kind === 'error');
  assert.ok(err);
  assert.equal(err.code, 'ENOTAB', 'a substring that matched nothing is not a tab that disappeared');
  assert.notEqual(err.code, 'ETABGONE');
});

test('the failure carries what a recovery needs, and null where it does not know', async () => {
  const journal = createTabJournal({ dir: dirFor('known'), pid: 909090, isAlive: () => false });
  journal.record({ runId: 'run-old', stdout: ev({ ev: 'open', targetId: 'T-ours', url: 'https://portal.test/course/7', jobId: 'j000' }) });
  const attach = createAttach({
    config: { browseCaps: { enabled: true } },
    session: { raw: async () => ({ rows: [{ kind: 'error', code: 'ETABGONE', targetId: 'T-ours', message: 'gone', tabs: OPEN_TABS }] }) },
    tabJournal: journal,
  });
  const res = await attach.attach({ targetId: 'T-ours' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ETABGONE');
  assert.equal(res.targetId, 'T-ours');
  assert.equal(res.lastUrl, 'https://portal.test/course/7', 'the journal knew where this tab was');
  assert.equal(typeof res.boundAt, 'number');
  assert.deepEqual(res.tabs.map((t) => t.targetId), ['T-someones-email', 'T-someones-bank'],
    'the tabs that ARE open travel with the failure, so the caller can choose without a second call');
  journal.forget('run-old');
});

test('an id the journal saw at two different pages answers null, not the newer one', async () => {
  // A reused id. Reporting the newer url would hand back a page that has nothing to do with
  // the tab the caller lost, and a wrong page given confidently is worse than no page.
  const journal = createTabJournal({ dir: dirFor('ambiguous'), pid: 939393, isAlive: () => false });
  journal.record({ runId: 'run-a', stdout: ev({ ev: 'open', targetId: 'T-reused', url: 'https://portal.test/a', jobId: 'j000' }) });
  journal.record({ runId: 'run-b', stdout: ev({ ev: 'open', targetId: 'T-reused', url: 'https://elsewhere.test/b', jobId: 'j000' }) });
  const attach = createAttach({
    config: { browseCaps: { enabled: true } },
    session: { raw: async () => ({ rows: [{ kind: 'error', code: 'ETABGONE', targetId: 'T-reused', message: 'gone', tabs: [] }] }) },
    tabJournal: journal,
  });
  const res = await attach.attach({ targetId: 'T-reused' });
  assert.equal(res.code, 'ETABGONE');
  assert.equal(res.lastUrl, null, 'two pages behind one id is not knowledge');
  // Control: one record alone does answer, so the null above came from the ambiguity.
  journal.forget('run-b');
  const again = await attach.attach({ targetId: 'T-reused' });
  assert.equal(again.lastUrl, 'https://portal.test/a');
  journal.forget('run-a');
});

test('a tab this tool never opened leaves lastUrl null rather than a guess', async () => {
  const journal = createTabJournal({ dir: dirFor('unknown'), pid: 919191, isAlive: () => false });
  const attach = createAttach({
    config: { browseCaps: { enabled: true } },
    session: { raw: async () => ({ rows: [{ kind: 'error', code: 'ETABGONE', targetId: 'T-theirs', message: 'gone', tabs: [] }] }) },
    tabJournal: journal,
  });
  const res = await attach.attach({ targetId: 'T-theirs' });
  assert.equal(res.code, 'ETABGONE');
  assert.equal(res.lastUrl, null, 'a url we never saw must not be invented');
  assert.equal(res.boundAt, null);
});

test('a tab disappearing does not decide what a write did', async () => {
  const journal = createTabJournal({ dir: dirFor('effects'), pid: 929292, isAlive: () => false });
  const attach = createAttach({
    config: { browseCaps: { enabled: true } },
    session: { raw: async () => ({ rows: [{ kind: 'error', code: 'ETABGONE', targetId: 'T-ours', message: 'gone', tabs: [] }] }) },
    tabJournal: journal,
  });
  // A real write, not a bare read: the flag is about what a sent step might have done, so
  // asserting it on a request that sent nothing would prove nothing.
  const res = await attach.attach({ targetId: 'T-ours', refsFingerprint: 'r1-test', approveWrites: true, refsFingerprint: 'r1-test', actions: [{ ref: 'e1', click: true }] });
  // The tab being gone is an observation about the tab. If a click was sent before it went,
  // the click's outcome is not known, and ok:false must not be read as "nothing happened".
  assert.equal(res.effectsUnknown, true);
  assert.equal(res.ok, false);
  const other = await createAttach({
    config: { browseCaps: { enabled: true } },
    session: { raw: async () => ({ rows: [{ kind: 'error', code: 'ENOTAB', message: 'no match', tabs: [] }] }) },
    tabJournal: journal,
  }).attach({ urlIncludes: 'nowhere' });
  assert.equal(other.effectsUnknown, false, 'a selector that matched nothing never sent anything');
});
