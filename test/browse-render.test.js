// Arriving at a page is not reading it.
//
// Threads answered ok:true with the correct title while the body was 530KB of server
// bootstrap JSON and no post UI, because textContent includes <script> text and ok only
// ever meant 'the script ran'. These pin the two halves of the fix: the verdict fields
// and the aggregation that carries them to the caller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJob } from '../src/host/browse/schema.js';
import { createBrowseSession } from '../src/host/browse/session.js';
import { compile } from '../src/host/browse/script.js';

const base = { urls: ['https://x.test'] };
const resolveAside = async () => '/fake/aside';
const spawnWith = (final) => async () => ({ stdout: JSON.stringify({ type: 'final', ...final }) + '\n[ok | 5ms]', killed: false });

test('a single requireSelector is normalised to a list', () => {
  assert.deepEqual(validateJob({ ...base, requireSelector: 'article' }).requireSelector, ['article']);
  assert.deepEqual(validateJob({ ...base, requireSelector: ['a', 'b'] }).requireSelector, ['a', 'b']);
  assert.deepEqual(validateJob(base).requireSelector, []);
});

test('render options reach the compiled script', () => {
  const src = compile(validateJob({ ...base, requireSelector: ['article'], minTextChars: 300, requireContent: true }));
  assert.match(src, /"requireSelector":\["article"\]/);
  assert.match(src, /"minTextChars":300/);
  assert.match(src, /"requireContent":true/);
});

test('the compiled script reads visible text, not script payload', () => {
  // textContent includes <script> bodies; innerText does not. This is the line that
  // turned 530KB of bootstrap JSON into 973 characters of real UI text.
  const src = compile(validateJob({ ...base, extract: { body: 'body' } }));
  assert.match(src, /innerText/);
  assert.match(src, /script,style,noscript,template/);
});

test('the fragment is read from location.href, not page.url()', () => {
  // page.url() reported localhost:10100/ for localhost:10100/#providers, losing the route.
  const src = compile(validateJob(base));
  assert.match(src, /location\.href/);
});

test('one unverified item makes the whole batch unverified and says so in partial', async () => {
  const s = createBrowseSession({ resolveAside, spawnAside: spawnWith({
    items: [{ url: 'a', ok: true, contentVerified: true }, { url: 'b', ok: true, contentVerified: false }],
    leakedUrls: [], partial: [],
  }) });
  const res = await s.run({ urls: ['a', 'b'] });
  assert.equal(res.contentVerified, false);
  assert.ok(res.partial.includes('content-unverified'), 'the caller must not have to dig for this');
});

test('all verified reads as verified', async () => {
  const s = createBrowseSession({ resolveAside, spawnAside: spawnWith({
    items: [{ url: 'a', ok: true, contentVerified: true }], leakedUrls: [], partial: [],
  }) });
  const res = await s.run(base);
  assert.equal(res.contentVerified, true);
  assert.deepEqual(res.partial, []);
});

test('no check asked means null, never a fabricated true', async () => {
  const s = createBrowseSession({ resolveAside, spawnAside: spawnWith({
    items: [{ url: 'a', ok: true, contentVerified: null }], leakedUrls: [], partial: [],
  }) });
  const res = await s.run(base);
  assert.equal(res.contentVerified, null, 'unknown must stay unknown');
});

test('EUNRENDERED is surfaced as an unverified batch', async () => {
  const s = createBrowseSession({ resolveAside, spawnAside: spawnWith({
    items: [{ url: 'a', ok: false, code: 'EUNRENDERED' }], leakedUrls: [], partial: [],
  }) });
  const res = await s.run(base);
  assert.equal(res.ok, false);
  assert.ok(res.partial.includes('content-unverified'));
});

test('extract selectors accept the noise-control options', () => {
  // [class*=provider] matched wrappers and children, returning the same string many times
  // with blanks between. unique/visible/filterText/limit are what make that an answer.
  const job = validateJob({ ...base, extract: { cards: { selector: '[class*=provider]', all: true, visible: true, unique: true, filterText: 'gpt', limit: 5 } } });
  assert.equal(job.extract.cards.selector, '[class*=provider]');
  const src = compile(job);
  for (const opt of ['visible', 'filterText', 'unique', 'limit']) {
    assert.ok(src.includes(opt), 'compiled script must honour ' + opt);
  }
});
