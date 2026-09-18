// Issue #36: browse.readText on a patch-diff.githubusercontent.com .diff URL returned
// ok:true, HTTP 200, format markdown and 7,308 chars of GitHub's signed-out interstitial.
// Measured live. Nothing in the envelope said the content was wrong, so a size check
// ("only 7 KB, must be a small PR") passed and the agent proceeded on fabricated content.
//
// Two of the issue's three requests are NOT implemented, on purpose:
//
//   "don't run toMarkdown on .diff URLs" — format comes from Content-Type, not the
//   extension. The commit .patch path returns format:'text' because GitHub sends
//   text/plain there; here the server really did send HTML, so markdown honestly describes
//   the bytes. Making format extension-driven would reverse #29's fix.
//
//   "detect the interstitial" — policy.js says a detector that flags our own output is
//   worse than none, and a body-text heuristic on "Sign in" flags any document containing
//   those words.
//
// What IS implemented is the checkable part: a URL whose extension promises a diff,
// answering with a body that carries no diff marker, is a mismatch the tool can state
// without claiming to know why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadText } from '../src/host/browse/read-text.js';

const DIFF_URL = 'https://patch-diff.githubusercontent.com/raw/o/r/pull/1.diff';

function reader(body, type = 'text/plain', extra = {}) {
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
    text: async () => body,
    url: DIFF_URL,
  });
  return createReadText({ fetchImpl, ...extra });
}

// The interstitial, in the shape it actually arrived in.
const INTERSTITIAL = '[Skip to content](#start-of-content)\n\n## Navigation Menu\n\n[Sign in](/login?return_to=x)\n\nYou can\u2019t perform that action at this time.\n';

test('a diff URL answering with a sign-in page is reported incomplete', async () => {
  const read = await reader(INTERSTITIAL, 'text/html');
  const out = await read(DIFF_URL, { fresh: true });

  // ok stays true: the fetch succeeded and these bytes are real. The caller's question was
  // a different one.
  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  assert.equal(out.complete, false);
  assert.equal(out.contentShape.expected, 'diff');
  assert.equal(out.contentShape.matched, false);
  assert.match(out.contentShape.why, /no diff --git header/);
});

// The false-positive class that would get this warning switched off. Each of these is a
// REAL diff and must pass untouched. The first two were audit findings, not guesses: the
// original marker rejected plain unified diffs, and its replacement rejected CRLF ones.
const REAL_DIFFS = {
  'git diff': 'diff --git a/x b/x\nindex 1111111..2222222 100644\n--- a/x\n+++ b/x\n',
  'plain unified, LF': '--- old.txt\n+++ new.txt\n@@ -1 +1 @@\n-a\n+b\n',
  'plain unified, CRLF': '--- old.txt\r\n+++ new.txt\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n',
  'format-patch, sha1': 'From ' + 'a'.repeat(40) + ' Mon Sep 17 00:00:00 2001\nFrom: me\n',
  'format-patch, sha256': 'From ' + 'b'.repeat(64) + ' Mon Sep 17 00:00:00 2001\nFrom: me\n',
};

for (const [name, body] of Object.entries(REAL_DIFFS)) {
  test('a real diff is not flagged: ' + name, async () => {
    const read = await reader(body);
    const out = await read(DIFF_URL, { fresh: true });
    assert.equal(out.complete, true, name + ' was called fabricated');
    assert.equal(out.contentShape, undefined);
    // Content-Type still decides the format. This is the #29 fix staying fixed.
    assert.equal(out.format, 'text');
  });
}

// Bodies that LOOK a little like a patch and are not. Three dashes alone is a markdown
// horizontal rule and the opening of YAML front matter.
const NOT_DIFFS = {
  'markdown horizontal rule': 'some prose\n\n---\n\nmore prose\n',
  'yaml front matter': '---\ntitle: x\n---\n\nbody\n',
  'prose starting with dashes': '--- not a patch, just a line\nand another\n',
  'invented 48-hex preamble': 'From ' + 'c'.repeat(48) + ' Mon Sep 17 00:00:00 2001\n',
};

for (const [name, body] of Object.entries(NOT_DIFFS)) {
  test('a near-miss body is still a mismatch: ' + name, async () => {
    const read = await reader(body);
    const out = await read(DIFF_URL, { fresh: true });
    assert.equal(out.complete, false, name + ' passed as a diff');
  });
}

test('a non-diff URL is never shape-checked', async () => {
  const read = await reader('<p>hello</p>', 'text/html');
  const out = await read('https://example.com/page.html', { fresh: true });
  assert.equal(out.complete, true);
  assert.equal(out.contentShape, undefined);
  assert.equal(out.format, 'markdown');
});

test('complete is present on every branch, not only the bad one', async () => {
  const ok = await (await reader('--- a\n+++ b\n'))(DIFF_URL, { fresh: true });
  assert.equal(typeof ok.complete, 'boolean');

  const bad = await (await reader(INTERSTITIAL, 'text/html'))(DIFF_URL, { fresh: true });
  assert.equal(typeof bad.complete, 'boolean');

  // An http refusal. No browse adapter is injected, so this takes the no-browser branch.
  const refuse = createReadText({
    fetchImpl: async () => ({
      status: 404,
      headers: { get: () => 'text/html' },
      text: async () => 'not found',
      url: DIFF_URL,
    }),
  });
  const four04 = await refuse(DIFF_URL, { fresh: true });
  assert.equal(four04.ok, false);
  assert.equal(typeof four04.complete, 'boolean');
});

test('an incomplete read is never cached, and a v2 entry cannot answer for v3', async () => {
  const store = new Map();
  const cache = {
    get: async (parts) => {
      const k = JSON.stringify(parts);
      return store.has(k) ? { hit: true, value: store.get(k) } : { hit: false };
    },
    put: async (parts, value) => { store.set(JSON.stringify(parts), value); },
  };

  // Seed the OLD namespace with the interstitial, as a pre-upgrade run would have.
  store.set(JSON.stringify({ namespace: 'readText-v2', subject: DIFF_URL, accountRoot: '', locale: null }),
    { ok: true, chars: INTERSTITIAL.length, text: INTERSTITIAL, format: 'markdown' });

  let fetches = 0;
  const read = createReadText({
    cache,
    fetchImpl: async () => {
      fetches += 1;
      return { status: 200, headers: { get: () => 'text/html' }, text: async () => INTERSTITIAL, url: DIFF_URL };
    },
  });

  const out = await read(DIFF_URL, {});
  // The stale v2 entry must not have answered.
  assert.equal(fetches, 1, 'a readText-v2 entry suppressed a fresh fetch');
  assert.equal(out.complete, false);

  // And the incomplete result must not have been stored under v3 either.
  const v3 = JSON.stringify({ namespace: 'readText-v3', subject: DIFF_URL, accountRoot: '', locale: null });
  assert.equal(store.has(v3), false, 'an incomplete body was cached');
});
