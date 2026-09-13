// AC 6, 7 — rg backend: fixture accuracy, caps, metachar safety, resolution ladder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRgResolver, createRgRunner, RgNotFoundError } from '../src/rg.js';
import { createSearch } from '../src/host/search.js';
import { makeRootGuard } from '../src/paths.js';

const caps = { files: 5000, content: 500 };

async function makeRunner() {
  const resolve = createRgResolver({}, process.env);
  return createRgRunner(resolve);
}

function fixtureCorpus() {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-search-'));
  mkdirSync(path.join(dir, 'sub'));
  writeFileSync(path.join(dir, 'a.txt'), 'alpha\nneedle-target here\n');
  writeFileSync(path.join(dir, 'sub', 'b.txt'), 'beta\nno match\n');
  return dir;
}

test('content finds the fixture needle with file and line', async () => {
  const dir = fixtureCorpus();
  const runner = await makeRunner();
  const search = createSearch({ rgRunner: runner, assertInside: makeRootGuard([dir]), caps });
  const hits = await search.content({ query: 'needle-target', path: dir });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.match(hits[0].text, /needle-target/);
});

test('files lists and filters, content cap is honored', async () => {
  const dir = fixtureCorpus();
  const runner = await makeRunner();
  const search = createSearch({ rgRunner: runner, assertInside: makeRootGuard([dir]), caps });
  const all = await search.files({ path: dir });
  assert.equal(all.length, 2);
  const only = await search.files({ path: dir, pattern: 'a.txt' });
  assert.equal(only.length, 1);
  const capped = await search.content({ query: 'a', path: dir, max: 1 });
  assert.ok(capped.length <= 1);
});

test('shell metacharacters in the query are passed literally', async () => {
  const dir = fixtureCorpus();
  const runner = await makeRunner();
  const search = createSearch({ rgRunner: runner, assertInside: makeRootGuard([dir]), caps });
  const hits = await search.content({ query: '$(touch /tmp/pwned)', path: dir });
  assert.deepEqual(hits, []); // treated as a regex with no match, never executed
});

test('explicit bogus rgPath is a structured error, not a fall-through', async () => {
  const resolve = createRgResolver({ rgPath: path.join(tmpdir(), 'no-such-rg-binary') }, {});
  await assert.rejects(resolve(), RgNotFoundError);
});
