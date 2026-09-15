// The last of the green lies: the call worked, the result is empty, and nothing says that
// combination is worth a second look. Eight course pages returned zero for the same
// selector with no error anywhere, because the content lived in an iframe, and believing
// that answer turns "I could not read this" into "there is nothing here".
//
// Only the aggregate is flagged. One page without a selector is a page without it, and a
// content search that finds nothing usually means the text is not there — putting a warning
// on the common case teaches the reader to ignore the field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowseSession, suspectSelectors } from '../src/host/browse/session.js';
import { createSearchMany } from '../src/host/browse/search.js';

const item = (jobId, missing, extra = {}) => ({
  jobId, url: 'https://x.test/' + jobId, ok: true, status: 'completed',
  data: { data: {}, missing }, ...extra,
});
const schema = { title: 'h1', rows: '.context_module' };

test('a selector missing everywhere is suspicious; missing once is a page', () => {
  // Every answering page lacked it.
  assert.deepEqual(suspectSelectors([item('a', ['rows']), item('b', ['rows'])], schema), ['rows']);
  // One page had it, so the selector works and those pages simply differ.
  assert.deepEqual(suspectSelectors([item('a', ['rows']), item('b', [])], schema), []);
  // A single page proves nothing either way.
  assert.deepEqual(suspectSelectors([item('a', ['rows'])], schema), []);
  // Both fields empty everywhere names both.
  assert.deepEqual(suspectSelectors([item('a', ['title', 'rows']), item('b', ['rows', 'title'])], schema).sort(), ['rows', 'title']);
  // Nothing was asked for, so nothing can be suspicious.
  assert.deepEqual(suspectSelectors([item('a', ['rows']), item('b', ['rows'])], null), []);
  // Items that did not answer are not evidence.
  assert.deepEqual(suspectSelectors([{ jobId: 'a', status: 'failed' }, { jobId: 'b', status: 'unreturned' }], schema), []);
});

const resolveAside = async () => 'C:/fake/aside.exe';
const fakeSpawn = (stdout) => async () => ({ stdout, killed: false });
const envelope = (items) => JSON.stringify({ type: 'final', items, leakedUrls: [], partial: [] }) + '\n[ok | 5ms]';
const urls = ['https://x.test/a', 'https://x.test/b'];

test('the run carries what was empty and the frames that usually explain it', async () => {
  const stdout = envelope([
    { jobId: 'j000', url: urls[0], ok: true, data: { data: {}, missing: ['rows'] }, render: { iframes: 2 } },
    { jobId: 'j001', url: urls[1], ok: true, data: { data: {}, missing: ['rows'] }, render: { iframes: 2 } },
  ]);
  const res = await createBrowseSession({ resolveAside, spawnAside: fakeSpawn(stdout) })
    .run({ urls, timeoutMs: 5000, extract: schema });
  // The run still completed: this is a warning about the answer, not a failure of the call.
  assert.equal(res.status, 'completed');
  assert.deepEqual(res.suspectEmpty.selectors, ['rows']);
  assert.equal(res.suspectEmpty.iframes, 4);
  assert.match(res.suspectEmpty.why, /wrong selector/);
  assert.ok(res.partial.includes('suspect-empty'));
});

test('a selector that worked somewhere raises nothing', async () => {
  const stdout = envelope([
    { jobId: 'j000', url: urls[0], ok: true, data: { data: { rows: 'x' }, missing: [] } },
    { jobId: 'j001', url: urls[1], ok: true, data: { data: {}, missing: ['rows'] } },
  ]);
  const res = await createBrowseSession({ resolveAside, spawnAside: fakeSpawn(stdout) })
    .run({ urls, timeoutMs: 5000, extract: schema });
  assert.equal(res.suspectEmpty, undefined);
  assert.equal(res.partial.includes('suspect-empty'), false);
});

function searchWith(counts) {
  let i = 0;
  return createSearchMany({
    fetchImpl: async () => ({
      ok: true,
      async text() {
        const n = counts[i++];
        return '<html>' + Array.from({ length: n }, (_, k) =>
          '<a class="result__a" href="https://r.test/' + k + '">row ' + k + '</a>').join('') + '</html>';
      },
    }),
  });
}

test('every query answering nothing is a signal, not a subject with no results', async () => {
  const res = await searchWith([0, 0])(['first thing', 'second thing']);
  assert.equal(res.ok, true, 'the calls worked; that is the point');
  assert.ok(res.suspectEmpty, 'an all-empty search said nothing was unusual');
  assert.equal(res.suspectEmpty.queries, 2);
  assert.ok(res.partial.includes('suspect-empty'));
});

test('one query finding something means the search works', async () => {
  const res = await searchWith([0, 3])(['first thing', 'second thing']);
  assert.equal(res.suspectEmpty, undefined);
  assert.equal(res.partial.includes('suspect-empty'), false);
});

