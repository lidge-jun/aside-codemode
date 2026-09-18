// Issue #41: a default search reported complete:true over eight of fifteen matching files.
//
// The fix is NOT a change to complete, which correctly means "the walk that ran lost
// nothing" and is asserted as true by twenty-plus existing cases. The question complete
// cannot answer is whether the walk was allowed to see everything, and that is what
// scope.coverage records: one entry per pruning mechanism, each off, on or unknown.
//
// Two boolean designs were tried and both were wrong in the dangerous direction. The first
// counted ignore files between the target and the configured root, which misses a
// .gitignore in a DESCENDANT directory and global excludes entirely. The second read the
// policy flags, which misses ripgrep's silent binary suppression and a symlink census that
// stops at depth three. An enumeration of the pipeline then found mechanisms nothing can
// observe at all, so a boolean claiming "nothing could hide" would always have had
// unknowable terms. These cases pin the record, not a verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRgResolver, createRgRunner } from '../src/rg.js';
import { createSearch } from '../src/host/search.js';
import { makeRootGuard } from '../src/paths.js';
import { buildCoverage } from '../src/search-schema.js';
import { restoreSearchResult } from '../src/result-envelope.js';

const caps = { files: 5000, content: 500 };
const SENTINEL = 'ZQXJ' + '_COVERAGE_' + '4417';

function searchOn(dir, opts) {
  return createSearch({
    rgRunner: createRgRunner(createRgResolver({}, process.env), opts),
    assertInside: makeRootGuard([dir]),
    caps,
  });
}

// ripgrep only honours .gitignore inside a git work tree, so the fixture needs a real .git
// or the ignore axis cannot be exercised at all. That subtlety is why several existing
// mkdtemp fixtures legitimately report every axis clean.
function ignoredCorpus() {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cov-'));
  mkdirSync(path.join(dir, 'skipped'), { recursive: true });
  mkdirSync(path.join(dir, '.dotdir'), { recursive: true });
  writeFileSync(path.join(dir, 'visible.txt'), SENTINEL + '\n');
  writeFileSync(path.join(dir, 'skipped', 'hidden-by-gitignore.txt'), SENTINEL + '\n');
  writeFileSync(path.join(dir, '.dotdir', 'hidden-by-dot.txt'), SENTINEL + '\n');
  writeFileSync(path.join(dir, '.gitignore'), 'skipped/\n');
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

function notOff(coverage) {
  return Object.entries(coverage).filter(([, v]) => v !== 'off').map(([k]) => k).sort();
}

test('a default search is complete and says which mechanisms could have hidden a match', async () => {
  const dir = ignoredCorpus();
  const search = searchOn(dir, { excludeGlobs: ['node_modules'] });

  const hits = await search.content({ query: SENTINEL, path: dir });

  // One of three. The other two are behind .gitignore and a dot-directory.
  assert.equal(hits.length, 1);
  // complete is UNCHANGED by this work: the walk that ran lost nothing.
  assert.equal(hits.complete, true);
  const cov = hits.scope.coverage;
  assert.equal(cov.ignoreRules, 'on');
  assert.equal(cov.hiddenFiles, 'on');
  assert.equal(cov.excludeGlobs, 'on');
  // The three that answer an absence question are all non-off, which is the point: this
  // result cannot support "the sentinel is not in this tree".
  assert.ok(notOff(cov).includes('ignoreRules'));
});

test('opening every axis leaves only the two that cannot be observed', async () => {
  const dir = ignoredCorpus();
  const search = searchOn(dir, { excludeGlobs: ['node_modules'] });

  const hits = await search.content({
    query: SENTINEL, path: dir, noIgnore: true, hidden: true, includeExcluded: true, binary: true,
  });

  assert.equal(hits.length, 3);
  assert.equal(hits.complete, true);
  // encoding is permanently unknown: no --encoding is passed anywhere. unicodeForms is
  // unknown because an ASCII query never triggers NFC/NFD expansion, so the host has no
  // grounds to upgrade it. An all-off record is therefore unreachable, and that is honest
  // rather than a bug.
  assert.deepEqual(notOff(hits.scope.coverage), ['encoding', 'unicodeForms']);
});

test('an empty configured exclude list cannot exclude anything', async () => {
  const dir = ignoredCorpus();
  const search = searchOn(dir, { excludeGlobs: [] });

  const hits = await search.content({ query: SENTINEL, path: dir });

  // Reading the FLAG alone would report 'on' here and on every other call, which makes the
  // entry noise instead of information.
  assert.equal(hits.scope.coverage.excludeGlobs, 'off');
});

test('a capped search is incomplete and still reports its coverage', async () => {
  const dir = ignoredCorpus();
  const search = searchOn(dir, { excludeGlobs: [] });

  const hits = await search.content({ query: SENTINEL, path: dir, max: 1, noIgnore: true, hidden: true });

  assert.equal(hits.length, 1);
  assert.equal(hits.truncated, true);
  assert.equal(hits.complete, false);
  assert.equal(hits.scope.coverage.ignoreRules, 'off');
});

test('an honest empty result is complete, and its coverage still says what was pruned', async () => {
  const dir = ignoredCorpus();
  const search = searchOn(dir, { excludeGlobs: ['node_modules'] });

  const none = await search.content({ query: 'ZQXJ' + '_ABSENT_' + '0000', path: dir });

  assert.equal(none.length, 0);
  assert.equal(none.complete, true, 'an honest empty result IS complete');
  assert.equal(none.scope.coverage.ignoreRules, 'on', 'but it cannot prove absence');
});

// Measured on this repository's own bin/rg.exe before the option existed: a fully open
// search.content for a string inside it returned 0 rows with complete:true, while
// search.files still listed the file. Nothing in the result said the content had been
// skipped, so a zero meant nothing and looked like everything.
test('binary content is invisible until the caller asks for it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-bin-'));
  // A NUL in the first bytes is what makes ripgrep classify this as binary.
  writeFileSync(path.join(dir, 'blob.bin'), Buffer.concat([
    Buffer.from([0x00, 0x01, 0x02, 0x00]),
    Buffer.from(SENTINEL + '\n', 'utf8'),
  ]));
  const search = searchOn(dir, { excludeGlobs: [] });
  const open = { path: dir, noIgnore: true, hidden: true, includeExcluded: true };

  const without = await search.content({ query: SENTINEL, ...open });
  assert.equal(without.length, 0, 'ripgrep skipped the binary file silently');
  assert.equal(without.complete, true, 'and the walk really did not lose anything it looked at');
  assert.equal(without.scope.coverage.binaryContent, 'unknown', 'so the record says it cannot tell');

  const withText = await search.content({ query: SENTINEL, ...open, binary: true });
  assert.equal(withText.length, 1, 'the string was there the whole time');
  assert.equal(withText.scope.coverage.binaryContent, 'off');

  // The asymmetry that made the zero convincing: discovery saw the file.
  const files = await search.files({ ...open });
  assert.equal(files.some((f) => f.endsWith('blob.bin')), true);
});

test('coverage survives serialization and restoration', async () => {
  const dir = ignoredCorpus();
  const search = searchOn(dir, { excludeGlobs: [] });

  const hits = await search.content({ query: SENTINEL, path: dir });
  const wire = JSON.parse(JSON.stringify(hits));
  assert.equal(wire.scope.coverage.ignoreRules, 'on');

  const restored = restoreSearchResult(wire);
  assert.equal(restored.scope.coverage.ignoreRules, 'on');
});

test('a bounded symlink census reports unknown, not off', () => {
  // The census stops at depth 3 or 4,000 entries. "It stopped early" is exactly the state in
  // which coverage cannot be proven, even though it deliberately does NOT lower complete:
  // symlink-scan.js explains that marking every large tree incomplete would make that field
  // useless within a day. The two fields answering differently here is the whole reason for
  // keeping them apart.
  assert.equal(buildCoverage({ skippedSymlinks: { dirs: 0, files: 0, capped: false, depthCapped: false } }).symlinks, 'off');
  assert.equal(buildCoverage({ skippedSymlinks: { dirs: 0, files: 0, capped: true, depthCapped: false } }).symlinks, 'unknown');
  assert.equal(buildCoverage({ skippedSymlinks: { dirs: 0, files: 0, capped: false, depthCapped: true } }).symlinks, 'unknown');
  assert.equal(buildCoverage({ skippedSymlinks: { dirs: 1, files: 0, capped: false, depthCapped: false } }).symlinks, 'on');
  assert.equal(buildCoverage({ skippedSymlinks: null }).symlinks, 'unknown');
});

test('an unreadable rg record is reported, not swallowed', () => {
  // src/rg.js used to do try { JSON.parse(line) } catch { return false } at both the content
  // and count parse sites. A record it could not read may have been a match, and nothing
  // touched partial or complete, so the row simply disappeared.
  assert.equal(buildCoverage({ unparsableRecords: 0 }).recordParse, 'off');
  assert.equal(buildCoverage({ unparsableRecords: 1 }).recordParse, 'on');
});
