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
