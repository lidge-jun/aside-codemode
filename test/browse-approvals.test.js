// Approving a refused batch, and the four ways a second caller can be wrong about it.
//
// The counter that matters in this file is how many times the CLI was spawned. Every one of
// these tests could pass on returned statuses alone while the run went out twice, so the
// spawn count is asserted next to the status, not instead of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createBrowse } from '../src/host/browse/browse.js';
import { createApprovals, isApprovalId } from '../src/host/browse/approvals.js';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const FINAL = JSON.stringify({
  type: 'final', leakedUrls: [], partial: [],
  items: [{ jobId: 'j000', url: 'https://a.test/1', ok: true }],
}) + '\n[ok | 5ms]';

function harness() {
  const spawns = [];
  const browse = createBrowse({
    config: { browseCaps: { enabled: true } },
    resolveAside: async () => 'C:/fake/aside.exe',
    spawnAside: async (bin, args) => { spawns.push(args); return { stdout: FINAL, killed: false }; },
  });
  return { browse, spawns };
}

const writingJob = (url = 'https://a.test/1') => ({ urls: [url], actions: [{ ref: 'e1', click: true }] });

test('a refusal hands back an id that can actually be named', async () => {
  const { browse, spawns } = harness();
  const refused = await browse.exec(writingJob());
  assert.equal(refused.status, 'needs_input');
  assert.match(String(refused.approvalId), /^approval-/);
  assert.ok(refused.expiresAt > Date.now(), 'an approval that is already expired is not an offer');
  assert.equal(spawns.length, 0, 'the refusal must not have started anything');
});

test('approving runs it once, under its own run id', async () => {
  const { browse, spawns } = harness();
  const refused = await browse.exec(writingJob());
  const ran = await browse.approve({ approvalId: refused.approvalId });
  assert.equal(ran.status, 'completed');
  assert.equal(spawns.length, 1);
  assert.equal(ran.changed, true);
  // Two envelopes, two run ids. One id pointing at both answers would stop identifying
  // either of them, and nothing in the contract checker would notice.
  assert.notEqual(ran.runId, refused.runId);
  assert.equal(ran.approvalId, refused.approvalId, 'the pair has to be joinable');
});

test('approving twice changes nothing and says what it found', async () => {
  const { browse, spawns } = harness();
  const refused = await browse.exec(writingJob());
  const first = await browse.approve({ approvalId: refused.approvalId });
  const second = await browse.approve({ approvalId: refused.approvalId });
  assert.equal(spawns.length, 1, 'the second approval must not have run the batch again');
  assert.equal(second.ok, false);
  assert.equal(second.changed, false);
  assert.equal(second.state, 'claimed');
  assert.equal(second.runId, first.runId, 'it reports the run that did happen, not a new one');
});

test('a run that already went out is never reported as rejected', async () => {
  const { browse, spawns } = harness();
  const refused = await browse.exec(writingJob());
  await browse.approve({ approvalId: refused.approvalId });
  const rejected = await browse.reject({ approvalId: refused.approvalId });
  assert.equal(spawns.length, 1);
  assert.equal(rejected.changed, false);
  assert.equal(rejected.state, 'claimed',
    'telling someone their run was rejected when the clicks already went out is the one wrong answer here');
  assert.notEqual(rejected.state, 'rejected');
});

test('rejecting a pending one settles it, and approving after that does nothing', async () => {
  const { browse, spawns } = harness();
  const refused = await browse.exec(writingJob());
  const rejected = await browse.reject({ approvalId: refused.approvalId });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.state, 'rejected');
  const late = await browse.approve({ approvalId: refused.approvalId });
  assert.equal(late.ok, false);
  assert.equal(late.state, 'rejected');
  assert.equal(spawns.length, 0, 'nothing may run after a rejection');
});

test('an id nobody issued is unknown, not a failure to interpret', async () => {
  const { browse } = harness();
  const res = await browse.approve({ approvalId: 'approval-00000000-0000-0000-0000-000000000000' });
  assert.equal(res.ok, false);
  assert.equal(res.state, 'unknown');
});

test('there is no implicit current run', async () => {
  const { browse } = harness();
  await assert.rejects(() => browse.approve({}), (e) => e.code === 'EBADVAL');
  await assert.rejects(() => browse.reject({}), (e) => e.code === 'EBADVAL');
});

test('an expired approval is not claimable', () => {
  let clock = 1000;
  const dir = path.join(os.tmpdir(), 'codemode-approvals-test-' + process.pid + '-expiry');
  const store = createApprovals({ dir, ttlMs: 500, now: () => clock });
  const rec = store.open({ job: {}, wants: ['click'], urls: ['https://a.test/1'] });
  clock += 501;
  const claimed = store.claim(rec.approvalId);
  assert.equal(claimed.ok, false);
  assert.equal(claimed.state, 'expired');
  assert.equal(store.read(rec.approvalId).state, 'pending', 'expiry does not move the record, it refuses to act on it');
});

test('an id that tries to leave the directory is not an id', async () => {
  // Found by review, not by imagination: "../pending/<real-id>" makes the claim rename's
  // source and destination the same file, and renaming a file onto itself SUCCEEDS. Every
  // caller would then win, and it would look like a claim from the inside. The shape check
  // is the whole defence, so it is asserted at both layers.
  const { browse, spawns } = harness();
  const refused = await browse.exec(writingJob());
  const escaped = '../pending/' + refused.approvalId;
  const res = await browse.approve({ approvalId: escaped });
  assert.equal(res.ok, false);
  assert.equal(res.state, 'unknown', 'a path is not an id, and must not resolve to one');
  assert.equal(spawns.length, 0);
  // And the real id still works afterwards, exactly once.
  const ran = await browse.approve({ approvalId: refused.approvalId });
  assert.equal(ran.status, 'completed');
  assert.equal(spawns.length, 1);
  assert.equal(isApprovalId(escaped), false);
  assert.equal(isApprovalId(refused.approvalId), true);
});

test('a stored job is validated again on the way out', async () => {
  // The record sits in a shared temp directory. A job that skipped validation because it
  // had been validated once, somewhere else, earlier, is a job nobody is checking now.
  const { browse, spawns } = harness();
  const refused = await browse.exec(writingJob());
  const store = createApprovals();
  const file = path.join(store.dir, 'pending', refused.approvalId + '.json');
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  rec.job.thisOptionDoesNotExist = true;
  writeFileSync(file, JSON.stringify(rec), 'utf8');
  await assert.rejects(() => browse.approve({ approvalId: refused.approvalId }), (e) => e.code === 'EBADOPT');
  assert.equal(spawns.length, 0, 'an altered record must not run');
});

test('a stored job is not world readable', { skip: process.platform === 'win32' ? 'POSIX mode bits do not carry the same meaning here' : false }, async () => {
  // It carries the urls it will visit and the values it will type, and a fill value can be
  // a password. Skipped rather than wrapped in an if: a test that runs and asserts nothing
  // reports as a pass, and this file already had one of those.
  const { browse } = harness();
  const refused = await browse.exec({ urls: ['https://a.test/1'], actions: [{ ref: 'e1', fill: 'hunter2' }] });
  const store = createApprovals();
  const file = path.join(store.dir, 'pending', refused.approvalId + '.json');
  const mode = statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, 'the record is 0' + mode.toString(8) + ' in a shared temp directory');
});

test('records do not pile up in the temp directory forever', () => {
  // sweep() existed and nothing called it, which is the same as not having it. There is no
  // process that outlives a tool call to run a timer, so opening an approval pays for the
  // tidying — the one moment the directory is certainly in use.
  let clock = 1000;
  const dir = path.join(os.tmpdir(), 'codemode-approvals-test-' + process.pid + '-sweep');
  const store = createApprovals({ dir, ttlMs: 500, now: () => clock });
  const old = store.open({ job: {}, wants: ['click'], urls: ['https://a.test/1'] });
  assert.equal(store.read(old.approvalId).state, 'pending', 'the record has to exist before its removal means anything');
  clock += 500 + 24 * 60 * 60 * 1000 + 1;
  const fresh = store.open({ job: {}, wants: ['click'], urls: ['https://a.test/2'] });
  assert.equal(store.read(old.approvalId).state, 'unknown', 'the expired record should have been swept');
  assert.equal(store.read(fresh.approvalId).state, 'pending', 'and the new one must survive its own sweep');
});

test('a winner that dies before it starts leaves a state that says so', () => {
  const dir = path.join(os.tmpdir(), 'codemode-approvals-test-' + process.pid + '-crash');
  const store = createApprovals({ dir });
  const rec = store.open({ job: {}, wants: ['click'], urls: ['https://a.test/1'] });
  // Claim, then stop. This is the window rename cannot close: the record has moved and the
  // run id has not been written yet.
  const claimed = store.claim(rec.approvalId);
  assert.equal(claimed.ok, true);
  const seen = store.read(rec.approvalId);
  assert.equal(seen.state, 'claimed');
  assert.equal(seen.record.runId, null);
  assert.equal(seen.record.startedAt, null,
    'claimed with no start is neither ran nor did not run, and is reported as itself');
});
