// wp2: the result contract. A batch that returns fewer items than it was asked for used to
// report ok:true, and a duplicate url had no way to tell its two results apart. These cases
// pin the issuing ledger, the request/response reconciliation and the derived run status.
// The child is faked; npm test never launches a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowseSession, itemStatus, runStatus } from '../src/host/browse/session.js';

const resolveAside = async () => 'C:/fake/aside.exe';
const fakeSpawn = (stdout, killed = false) => async () => ({ stdout, killed });
const finalLine = (o) => JSON.stringify({ type: 'final', items: [], leakedUrls: [], partial: [], ...o });
const ok = (s) => s + '\n[ok | 5ms]';
const job3 = { urls: ['https://a.test', 'https://b.test', 'https://c.test'], timeoutMs: 5000 };
const dupe = { urls: ['https://a.test', 'https://a.test'], timeoutMs: 5000 };
const run = (stdout, job = job3, killed = false) =>
  createBrowseSession({ resolveAside, spawnAside: fakeSpawn(stdout, killed) }).run(job);

test('a run that returns fewer items than it was asked for is partial, not ok', async () => {
  const out = ok(finalLine({ items: [
    { jobId: 'j000', url: 'https://a.test', ok: true },
    { jobId: 'j001', url: 'https://b.test', ok: true },
  ] }));
  const res = await run(out);
  assert.equal(res.status, 'partial');
  assert.equal(res.ok, false);
  assert.equal(res.requested, 3);
  assert.equal(res.completed, 2);
  assert.equal(res.items.length, 3);
  assert.equal(res.items[2].code, 'EUNRETURNED');
  assert.equal(res.items[2].status, 'unreturned');
  assert.equal(res.items[2].url, 'https://c.test');
  assert.ok(res.partial.includes('unreturned'));
});

test('two requests for the same url keep their own results when completion order flips', async () => {
  const out = ok(finalLine({ items: [
    { jobId: 'j001', url: 'https://a.test', ok: true, title: 'second' },
    { jobId: 'j000', url: 'https://a.test', ok: true, title: 'first' },
  ] }));
  const res = await run(out, dupe);
  assert.equal(res.status, 'completed');
  assert.equal(res.items[0].jobId, 'j000');
  assert.equal(res.items[0].title, 'first');
  assert.equal(res.items[1].jobId, 'j001');
  assert.equal(res.items[1].title, 'second');
  assert.equal(res.reconciledBy, 'jobId');
});

test('a script that echoes no jobId is matched by position only when the count agrees', async () => {
  const out = ok(finalLine({ items: [
    { url: 'https://a.test', ok: true },
    { url: 'https://b.test', ok: true },
    { url: 'https://c.test', ok: true },
  ] }));
  const res = await run(out);
  assert.equal(res.reconciledBy, 'position');
  assert.equal(res.status, 'completed');
  assert.equal(res.ok, true);
  assert.equal(res.completed, 3);
  assert.ok(!res.partial.includes('extra-items'));
});

test('no jobId and a different count is unreconciled, and the returned work is preserved', async () => {
  const out = ok(finalLine({ items: [{ url: 'https://b.test', ok: true }] }));
  const res = await run(out);
  assert.equal(res.reconciledBy, 'none');
  assert.ok(res.partial.includes('unreconciled'));
  assert.equal(res.items.length, 3);
  assert.ok(res.items.every((i) => i.status === 'unreturned'));
  assert.equal(res.extraItems.length, 1);
  assert.equal(res.extraItems[0].url, 'https://b.test');
});

test('a mixed payload matches what it can and leaves the rest unreturned', async () => {
  const out = ok(finalLine({ items: [
    { jobId: 'j002', url: 'https://c.test', ok: true },
    { url: 'https://b.test', ok: true },
  ] }));
  const res = await run(out);
  assert.equal(res.items[2].status, 'completed');
  assert.equal(res.items[0].status, 'unreturned');
  assert.equal(res.reconciledBy, 'jobId');
});

test('a host kill is indeterminate, never failed: the tabs and the side effects are unknown', async () => {
  const res = await run('partial output', job3, true);
  assert.equal(res.status, 'indeterminate');
  assert.equal(res.ok, false);
  assert.equal(res.items.length, 3);
  assert.ok(res.items.every((i) => i.status === 'indeterminate'));
  assert.ok(res.items.every((i) => i.code === 'EHOSTKILL'));
  assert.equal(res.complete, false);
});

test('every item succeeded but a tab leaked, so the run is partial', async () => {
  const out = ok(finalLine({
    items: [0, 1, 2].map((i) => ({ jobId: 'j00' + i, url: job3.urls[i], ok: true })),
    leakedUrls: ['https://a.test'],
  }));
  const res = await run(out);
  assert.equal(res.status, 'partial');
  assert.equal(res.ok, false);
});

test('a batch where nothing ran is failed, and skipped items say so', async () => {
  const out = ok(finalLine({ items: [0, 1, 2].map((i) => ({ jobId: 'j00' + i, url: job3.urls[i], ok: false, code: 'ESKIP' })) }));
  const res = await run(out);
  assert.equal(res.status, 'failed');
  assert.ok(res.items.every((i) => i.status === 'skipped'));
});

test('a sign-in wall asks for a person, and the run stays partial when other items worked', async () => {
  const out = ok(finalLine({ items: [
    { jobId: 'j000', url: 'https://a.test', ok: true },
    { jobId: 'j001', url: 'https://b.test', ok: true },
    { jobId: 'j002', url: 'https://c.test', ok: false, code: 'EBLOCKED', blockKind: 'login-wall' },
  ] }));
  const res = await run(out);
  assert.equal(res.items[2].status, 'needs_input');
  assert.equal(res.status, 'partial');
});

// The kind is the whole of the decision, so an EBLOCKED that never named one must not
// inherit the friendlier answer. Saying needs_input here would invite a person to clear
// something nobody established a person can clear.
test('an EBLOCKED with no kind is a failure rather than a request', async () => {
  const out = ok(finalLine({ items: [
    { jobId: 'j000', url: 'https://a.test', ok: true },
    { jobId: 'j001', url: 'https://b.test', ok: true },
    { jobId: 'j002', url: 'https://c.test', ok: false, code: 'EBLOCKED' },
  ] }));
  const res = await run(out);
  assert.equal(res.items[2].status, 'failed');
  assert.equal(res.status, 'partial');
});

test('a whole batch that worked reports completed, and the counts agree', async () => {
  const out = ok(finalLine({ items: [0, 1, 2].map((i) => ({ jobId: 'j00' + i, url: job3.urls[i], ok: true })) }));
  const res = await run(out);
  assert.equal(res.status, 'completed');
  assert.equal(res.ok, true);
  assert.equal(res.complete, true);
  assert.equal(res.completed, res.requested);
  assert.equal(res.schema, 'browse/2');
  assert.match(res.runId, /^run-/);
  assert.equal(res.ledger.length, 3);
  assert.equal(res.ledger[0].jobId, 'j000');
});

test('a half driven action list cannot pass as completed', () => {
  // script.js only lowers out.ok when stopOnError is set, so an item whose actions failed
  // arrives with ok:true. Reading ok alone would call that batch a success.
  assert.equal(itemStatus({ ok: true, actionsOk: false }), 'failed');
  assert.equal(itemStatus({ ok: true }), 'completed');
  assert.equal(itemStatus({ ok: false, code: 'EHOSTKILL' }), 'indeterminate');
  assert.equal(runStatus({
    marker: 'ok', leakedUrls: [], killed: false,
    items: [{ status: 'completed' }, { status: 'failed' }],
  }), 'partial');
});

test('an indeterminate effect keeps the run from claiming completion', () => {
  const items = [{ status: 'completed' }, { status: 'completed' }];
  assert.equal(runStatus({ marker: 'ok', items, leakedUrls: [], killed: false, effects: [] }), 'completed');
  assert.equal(runStatus({
    marker: 'ok', items, leakedUrls: [], killed: false,
    effects: [{ operationId: 'o1', state: 'indeterminate' }],
  }), 'partial');
});

test('a second result claiming an id we already matched is kept, not silently swapped in', async () => {
  // Map.set would have let the last writer win and thrown away a real observation.
  const out = ok(finalLine({ items: [
    { jobId: 'j000', url: 'https://a.test', ok: true, title: 'first' },
    { jobId: 'j000', url: 'https://a.test', ok: false, code: 'EOPEN', title: 'impostor' },
    { jobId: 'j001', url: 'https://b.test', ok: true },
    { jobId: 'j002', url: 'https://c.test', ok: true },
  ] }));
  const res = await run(out);
  assert.equal(res.items[0].title, 'first');
  assert.ok(res.partial.includes('duplicate-jobid'));
  assert.equal(res.extraItems.length, 1);
  assert.equal(res.extraItems[0].title, 'impostor');
  // Every request looks answered, but the ledger and the payload disagree about who
  // answered j000. That is not a clean run.
  assert.equal(res.status, 'partial');
  assert.equal(res.ok, false);
  assert.equal(res.complete, false);
});

test('a result naming an id we never issued is reported instead of counted', async () => {
  const out = ok(finalLine({ items: [
    { jobId: 'j000', url: 'https://a.test', ok: true },
    { jobId: 'j001', url: 'https://b.test', ok: true },
    { jobId: 'j002', url: 'https://c.test', ok: true },
    { jobId: 'j009', url: 'https://ghost.test', ok: true },
  ] }));
  const res = await run(out);
  assert.equal(res.requested, 3);
  assert.equal(res.completed, 3);
  assert.ok(res.partial.includes('extra-items'));
  assert.equal(res.extraItems[0].jobId, 'j009');
  assert.equal(res.status, 'partial');
  assert.equal(res.ok, false);
});

test('a final payload with no items at all reconciles nothing and says so', async () => {
  const res = await run(ok(finalLine({ items: [] })));
  assert.equal(res.reconciledBy, 'none');
  assert.equal(res.status, 'failed');
  assert.equal(res.unreturned, 3);
  assert.ok(res.items.every((i) => i.code === 'EUNRETURNED'));
});

test('an unfinished run cannot be rescued by an ok flag on the item', () => {
  // The script never sets both, but the order of the checks is the guard, so pin it.
  assert.equal(itemStatus({ ok: true, code: 'EHOSTKILL' }), 'indeterminate');
  assert.equal(itemStatus({ ok: true, code: 'ENOMARKER' }), 'indeterminate');
  assert.equal(itemStatus({ ok: true, code: 'EUNRETURNED' }), 'unreturned');
});

test('the ledger lets a consumer pair each result with the name issued for it', async () => {
  // This is the join wp3 replaces the index zip with: two requests for one url, answered
  // out of order, still take their own artifact name.
  const names = ['shot-000.png', 'shot-001.png'];
  const out = ok(finalLine({ items: [
    { jobId: 'j001', url: 'https://a.test', ok: true, artifactName: 'shot-001.png' },
    { jobId: 'j000', url: 'https://a.test', ok: true, artifactName: 'shot-000.png' },
  ] }));
  const res = await run(out, dupe);
  const nameByJob = new Map(res.ledger.map((r) => [r.jobId, names[r.index]]));
  for (const item of res.items) {
    assert.equal(item.artifactName, nameByJob.get(item.jobId), 'each result keeps the name issued for its own request');
  }
  assert.deepEqual(res.ledger.map((r) => r.index), [0, 1]);
  assert.deepEqual(res.ledger.map((r) => r.url), dupe.urls);
});
