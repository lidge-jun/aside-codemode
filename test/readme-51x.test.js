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

test('AGENTS template keeps three placeholders and Windows Git Bash', () => {
  const names = [...agents.matchAll(/\{\{[A-Z_]+\}\}/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(names)].sort(), ['{{CLI}}', '{{CWD_HINT}}', '{{NODE}}']);
  assert.match(agents, /Git Bash/);
  assert.match(agents, /PowerShell/);
  assert.match(agents, /no Linux install path/);
  assert.match(agents, /Do not invoke `src\/cli\.js`/);
  assert.equal(/[\uac00-\ud7a3]/.test(agents), false, 'template must stay English');
});
