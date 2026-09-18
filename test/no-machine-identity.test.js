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
import os from 'node:os';
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

// Hostnames were the half of the rule nobody could check. Three shipped source comments named
// two of this fleet's machines for weeks, inside the npm payload, while this suite passed:
// the scan above only knows what a home directory looks like, and a device name looks like an
// ordinary word. So the names come from the machine running the test - its own hostname, and
// the hosts its ssh config can reach - which is knowledge the test has and the repository must
// not. On a CI runner that list is short, and this check simply has less to say there.
function knownMachineNames() {
  const names = new Set();
  // Only distinctive names are usable. Several aliases on a developer's machine are ordinary
  // words - a short dictionary word, a bare number - and scanning for those would fail on prose
  // nothing to do with any machine. A name counts when it carries a hyphen or a digit, or is
  // long enough that its appearance in source is not a coincidence. That is a filter, not a
  // proof: a host called "server" still gets past it, and a human still has to look.
  const add = (value) => {
    const name = String(value || '').trim().toLowerCase().split('.')[0];
    if (/[*?!]/.test(name)) return;
    if (!/^[a-z][a-z0-9._-]*$/.test(name)) return;
    if (['localhost', 'runner', 'ubuntu', 'macos', 'windows'].includes(name)) return;
    const distinctive = /[-]/.test(name) || /[0-9]/.test(name) || name.length >= 7;
    if (distinctive) names.add(name);
  };
  add(os.hostname());
  try {
    const config = readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
    for (const line of config.split(String.fromCharCode(10))) {
      const m = /^\s*Host\s+(.+)$/i.exec(line);
      if (!m) continue;
      for (const alias of m[1].split(/\s+/)) add(alias);
    }
  } catch { /* no ssh config here, and none is required */ }
  return [...names];
}

test('no tracked file names a machine this one can reach', () => {
  const names = knownMachineNames();
  const found = [];
  for (const rel of tracked) {
    // This file lists the generic words it allows, and the scan would read them as evidence.
    if (rel === 'test/no-machine-identity.test.js') continue;
    const text = readIfText(rel);
    if (text === null) continue;
    const lower = text.toLowerCase();
    for (const name of names) {
      let at = lower.indexOf(name);
      while (at !== -1) {
        const before = lower[at - 1] || ' ';
        const after = lower[at + name.length] || ' ';
        // A name inside a longer word is a different word, and the package's own name appears
        // in paths everywhere.
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9-]/.test(after)) {
          const line = text.slice(0, at).split(String.fromCharCode(10)).length;
          found.push(rel + ':' + line + ' names a host this machine knows');
          break;
        }
        at = lower.indexOf(name, at + name.length);
      }
    }
  }
  assert.deepEqual(found, [], found.join(String.fromCharCode(10)));
});

// The regex has to keep catching what it was written for. A pattern that quietly stops matching
// passes this suite forever while the rule it encodes is gone.
//
// The samples are assembled rather than written out, because this file is tracked too and the
// scan above reads it. Spelling a violating path here would make the guard fail on its own
// fixtures - which it did, on the first run in CI, which is the sort of thing a guard should do.
test('the pattern still recognises the shapes it was written for', () => {
  const NAME = 'somebody' + 'real';
  const U = String.fromCharCode(92);
  const shapes = [
    ['/' + 'Users/' + NAME + '/.aside/u/0', NAME],
    ['/' + 'home/' + NAME + '/aside-codemode', NAME],
    ['C:' + U + 'Users' + U + NAME + U + '.aside', NAME],
    ['C:/' + 'Users/' + NAME + '/.aside', NAME],
  ];
  for (const [sample, name] of shapes) {
    const hit = [...sample.matchAll(HOME_PATH)];
    assert.equal(hit.length, 1, 'stopped matching: ' + sample);
    assert.equal(hit[0][1], name);
  }
  const ok = '/' + 'Users/someone/.aside';
  assert.equal([...ok.matchAll(HOME_PATH)].every((m) => PLACEHOLDERS.has(m[1])), true);
});

// A FILENAME is a tracked string too, and both scans above read file bodies. Four probe
// scripts sat at the repository root differing only by the hostname in their names, and
// `git ls-files` carried all four past a green suite of 978 tests.
//
// The host-derived scan below cannot catch them, which is why this assertion names the shape
// instead. Of the four leaked names, knownMachineNames() drops two of them before any
// comparison because neither has a hyphen or a digit and both are under seven characters;
// the other two survive that filter and then fail the word-boundary test,
// because the character after each is `s`, from "side". Zero of four. A guard that is green
// while the defect is present is worse than no guard.
test('the fleet probe is tracked once, under a name that is nobody', () => {
  const probes = tracked.filter((f) => f.endsWith('fleet-probe.mjs'));
  assert.deepEqual(probes, ['scripts/aside-fleet-probe.mjs']);
});

// This one is for the NEXT filename rather than that one. It is an early warning, not
// enforcement: it only knows names this machine can see, so a CI runner has almost nothing
// to compare against, and the distinctive filter drops short names entirely. Its value is
// that a path is no longer invisible; its limit is written here so nobody reads it as proof.
test('no tracked PATH names a machine or an account this one knows', () => {
  const names = knownMachineNames();
  const found = [];
  for (const rel of tracked) {
    if (rel === 'test/no-machine-identity.test.js') continue;
    const lower = rel.toLowerCase();
    for (const name of names) {
      let at = lower.indexOf(name);
      while (at !== -1) {
        // A path separator is a word boundary; a letter is not. That is exactly why the four
        // *side-fleet-probe.mjs names slipped past, and the assertion above covers them.
        const before = lower[at - 1] || '/';
        const after = lower[at + name.length] || '/';
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9-]/.test(after)) {
          found.push(rel + ' names a host this machine knows');
          break;
        }
        at = lower.indexOf(name, at + name.length);
      }
    }
    for (const m of rel.matchAll(HOME_PATH)) {
      if (!PLACEHOLDERS.has(m[1])) found.push(rel + ' carries a real account name in its path');
    }
  }
  assert.deepEqual(found, [], found.join(String.fromCharCode(10)));
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
    'evidence/aside-mcp-activation-260918.md',
    'evidence/aside-mcp-attach-260918.md',
    // The 2026-09-18 set. Raw JSON dumps and the runner script from that session are
    // deliberately NOT here: they carry absolute home paths. The notes carry numbers only,
    // and the fixture script is parameterised so it reproduces without naming a machine.
    'evidence/bench-260918/PROTOCOL.md',
    'evidence/bench-260918/agent-baseline.md',
    'evidence/bench-260918/completeness.md',
    'evidence/bench-260918/local-search.md',
    'evidence/bench-260918/make-completeness-fixture.sh',
    'evidence/bench-260918/mcp-completeness.md',
    'evidence/bench-260918/mcp-local-search.md',
    'evidence/bench-260918/mcp-path.md',
    'evidence/browse-compression-260915.md',
    'evidence/dev-folder-51x.md',
    'evidence/exclude-pruning-260918.md',
    'evidence/mcp-force-restore-260918.md',
    'evidence/review-hardening-20260913.json',
    'evidence/summary-compound.md',
    'evidence/summary.md',
    'evidence/symlink-skip-260918.md',
    'evidence/synthetic-search-bench.md',
  ];
  assert.deepEqual(tracked.filter((f) => f.startsWith('evidence/')).sort(), allowed);
});
