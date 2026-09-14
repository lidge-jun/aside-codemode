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

test('old general-50x denial strings are gone', () => {
  for (const phrase of forbidden) {
    assert.equal(readmeEn.includes(phrase), false, phrase);
    assert.equal(readmeKo.includes(phrase), false, phrase);
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
test('the managed block stays short enough to be read every time', () => {
  const lines = agents.trimEnd().split('\n').length;
  assert.ok(lines <= 35, 'the AGENTS block is ' + lines + ' lines; it belongs in the skill');
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
