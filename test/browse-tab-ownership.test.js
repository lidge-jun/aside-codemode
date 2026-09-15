// Tab ownership. The measured fact this answers: a killed CLI leaks its tabs permanently
// and no later session can close them - not because closing is hard, but because nothing
// recorded which tabs were ours.
//
// The assertion that matters most in this file is the negative one. A tab absent from the
// journal is never a candidate, and that is the whole of the promise that somebody's own
// tabs are left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createTabJournal, parseTabEvents, stillOpen } from '../src/host/browse/tab-journal.js';

const ev = (o) => JSON.stringify({ type: 'tab', ...o });
const dirFor = (name) => path.join(os.tmpdir(), 'codemode-tabs-test-' + process.pid + '-' + name);

test('a tab that was opened and closed is not left behind', () => {
  const stdout = [
    ev({ ev: 'open', targetId: 'T1', url: 'https://a.test/1', jobId: 'j000' }),
    ev({ ev: 'open', targetId: 'T2', url: 'https://a.test/2', jobId: 'j001' }),
    ev({ ev: 'close', targetId: 'T1' }),
    '[ok | 5ms]',
  ].join('\n');
  const events = parseTabEvents(stdout);
  assert.equal(events.length, 3, 'the parse has to find them before the rest means anything');
  const open = stillOpen(events);
  assert.deepEqual(open.map((t) => t.targetId), ['T2']);
});

test('a line that arrived half written is not guessed at', () => {
  const stdout = ev({ ev: 'open', targetId: 'T1', url: 'https://a.test/1', jobId: 'j000' })
    + '\n{"type":"tab","ev":"open","targetId":"T2","ur';
  const events = parseTabEvents(stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].targetId, 'T1');
});

test('a tab with no id is not carried, because it could never be named later', () => {
  const open = stillOpen(parseTabEvents(ev({ ev: 'open', targetId: null, url: 'https://a.test/1', jobId: 'j000' })));
  assert.deepEqual(open, []);
});

test('a dead run leaves tabs a later session can name', () => {
  let clock = 1_000_000;
  const dead = 999001;
  const journal = createTabJournal({
    dir: dirFor('dead'), now: () => clock, pid: dead, isAlive: () => false, staleAfterMs: 1000,
  });
  journal.record({
    runId: 'run-dead',
    stdout: [
      ev({ ev: 'open', targetId: 'T-ours', url: 'https://portal.test/a', jobId: 'j000' }),
      ev({ ev: 'open', targetId: 'T-closed', url: 'https://portal.test/b', jobId: 'j001' }),
      ev({ ev: 'close', targetId: 'T-closed' }),
    ].join('\n'),
    urls: ['https://portal.test/a', 'https://portal.test/b'],
  });
  // A later session: different pid, and the browser currently shows one of ours plus two
  // the person opened themselves.
  const later = createTabJournal({ dir: dirFor('dead'), now: () => clock, pid: dead + 1, isAlive: () => false });
  const found = later.orphans(['T-ours', 'T-someones-email', 'tab:T-someones-bank']);
  assert.equal(found.length, 1, 'got ' + JSON.stringify(found.map((t) => t.targetId)));
  assert.equal(found[0].targetId, 'T-ours');
  assert.equal(found[0].runId, 'run-dead');
  assert.equal(found[0].url, 'https://portal.test/a', 'the url is reported beside the id, because ids can be reused');
  journal.forget('run-dead');
});

test('a tab this tool never opened is never named, whatever else is true', () => {
  const journal = createTabJournal({ dir: dirFor('never'), pid: 424242, isAlive: () => false });
  journal.record({ runId: 'run-x', stdout: ev({ ev: 'open', targetId: 'T-ours', url: 'https://a.test/1', jobId: 'j000' }) });
  const later = createTabJournal({ dir: dirFor('never'), pid: 424243, isAlive: () => false });
  const userTabs = ['T-someones-email', 'T-someones-bank', 'T-someones-doc'];
  assert.deepEqual(later.orphans(userTabs), [], 'a tab outside the journal must never be a candidate');
  // And with ours present it finds exactly ours, so the empty answer above was not empty
  // for some unrelated reason.
  assert.equal(later.orphans(userTabs.concat(['T-ours'])).length, 1);
  journal.forget('run-x');
});

test('a reused target id does not borrow our claim', () => {
  // The url was being recorded for exactly this and then not used, which a review caught.
  // Browsers reuse target ids: the id we wrote down comes back attached to a tab the person
  // opened themselves, and naming that one breaks the only promise here.
  const journal = createTabJournal({ dir: dirFor('reuse'), pid: 818181, isAlive: () => false });
  journal.record({ runId: 'run-reuse', stdout: ev({ ev: 'open', targetId: 'T7', url: 'https://portal.test/a', jobId: 'j000' }) });
  const later = createTabJournal({ dir: dirFor('reuse'), pid: 818182, isAlive: () => false });

  const theirs = later.orphans([{ targetId: 'T7', url: 'https://someones-bank.test/accounts' }]);
  assert.deepEqual(theirs, [], 'same id, different page: that is not our tab');

  // And the positive control, so the empty answer above was not empty for some other reason.
  const ours = later.orphans([{ targetId: 'T7', url: 'https://portal.test/a' }]);
  assert.equal(ours.length, 1);
  assert.equal(ours[0].targetId, 'T7');
  journal.forget('run-reuse');
});

test('a run that is still alive is not reported as having abandoned anything', () => {
  const journal = createTabJournal({ dir: dirFor('alive'), pid: 515151, isAlive: () => true });
  journal.record({ runId: 'run-live', stdout: ev({ ev: 'open', targetId: 'T-live', url: 'https://a.test/1', jobId: 'j000' }) });
  const other = createTabJournal({ dir: dirFor('alive'), pid: 515152, isAlive: () => true });
  assert.deepEqual(other.orphans(['T-live']), []);
  journal.forget('run-live');
});

test('a run that closed everything writes nothing to find later', () => {
  const journal = createTabJournal({ dir: dirFor('clean'), pid: 626262, isAlive: () => false });
  const written = journal.record({
    runId: 'run-clean',
    stdout: [ev({ ev: 'open', targetId: 'T1', url: 'https://a.test/1', jobId: 'j000' }), ev({ ev: 'close', targetId: 'T1' })].join('\n'),
  });
  assert.equal(written, null);
  const later = createTabJournal({ dir: dirFor('clean'), pid: 626263, isAlive: () => false });
  assert.deepEqual(later.orphans(['T1']), []);
});

test('a journal entry for a tab that is gone is not reported as still open', () => {
  const journal = createTabJournal({ dir: dirFor('gone'), pid: 737373, isAlive: () => false });
  journal.record({ runId: 'run-gone', stdout: ev({ ev: 'open', targetId: 'T-gone', url: 'https://a.test/1', jobId: 'j000' }) });
  const later = createTabJournal({ dir: dirFor('gone'), pid: 737374, isAlive: () => false });
  // The person already closed it. Naming it would send someone looking for a tab that is
  // not there.
  assert.deepEqual(later.orphans(['T-something-else']), []);
  journal.forget('run-gone');
});
