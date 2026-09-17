import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readmeEn = readFileSync(path.join(root, 'README.md'), 'utf8');
const readmeKo = readFileSync(path.join(root, 'README.ko.md'), 'utf8');
const agents = readFileSync(path.join(root, 'templates', 'AGENTS.codemode.md'), 'utf8');

function section(text, heading) {
  const parts = text.split(/^## /m);
  const block = parts.find((p) => p === heading || p.startsWith(`${heading}\n`) || p.startsWith(`${heading}\r\n`));
  assert.ok(block, `missing ## ${heading}`);
  return block.slice(heading.length);
}

const forbidden = [
  '50x is the batching goal',
  'not a measured end-to-end',
  '실측한 전체 작업 속도 향상이 아닙니다',
  'much less a general 50x speedup',
  '일반적인 50배 속도 향상은 검증하지 않았습니다',
];

test('README pair leads with the 55s / 1s / ~51x folder bench', () => {
  assert.match(readmeEn, /55s/);
  assert.match(readmeEn, /1s/);
  assert.match(readmeEn, /51x/);
  assert.match(readmeKo, /55초/);
  assert.match(readmeKo, /1초/);
  assert.match(readmeKo, /51배/);
});

// The README used to describe this note as shipping the exact argv and the unrounded times.
// The note says the opposite in its own words: those were not recorded. Overselling your own
// evidence is the same defect as inventing it, so the claim is checked against the note.
test('the README does not credit the 51x note with evidence it says it lacks', () => {
  const note = readFileSync(path.join(root, 'evidence', 'dev-folder-51x.md'), 'utf8');
  assert.match(note, /were not recorded/);
  for (const readme of [readmeEn, readmeKo]) {
    assert.equal(/ships the exact argv/.test(readme), false);
    assert.equal(/argv 원문과 반올림하지 않은 시간/.test(readme), false);
  }
  assert.match(readmeEn, /operator report/);
  assert.match(readmeEn, /were not recorded/);
  assert.match(readmeKo, /운영자가 직접 재서/);
  assert.match(readmeKo, /남기지/);
});

test('old general-50x denial strings are gone', () => {
  for (const phrase of forbidden) {
    assert.equal(readmeEn.includes(phrase), false, phrase);
    assert.equal(readmeKo.includes(phrase), false, phrase);
  }
});

// The pruning sentence quoted 331,709 and 1,565,078 files for two years with no note saying
// where they came from, and a re-measurement on another machine reproduced neither. Both
// READMEs now quote the recorded run, and the note has to agree with them.
test('the excludeGlobs figures the READMEs quote are the ones the note records', () => {
  const note = readFileSync(path.join(root, 'evidence', 'exclude-pruning-260918.md'), 'utf8');
  for (const figure of ['348,353', '756,239']) {
    assert.ok(note.includes(figure), 'the note no longer records ' + figure);
    assert.ok(readmeEn.includes(figure), 'README.md no longer quotes ' + figure);
    assert.ok(readmeKo.includes(figure), 'README.ko.md no longer quotes ' + figure);
  }
  for (const stale of ['331,709', '1,565,078', '1,565,196', '336,206']) {
    assert.equal(readmeEn.includes(stale), false, 'README.md still quotes the untraced ' + stale);
    assert.equal(readmeKo.includes(stale), false, 'README.ko.md still quotes the untraced ' + stale);
  }
  // The note names its own method, so a reader can re-run it rather than trust it.
  assert.match(note, /scripts\/measure-excludes\.mjs/);
});

// The symlink example is the one figure in that section a reader could check, so it is now
// reproducible: scripts/measure-symlink-skip.mjs builds the same directory and the note
// records what came back.
test('the symlink example the READMEs quote is the one the note records', () => {
  const note = readFileSync(path.join(root, 'evidence', 'symlink-skip-260918.md'), 'utf8');
  assert.match(note, /scripts\/measure-symlink-skip\.mjs/);
  for (const figure of ['37', '35', '2 rows']) assert.ok(note.includes(figure), 'the note no longer records ' + figure);
  assert.match(readmeEn, /37 entries where 35 were links/);
  assert.match(readmeEn, /evidence\/symlink-skip-260918\.md/);
  assert.match(readmeKo, /37개 중 35개가 링크/);
  assert.match(readmeKo, /evidence\/symlink-skip-260918\.md/);
  // The unrecorded figures the section used to carry are gone from both.
  for (const stale of ['530KB', '126 of 356', '356개 중 126개']) {
    assert.equal(readmeEn.includes(stale), false, 'README.md still quotes ' + stale);
    assert.equal(readmeKo.includes(stale), false, 'README.ko.md still quotes ' + stale);
  }
});

test('historical Aside-turn table is still present', () => {
  assert.match(readmeEn, /1\.81x/);
  assert.match(readmeEn, /1\.05x/);
  assert.match(readmeEn, /1\.13x/);
  assert.match(readmeKo, /1\.81배/);
  assert.match(readmeKo, /1\.05배/);
  assert.match(readmeKo, /1\.13배/);
});

test('Windows is Git Bash default and PowerShell is allowed', () => {
  const winEn = section(readmeEn, 'Windows');
  const winKo = section(readmeKo, 'Windows');
  assert.match(winEn, /Git Bash/);
  assert.match(winEn, /PowerShell/);
  assert.match(winKo, /Git Bash/);
  assert.match(winKo, /PowerShell/);
});

test('macOS section does not mention Git Bash', () => {
  assert.equal(section(readmeEn, 'macOS').includes('Git Bash'), false);
  assert.equal(section(readmeKo, 'macOS').includes('Git Bash'), false);
});

test('no Linux install recipe', () => {
  for (const text of [readmeEn, readmeKo, agents]) {
    assert.equal(/^## Linux\b/m.test(text), false);
    assert.equal(/\bUbuntu\b/.test(text), false);
    assert.equal(/\bapt\b/.test(text), false);
  }
});

test('51x evidence names the companion bench and equality check', () => {
  const note = readFileSync(path.join(root, 'evidence', 'dev-folder-51x.md'), 'utf8');
  assert.match(note, /eval\/bench-search\.mjs/);
  assert.match(note, /equality/);
});


// The browsing number leads the page now, so it gets the same treatment the 51x folder bench
// got: the README may not carry a figure the evidence note does not. Both baselines have to stay
// named, because 421x and 16x answer different questions and either one alone is a half-truth.
test('the browsing figures in both READMEs match the measurement they cite', () => {
  const note = readFileSync(path.join(root, 'evidence', 'browse-compression-260915.md'), 'utf8');
  for (const doc of [readmeEn, readmeKo]) {
    assert.match(doc, /1,865,043/);
    assert.match(doc, /4,430/);
    assert.match(doc, /71,983/);
    assert.match(doc, /421/);
    assert.match(doc, /browse-compression-260915\.md/);
  }
  for (const figure of [/1,865,043/, /71,983/, /63,825/, /4,430/, /421x/, /16\.3x/]) {
    assert.match(note, figure);
  }
});

// A ratio nobody can recompute is a slogan. The note carries the inputs, so the arithmetic
// is checkable here rather than trusted.
test('the stated ratios are what the stated bytes produce', () => {
  assert.equal(Math.round((1865043 / 4430) * 10) / 10, 421);
  assert.equal(Math.round((71983 / 4430) * 10) / 10, 16.2);
  assert.equal(Math.round((63825 / 4430) * 10) / 10, 14.4);
});

// The captcha pages were dropped from the set. Saying so is the difference between a benchmark
// and a selected result.
test('the note says which pages were dropped and why', () => {
  const note = readFileSync(path.join(root, 'evidence', 'browse-compression-260915.md'), 'utf8');
  assert.match(note, /EBLOCKED/);
  assert.match(note, /captcha/);
  assert.match(note, /news\.ycombinator\.com/);
  assert.match(note, /truncated/);
});
test('AGENTS template keeps its placeholders and Windows Git Bash', () => {
  const names = [...agents.matchAll(/\{\{[A-Z_]+\}\}/g)].map((m) => m[0]);
  // {{HELPER}} joined the set when the loader line stopped being session-relative: the path
  // differs per account root, so it has to be filled rather than written once.
  assert.deepEqual([...new Set(names)].sort(), ['{{CLI}}', '{{CWD_HINT}}', '{{HELPER}}', '{{NODE}}']);
  const flat = agents.replace(/\s+/g, ' ');
  assert.match(flat, /Git Bash/);
  assert.match(flat, /PowerShell/);
  assert.match(flat, /no Linux install path/);
  assert.match(flat, /Do not invoke `src\/cli\.js`/);
  assert.match(flat, /`rg`/);
  assert.equal(/[\uac00-\ud7a3]/.test(agents), false, 'template must stay English');
});

// wp9 moved the long form out of the account-wide block and into a skill. The block is read
// on every turn and a skill is read when it is loaded, so the split has to be deliberate:
// the block routes and forbids, the skill explains. These two cases keep it that way.
// The bound was 35, then 50, and is now 56. It moved the first time because the block had to
// gain the session rule, the evidence rule and the routing test; it moved again because a
// search can come back successful and incomplete, which no refusal can say for it. The number
// is a decision, recorded in ADR-0001 and ADR-0011 under structure/decisions/, and this is the
// one place that holds it: a second copy elsewhere would be a second number waiting to disagree.
test('the managed block stays short enough to be read every time', () => {
  const lines = agents.trimEnd().split('\n').length;
  assert.ok(lines <= 56, 'the AGENTS block is ' + lines + ' lines; it belongs in the skill');
});

test('what left the block landed in the skill, not on the floor', () => {
  const skill = readFileSync(path.join(root, 'templates', 'skill', 'SKILL.md'), 'utf8');
  const paths = readFileSync(path.join(root, 'templates', 'skill', 'references', 'execution-paths.md'), 'utf8');
  const windows = readFileSync(path.join(root, 'templates', 'skill', 'references', 'windows-invocation.md'), 'utf8');

  assert.match(skill, /browse\.attach/);
  assert.match(skill, /contentVerified/);
  assert.match(skill, /ENOACTIVE/);
  assert.match(skill, /checkpoint/);

  assert.match(paths, /--code-file/);
  assert.match(paths, /noIgnore/);
  assert.match(paths, /normalize\("NFC"\)/);
  assert.match(paths, /fs\.list/);
  assert.match(paths, /apply_patch/);

  assert.match(windows, /Unexpected token/);
  assert.match(windows, /ESOURCETOOLONG/);
  assert.match(windows, /ENOACTIVE/);

  for (const doc of [skill, paths, windows]) {
    assert.equal(/[\uac00-\ud7a3]/.test(doc), false, 'installed docs stay English');
  }
});
