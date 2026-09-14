// fetch-first reading. No network: fetch is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadText, toMarkdown, needsBrowser, countElements, MIN_USEFUL_CHARS } from '../src/host/browse/read-text.js';

const res = (html, status = 200) => async () => ({ status, text: async () => html });
const article = '<html><body><h1>Title</h1><p>' + 'word '.repeat(80) + '</p><a href="/x">link</a></body></html>';
const shell = '<html><body>' + '<div class="x"><span></span></div>'.repeat(40) + '</body></html>';

test('script and style content never reaches the markdown', () => {
  const md = toMarkdown('<body><script>var a=1;</script><style>.x{}</style><p>real text</p></body>');
  assert.ok(!md.includes('var a=1'));
  assert.ok(!md.includes('.x{}'));
  assert.ok(md.includes('real text'));
});

test('headings, lists and links become markdown', () => {
  const md = toMarkdown('<body><h2>Head</h2><ul><li>one</li></ul><a href="https://x.test">go</a></body>');
  assert.match(md, /## Head/);
  assert.match(md, /- one/);
  assert.match(md, /\[go\]\(https:\/\/x\.test\)/);
});

test('a short but complete page stays on fetch', () => {
  // example.com extracts 167 useful characters from a handful of elements. Testing only
  // the character count called that a failure and would pay browser time to learn nothing.
  const short = '<html><body><h1>Example Domain</h1><p>' + 'x'.repeat(120) + '</p></body></html>';
  const md = toMarkdown(short);
  assert.ok(md.length < MIN_USEFUL_CHARS);
  assert.equal(needsBrowser(short, md).needed, false, 'short and markup-poor is a real page');
});

test('a markup-heavy page that rendered no text needs the browser', () => {
  const v = needsBrowser(shell, toMarkdown(shell));
  assert.equal(v.needed, true);
  assert.match(v.reason, /rendered no text server-side/);
  assert.ok(countElements(shell) >= 30);
});

test('framework markers are never the trigger', () => {
  // __NEXT_DATA__ lives in a script tag that the strip pass removes, so testing for it
  // would fire on ordinary server-rendered pages and never fire after the strip.
  const ssr = '<html><body><h1>Real</h1><p>' + 'word '.repeat(80) + '</p><script id="__NEXT_DATA__">{}</script></body></html>';
  assert.equal(needsBrowser(ssr, toMarkdown(ssr)).needed, false);
});

test('a fetched article is returned without touching a browser', async () => {
  let browserCalls = 0;
  const rt = createReadText({ fetchImpl: res(article), browse: { exec: async () => { browserCalls += 1; return { items: [{ ok: true }] }; } } });
  const out = await rt('https://x.test/a');
  assert.equal(out.source, 'fetch');
  assert.equal(out.fallbackReason, null);
  assert.equal(browserCalls, 0, 'a readable page must not spend browser time');
});

test('an app shell falls back and says why', async () => {
  const rt = createReadText({ fetchImpl: res(shell), browse: { exec: async () => ({ items: [{ ok: true, text: 'rendered' }] }) } });
  const out = await rt('https://x.test/app');
  assert.equal(out.source, 'browser');
  assert.match(out.fallbackReason, /rendered no text/);
});

test('without a browser the fallback degrades honestly instead of pretending', async () => {
  const rt = createReadText({ fetchImpl: res(shell), browse: null });
  const out = await rt('https://x.test/app');
  assert.equal(out.source, 'fetch');
  assert.equal(out.degraded, true);
  assert.ok(out.fallbackReason);
});

test('a file url is refused', async () => {
  const rt = createReadText({ fetchImpl: res(article) });
  await assert.rejects(rt('file:///c:/x.html'), (e) => e.code === 'ENOTSUP');
});
