// Two shapes that made a first call fail for a reason the error did not explain. The fix is
// not new behaviour; it is the message saying which name belongs to which method, and the
// result putting the body where a caller looks for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSearchOptions } from '../src/search-schema.js';
import { createReadText } from '../src/host/browse/read-text.js';
import { createRgResolver, createRgRunner } from '../src/rg.js';

const callShapes = readFileSync(
  new URL('../templates/skill/references/call-shapes.md', import.meta.url),
  'utf8',
);

const refusal = (fn, opts) => {
  try { validateSearchOptions(fn, opts); return null; } catch (e) { return e; }
};

test('the search guidance names the row-array return contract and the wrong property guesses', () => {
  const section = callShapes.match(/## search: which name belongs to which method([\s\S]*?)\n## /)?.[1] ?? '';
  assert.match(section, /array of rows itself/i);
  assert.match(section, /non-enumerable[^\n]*complete[^\n]*truncated[^\n]*partial[^\n]*scope/i);
  assert.match(section, /\{ rows, complete, truncated, partial, scope \}/);
  assert.match(section, /no `r\.matches` and no `r\.results`/);
  assert.match(section, /search\.count[^\n]*exception/i);
});

test('a real content search returns the decorated array the guidance describes', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'codemode-call-shapes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'one.txt'), 'NEEDLE\n');

  const result = await createRgRunner(createRgResolver({})).content({
    path: root,
    query: 'NEEDLE',
  });

  assert.equal(Array.isArray(result), true);
  assert.deepEqual([...result], [{ file: path.join(root, 'one.txt'), line: 1, text: 'NEEDLE' }]);
  for (const key of ['complete', 'truncated', 'partial', 'scope']) {
    assert.equal(key in result, true, `${key} is missing from the live result`);
    assert.equal(Object.getOwnPropertyDescriptor(result, key)?.enumerable, false);
  }
  assert.equal('matches' in result, false);
  assert.equal('results' in result, false);

  const wire = JSON.parse(JSON.stringify(result));
  assert.deepEqual(Object.keys(wire), ['rows', 'complete', 'truncated', 'partial', 'scope']);
  assert.deepEqual(wire.rows, [...result]);
});

test('search.content rejects pattern by naming the option it does want', () => {
  const e = refusal('search.content', { pattern: 'x', path: '/tmp' });
  assert.equal(e.code, 'EBADOPT');
  assert.match(e.message, /valid:/, 'the existing shape has to stay: callers and tests read it');
  assert.match(e.message, /query/, e.message);
  assert.match(e.message, /search\.files/, 'it should say where pattern does belong: ' + e.message);
});

test('search.files rejects query the same way, pointing the other direction', () => {
  const e = refusal('search.files', { query: 'x', path: '/tmp' });
  assert.equal(e.code, 'EBADOPT');
  assert.match(e.message, /pattern|glob/, e.message);
  assert.match(e.message, /search\.content/, e.message);
});

test('search.count says the same thing, because it has the same trap', () => {
  const e = refusal('search.count', { pattern: 'x', path: '/tmp' });
  assert.equal(e.code, 'EBADOPT');
  assert.match(e.message, /query/, e.message);
  assert.match(e.message, /search\.files/, 'count needs the same pointer as content: ' + e.message);
});

test('a glob-shaped value is sent to glob, not to a content regex', () => {
  const e = refusal('search.content', { pattern: '*.pdf', path: '/tmp' });
  assert.match(e.message, /glob/, e.message);
});

test('a missing path says what to put there', () => {
  const e = refusal('search.files', { pattern: 'x' });
  assert.equal(e.code, 'EBADVAL');
  assert.match(e.message, /required/);
  assert.match(e.message, /root|--cwd|absolute/i, 'it should say what a valid path is: ' + e.message);
});

test('an unknown option nobody could mistake still reads the old way', () => {
  const e = refusal('search.files', { nonsense: 1, path: '/tmp' });
  assert.equal(e.code, 'EBADOPT');
  assert.match(e.message, /valid:/);
  assert.equal(/search\.content/.test(e.message), false, 'no advice to invent where none applies');
});

const PAGE = '<html><body><h1>Title</h1><p>' + 'body text '.repeat(40) + '</p></body></html>';
const fetchImpl = async (url) => ({
  ok: true, status: 200, url, text: async () => PAGE,
});

test('readText takes the url as a string or in an object, and answers the same', async () => {
  const readText = createReadText({ fetchImpl });
  const fromString = await readText('https://example.com/a');
  const fromObject = await readText({ url: 'https://example.com/a' });
  assert.equal(fromObject.ok, fromString.ok);
  assert.equal(fromObject.text, fromString.text);
  assert.equal(fromObject.chars, fromString.chars);
});

test('the body arrives under text, with the shape named separately', async () => {
  const readText = createReadText({ fetchImpl });
  const out = await readText('https://example.com/b');
  assert.ok(out.text.length > 0, 'no body came back');
  assert.equal(out.format, 'markdown');
  assert.equal(out.chars, out.text.length);
  // One field, not two: a second copy doubles the payload and the budget drops whichever
  // key comes last, which is how res.text read empty in the first place.
  assert.equal('markdown' in out, false, 'the old key is still there, and it costs the payload twice');
});

test('options still work when the url arrives inside the object', async () => {
  const seen = [];
  const readText = createReadText({ fetchImpl: async (url, init) => { seen.push(init); return fetchImpl(url); } });
  await readText({ url: 'https://example.com/c', locale: 'ko-KR' });
  assert.ok(seen.length === 1);
});

test('a url that is neither string nor object says what the two shapes are', async () => {
  const readText = createReadText({ fetchImpl });
  await assert.rejects(() => readText(42), (e) => {
    assert.equal(e.code, 'EBADVAL');
    assert.match(e.message, /readText\('https/);
    assert.match(e.message, /url:/);
    return true;
  });
});

// A cache written by 0.2.0 holds the body under 'markdown'. Throwing those entries away would
// be the easy answer and the wrong one: they are still good observations.
test('an entry cached under the old key still comes back readable', async () => {
  const stored = { ok: true, source: 'fetch', status: 200, markdown: 'older body', chars: 10 };
  const cache = {
    get: async () => ({ hit: true, value: stored }),
    put: async () => {},
  };
  const readText = createReadText({ fetchImpl, cache });
  const out = await readText('https://example.com/old');
  assert.equal(out.cached, true);
  assert.equal(out.text, 'older body');
  assert.equal(out.format, 'markdown');
  assert.equal('markdown' in out, false);
  assert.equal(out.chars, out.text.length, 'chars has to describe the body it came back with');
});

test('the browser path does not call rendered text markdown', async () => {
  const short = '<html><body><div id="app"></div></body></html>';
  const browse = { exec: async () => ({ items: [{ ok: true, text: 'rendered body text, long enough to count' }] }) };
  const readText = createReadText({ fetchImpl: async (url) => ({ ok: true, status: 200, url, text: async () => short }), browse });
  const out = await readText('https://example.com/spa');
  assert.equal(out.source, 'browser');
  assert.equal(out.format, 'text', 'innerText is not markdown and should not claim to be');
  assert.equal(out.text, 'rendered body text, long enough to count');
});
