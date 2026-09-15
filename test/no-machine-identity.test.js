// The rule this file enforces: a public repository does not publish the machines that built it.
//
// It was not enforced, and 156 tracked files described four hosts, three usernames, their home
// directories, their node paths and their session ids - including a fleet note that named all of
// them and called itself a release artifact. .gitignore stopped the next one; this stops the one
// after that, because the next probe writes a filename nobody remembers to add to a list.
//
// Scope is every file git actually tracks, read through `git ls-files`, so a file that is ignored
// but sitting on disk is none of this test's business and a file that sneaks past the ignore
// rules is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\u0000')
  .filter(Boolean);

// Names that are obviously nobody. A doc needs a home directory in its examples, and inventing
// one is the correct way to write it; these are the invented ones this repository already uses.
const PLACEHOLDERS = new Set(['someone', 'me', 'you', 'user', 'alice', 'bob', 'a', 'al', 'x', '...', 'USER', 'linuxbrew', 'runner']);

// A home directory with a name in it. The name is captured so the failure can say which one.
const HOME_PATH = /(?:\/Users\/|\/home\/|[Cc]:[\\/]+Users[\\/]+)([A-Za-z0-9._-]+)/g;

const readIfText = (rel) => {
  const abs = path.join(root, rel);
  try {
    if (statSync(abs).size > 2 * 1024 * 1024) return null;
    const buf = readFileSync(abs);
    if (buf.includes(0)) return null;   // a binary; bin/rg.exe is not prose
    return buf.toString('utf8');
  } catch { return null; }
};

test('no tracked file carries a real home directory', () => {
  const found = [];
  for (const rel of tracked) {
    const text = readIfText(rel);
    if (text === null) continue;
    for (const m of text.matchAll(HOME_PATH)) {
      if (!PLACEHOLDERS.has(m[1])) {
        const line = text.slice(0, m.index).split(String.fromCharCode(10)).length;
        found.push(rel + ':' + line + ' -> ' + m[0]);
      }
    }
  }
  assert.deepEqual(found, [],
    'a real account name reached a tracked file. Use one of: ' + [...PLACEHOLDERS].join(', ') + String.fromCharCode(10) + found.join(String.fromCharCode(10)));
});

// The regex has to keep catching what it was written for. A pattern that quietly stops matching
// passes this suite forever while the rule it encodes is gone.
test('the pattern still recognises the shapes it was written for', () => {
  const shapes = [
    ['/Users/somebodyreal/.aside/u/0', 'somebodyreal'],
    ['/home/somebodyreal/aside-codemode', 'somebodyreal'],
    ['C:\\Users\\somebodyreal\\.aside', 'somebodyreal'],
    ['C:/Users/somebodyreal/.aside', 'somebodyreal'],
  ];
  for (const [sample, name] of shapes) {
    const hit = [...sample.matchAll(HOME_PATH)];
    assert.equal(hit.length, 1, 'stopped matching: ' + sample);
    assert.equal(hit[0][1], name);
  }
  assert.equal([...'/Users/someone/.aside'.matchAll(HOME_PATH)].every((m) => PLACEHOLDERS.has(m[1])), true);
});

// The three trees where a machine describes itself. Ignoring them is only half of it: a
// `git add -f` or a stale index entry puts them back, and nothing else would notice.
test('the local-record trees are not tracked', () => {
  const leaked = tracked.filter((f) => f.startsWith('devlog/') || f.startsWith('.codexclaw/'));
  assert.deepEqual(leaked, [], 'local records are tracked again');
});

// evidence/ is ignored by default and opened file by file, so this is the list of exceptions,
// stated here as well as in .gitignore. Adding a file to evidence/ should be a decision, not a
// side effect of running a probe.
test('only the cited measurement notes are tracked under evidence/', () => {
  const allowed = [
    'evidence/browse-compression-260915.md',
    'evidence/dev-folder-51x.md',
    'evidence/review-hardening-20260913.json',
    'evidence/summary-compound.md',
    'evidence/summary.md',
    'evidence/synthetic-search-bench.md',
  ];
  assert.deepEqual(tracked.filter((f) => f.startsWith('evidence/')).sort(), allowed);
});
