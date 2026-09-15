// Unicode and glob-shape defects in PATH MATCHING (plan 260914_path-matching-unicode).
//
// The field failure this encodes: three codemode calls in a row answered ok:true
// with an empty array while the file sat in the directory. Two defects stacked —
// pattern:'*.pdf' is a substring filter that can never match a real path, and a
// decomposed (macOS) filename does not contain the composed needle the guest typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRgResolver, createRgRunner } from '../src/rg.js';
import { makeRootGuard } from '../src/paths.js';
import { validateSearchOptions, checkEntryOptionValue } from '../src/search-schema.js';
import { createActions } from '../src/host/actions.js';
import { createFs } from '../src/host/fs.js';
import { lockPathFor } from '../src/host/file-lock.js';
import { includesText, normalizationVariants } from '../src/unicode.js';

// Built from escapes at runtime, never pasted: this source file is itself stored
// in whatever form the checkout produced, so a hardcoded decomposed literal would
// be testing the repository's encoding instead of the code.
const NFC = '\uc548\ub0b4\ubb38'; // 안내문
const NFD = NFC.normalize('NFD');

function tmp(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'codemode-nfc-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A filesystem that normalizes on lookup (APFS) stores the composed name however
// we asked for it, so assertions about a decomposed name ON DISK are only
// meaningful where the decomposed name survives. Ask the filesystem instead of
// guessing from process.platform: this Windows/NTFS host does keep it decomposed,
// so a blanket darwin-only gate would skip a case that really runs here.
function storesDecomposed(dir) {
  const probe = path.join(dir, NFD + '.probe');
  writeFileSync(probe, '');
  const kept = readdirSync(dir).some((name) => name === NFD + '.probe');
  rmSync(probe, { force: true });
  return kept;
}

test('search.files refuses a glob-shaped pattern instead of matching nothing in silence', () => {
  for (const bad of ['*.pdf', 'report-?.txt', '**/*.js']) {
    assert.throws(
      () => validateSearchOptions('search.files', { path: '.', pattern: bad }),
      (e) => e.code === 'EBADVAL' && /not a glob/.test(e.message) && /glob:/.test(e.message),
      bad,
    );
  }
  // The substring it actually is stays legal, including characters that are only
  // glob syntax in other tools.
  for (const good of ['.pdf', NFC, 'report[1]', '{draft}']) {
    assert.equal(validateSearchOptions('search.files', { path: '.', pattern: good }).pattern, good);
  }
});

test('discovery and execution agree about a glob-shaped pattern', () => {
  const actions = createActions();
  const invalid = actions.check('search.files', { path: '.', pattern: '*.pdf' }).invalid;
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].code, 'EBADVAL');
  assert.match(invalid[0].message, /glob: "\*\*\/\*\.pdf"/);
  assert.equal(actions.check('search.files', { path: '.', pattern: '.pdf' }).ok, true);
});

test('a literal bracket pattern keeps working: only * and ? are refused', async (t) => {
  // Second-review counterexample: report[final].pdf is a real filename and
  // pattern:'[final]' is a real literal search. A blanket * ? [ ban would break it,
  // so the rule here is deliberately narrower than the one that was proposed.
  const root = tmp(t);
  writeFileSync(path.join(root, 'report[final].pdf'), 'x');
  const hits = await createRgRunner(createRgResolver({})).files({ path: root, pattern: '[final]' });
  assert.equal(hits.length, 1);
  assert.equal(validateSearchOptions('search.files', { path: '.', pattern: '[final]' }).pattern, '[final]');
});

test('the glob rule is scoped to search.files and leaves the grepFile regex alone', () => {
  const actions = createActions();
  // 'a*' is a legal quantifier for fs.grepFile and a nonsense glob for search.files.
  assert.deepEqual(actions.check('fs.grepFile', { path: 'f.txt', pattern: 'a*' }).invalid, []);
  assert.equal(actions.check('search.files', { path: '.', pattern: 'a*' }).invalid.length, 1);
  assert.equal(checkEntryOptionValue('search.count', 'pattern', 'a*'), null);
});

test('normalization helpers fold comparisons without inventing spellings', () => {
  assert.equal(NFD.includes(NFC), false);
  assert.equal(includesText(NFD + '.pdf', NFC), true);
  assert.equal(includesText(NFC + '.pdf', NFD), true);
  assert.equal(includesText('plain.txt', 'ain'), true);
  assert.equal(includesText('plain.txt', 'zzz'), false);
  assert.deepEqual(normalizationVariants('ascii-only'), []);
  assert.ok(normalizationVariants(NFC).includes(NFD));
});

test('a decomposed filename is found by a composed needle and the row still opens', async (t) => {
  const root = tmp(t);
  if (!storesDecomposed(root)) return t.skip('filesystem normalizes filenames on write');
  writeFileSync(path.join(root, NFD + '.pdf'), 'hello');
  const hits = await createRgRunner(createRgResolver({})).files({ path: root, pattern: NFC });
  assert.equal(hits.length, 1);
  // The row is the path as STORED, not a normalized copy, so it can be opened.
  assert.equal(path.basename(hits[0]), NFD + '.pdf');
  assert.equal(readFileSync(hits[0], 'utf8'), 'hello');
});

test('a path typed in the other form resolves instead of looking like a root escape', (t) => {
  const root = tmp(t);
  const decomposedDir = path.join(root, NFD + '-dir');
  mkdirSync(decomposedDir);
  if (!storesDecomposed(decomposedDir)) return t.skip('filesystem normalizes filenames on write');
  writeFileSync(path.join(decomposedDir, NFD + '.txt'), 'inside');
  const guard = makeRootGuard([decomposedDir]);
  const resolved = guard(path.join(root, NFC + '-dir', NFC + '.txt'));
  assert.equal(readFileSync(resolved, 'utf8'), 'inside');
});

test('normalization tolerance does not widen the root allowlist', (t) => {
  const root = tmp(t);
  const decomposedDir = path.join(root, NFD + '-dir');
  const composedDir = path.join(root, NFC + '-dir');
  mkdirSync(decomposedDir);
  try {
    mkdirSync(composedDir);
  } catch (e) {
    if (e.code === 'EEXIST') return t.skip('filesystem cannot hold both normalization forms');
    throw e;
  }
  writeFileSync(path.join(composedDir, 'outside.txt'), 'nope');
  // The sibling EXISTS, so nothing has to be guessed: it is simply not the root,
  // even though its name differs from the root only by normalization form.
  const guard = makeRootGuard([decomposedDir]);
  assert.throws(() => guard(path.join(composedDir, 'outside.txt')), (e) => e.code === 'EROOT');
});

test('fs.grepFile matches across normalization forms and returns the bytes on disk', async (t) => {
  const root = tmp(t);
  const guard = makeRootGuard([root]);
  const fs = createFs({ assertInside: guard });

  const decomposed = path.join(root, 'decomposed.txt');
  writeFileSync(decomposed, 'first\n' + NFD + ' line\nlast\n');
  const hits = await fs.grepFile(decomposed, new RegExp(NFC));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.equal(hits[0].text, NFD + ' line');

  const composed = path.join(root, 'composed.txt');
  writeFileSync(composed, NFC + ' line\n');
  assert.equal((await fs.grepFile(composed, new RegExp(NFD))).length, 1);

  // An ASCII pattern never takes the folding path and keeps working.
  assert.equal((await fs.grepFile(decomposed, 'first')).length, 1);
});

test('content folding is disclosed on .scope and can be turned off', async (t) => {
  // File CONTENT is a different contract from a filename: a caller deliberately
  // searching for one normalization form has to be able to say so, and has to be
  // able to see which policy produced the rows.
  const root = tmp(t);
  const file = path.join(root, 'notes.txt');
  writeFileSync(file, NFD + ' line\n');
  const fs = createFs({ assertInside: makeRootGuard([root]) });

  const folded = await fs.grepFile(file, new RegExp(NFC));
  assert.equal(folded.length, 1);
  assert.equal(JSON.parse(JSON.stringify(folded)).scope.normalize, true);

  const exact = await fs.grepFile(file, new RegExp(NFC), { normalize: false });
  assert.equal(exact.length, 0);
  assert.equal(JSON.parse(JSON.stringify(exact)).scope.normalize, false);

  // An ASCII pattern is never folded, so the scope reports the policy actually
  // in force instead of the one that was requested.
  const ascii = await fs.grepFile(file, 'line');
  assert.equal(JSON.parse(JSON.stringify(ascii)).scope.normalize, false);

  const actions = createActions();
  assert.deepEqual(actions.check('fs.grepFile', { path: file, pattern: 'x', normalize: false }).invalid, []);
  assert.deepEqual(actions.check('search.files', { path: '.', normalize: false }).unknown, ['normalize']);
});

test('both spellings of one not-yet-created file take the same lock', () => {
  const dir = path.join(os.tmpdir(), 'codemode-lock-key');
  assert.equal(lockPathFor(path.join(dir, NFC + '.txt')), lockPathFor(path.join(dir, NFD + '.txt')));
  assert.notEqual(lockPathFor(path.join(dir, 'a.txt')), lockPathFor(path.join(dir, 'b.txt')));
});
