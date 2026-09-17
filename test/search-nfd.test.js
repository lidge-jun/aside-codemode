import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRgResolver, createRgRunner } from '../src/rg.js';
import { createSearch } from '../src/host/search.js';
import { makeRootGuard } from '../src/paths.js';
import { decorateSearchResult } from '../src/search-result.js';

const NFC = '\ud559\uc810\uc778\uc815';
const NFD = NFC.normalize('NFD');

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'codemode-search-nfd-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, `${NFC}_nfc.md`), `body ${NFC}\n`);
  writeFileSync(path.join(root, `${NFD}_nfd.md`), `body ${NFD}\n`);
  return root;
}

function realSearch(root) {
  return createSearch({
    rgRunner: createRgRunner(createRgResolver({}, process.env)),
    assertInside: makeRootGuard([root]),
    caps: { files: 5000, content: 500 },
  });
}

test('non-ASCII filename and content searches cover NFC and NFD', async (t) => {
  const root = fixture(t);
  const stored = readdirSync(root);
  const distinctForms = stored.some((name) => name.includes(NFC))
    && stored.some((name) => name.includes(NFD));
  const search = realSearch(root);

  const files = await search.files({ path: root, glob: `**/*${NFC}*` });
  const patterned = await search.files({ path: root, pattern: NFC });
  const content = await search.content({ path: root, query: NFC, fixedStrings: true });

  assert.deepEqual(files.map((file) => path.basename(file)).sort(), stored.sort());
  assert.deepEqual(patterned.map((file) => path.basename(file)).sort(), stored.sort());
  assert.deepEqual([...new Set(content.map((hit) => path.basename(hit.file)))].sort(), stored.sort());
  assert.equal(files.complete, true);
  assert.equal(patterned.complete, true);
  assert.equal(content.complete, true);
  assert.deepEqual(files.scope.normalization.formsSearched, ['NFC', 'NFD']);
  assert.deepEqual(patterned.scope.normalization.formsSearched, ['NFC', 'NFD']);
  assert.deepEqual(content.scope.normalization.formsSearched, ['NFC', 'NFD']);
  if (!distinctForms) {
    assert.equal(files.scope.normalization.complete, true);
    assert.equal(patterned.scope.normalization.complete, true);
    assert.equal(content.scope.normalization.complete, true);
  }
});

test('normalization search does not claim completeness when either form is partial', async () => {
  const calls = [];
  const rgRunner = {
    async files(opts) {
      calls.push(opts.glob);
      const complete = opts.glob === opts.glob.normalize('NFC');
      return decorateSearchResult([], {
        complete,
        partial: complete ? [] : ['normalization form was not fully searched'],
        scope: { kind: 'files', glob: opts.glob },
      });
    },
  };
  const search = createSearch({
    rgRunner,
    assertInside: (value) => value,
    caps: { files: 5000, content: 500 },
  });

  const files = await search.files({ path: '.', glob: `**/*${NFC}*` });

  assert.deepEqual(calls, [`**/*${NFC}*`, `**/*${NFD}*`]);
  assert.equal(files.complete, false);
  assert.equal(files.scope.normalization.complete, false);
  assert.deepEqual(files.scope.normalization.formsSearched, ['NFC', 'NFD']);
  assert.deepEqual(files.partial, ['normalization form was not fully searched']);
});

test('normalization count searches every query and glob form and labels the scalar floor', async () => {
  const calls = [];
  const counts = [
    { matches: 4, files: 3 },
    { matches: 3, files: 2 },
    { matches: 7, files: 4 },
    { matches: 5, files: 5 },
  ];
  const rgRunner = {
    async count(opts) {
      const value = counts[calls.length];
      calls.push({ query: opts.query, glob: opts.glob });
      return decorateSearchResult({ ...value }, {
        complete: true,
        scope: { kind: 'count', query: opts.query, glob: opts.glob },
      });
    },
  };
  const search = createSearch({
    rgRunner,
    assertInside: (value) => value,
    caps: { files: 5000, content: 500 },
  });
  const glob = `**/*${NFC}*.md`;

  const count = await search.count({ path: '.', query: NFC, glob });

  assert.deepEqual(calls, [
    { query: NFC, glob },
    { query: NFC, glob: glob.normalize('NFD') },
    { query: NFD, glob },
    { query: NFD, glob: glob.normalize('NFD') },
  ]);
  assert.deepEqual(count, { matches: 7, files: 5 });
  assert.equal(count.complete, false);
  assert.equal(count.scope.query, NFC);
  assert.equal(count.scope.glob, glob);
  assert.deepEqual(count.scope.normalization.fields, ['query', 'glob']);
  assert.deepEqual(count.scope.normalization.formsSearched, ['NFC', 'NFD']);
  assert.equal(count.scope.normalization.countAccuracy, 'lower-bound');
  assert.equal(count.scope.normalization.complete, false);
  assert.equal(JSON.parse(JSON.stringify(count)).complete, false);
});

test('normalization count preserves partial warnings while returning its strongest floor', async () => {
  const calls = [];
  const rgRunner = {
    async count(opts) {
      calls.push(opts.query);
      const complete = opts.query === NFC;
      return decorateSearchResult(
        complete ? { matches: 2, files: 1 } : { matches: 4, files: 3 },
        {
          complete,
          partial: complete ? [] : ['normalization count was partial'],
          scope: { kind: 'count', query: opts.query },
        },
      );
    },
  };
  const search = createSearch({
    rgRunner,
    assertInside: (value) => value,
    caps: { files: 5000, content: 500 },
  });

  const count = await search.count({ path: '.', query: NFC });

  assert.deepEqual(calls, [NFC, NFD]);
  assert.deepEqual(count, { matches: 4, files: 3 });
  assert.deepEqual(count.partial, ['normalization count was partial']);
  assert.equal(count.complete, false);
  assert.equal(count.scope.normalization.countAccuracy, 'lower-bound');
  assert.equal(count.scope.normalization.complete, false);
});
