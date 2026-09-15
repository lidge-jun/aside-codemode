// The loader line the installed docs hand an agent has to work on the surface that reads it.
// Two surfaces read it and they resolve a relative path differently: 'aside repl' resolves
// from its session directory (two under the account root), and the in-app agent REPL was
// reported to resolve from the account root itself, where '../../' leaves the account root
// and the fs guard refuses it. The only form measured to work on both is the absolute path,
// so that is what the rendered docs must say - per account, because each account root has
// its own.
//
// These checks run the rendered line as code with a stubbed fs, rather than matching it with
// a regex. A regex agreed with itself about a path containing an apostrophe while the line
// an agent would paste did not parse at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plannedFiles, agentsBody } from '../scripts/install-codemode.mjs';
import { runInstaller } from '../scripts/install-codemode.mjs';
import { applyRegister, helperLoadPathFor } from '../src/register.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.join(here, '..');
const node = '/abs/node';
const cli = path.join(checkout, 'bin', 'codemode.mjs');

const render = (accountRoot) => {
  const files = plannedFiles({ node, cli, accountRoot });
  return {
    skill: files.find((f) => f.path.endsWith('SKILL.md')).content,
    agents: agentsBody({ node, cli, accountRoot }),
  };
};

// Execute the documented line with fs.readFile replaced by a recorder. If the line does not
// parse, this throws - which is the failure we care about.
async function loadedPath(text) {
  const line = text.split('\n').map((s) => s.trim()).find((l) => l.includes('fs.readFile('));
  assert.ok(line, 'the document has no loader line at all');
  const seen = [];
  const stub = { readFile: async (p) => { seen.push(p); return ''; } };
  await new Function('fs', 'return (async () => { ' + line + ' })();')(stub);
  return seen[0];
}

const WINDOWS_ROOT = 'C:' + String.fromCharCode(92) + 'Users' + String.fromCharCode(92) + 'super'
  + String.fromCharCode(92) + '.aside' + String.fromCharCode(92) + 'u' + String.fromCharCode(92) + '0';
const UNC_ROOT = String.fromCharCode(92, 92) + 'server' + String.fromCharCode(92) + 'share'
  + String.fromCharCode(92) + '.aside' + String.fromCharCode(92) + 'u' + String.fromCharCode(92) + '0';

test('the rendered skill and block name this account root by absolute path', () => {
  const root = '/Users/someone/.aside/u/2';
  const { skill, agents } = render(root);
  const want = root + '/codemode/cm.js';
  assert.equal(skill.includes(want), true, 'SKILL.md still hides the account path');
  assert.equal(agents.includes(want), true, 'the AGENTS block still hides the account path');
});

test('the documented line loads the account path, not the session-relative one', async () => {
  const { skill, agents } = render('/Users/someone/.aside/u/0');
  assert.equal(await loadedPath(skill), '/Users/someone/.aside/u/0/codemode/cm.js');
  assert.equal(await loadedPath(agents), '/Users/someone/.aside/u/0/codemode/cm.js');
});

// Every one of these is a directory the installer already accepts: install-paths.test.js
// installs under a space, Korean characters, an apostrophe and '&'/'$'. A document that
// cannot be pasted on those machines is a broken install with a green test suite.
for (const [name, root] of [
  ['a space', '/Users/al onso/.aside/u/0'],
  ['an apostrophe', "/Users/al/it's mine/.aside/u/0"],
  ['Korean characters', '/Users/al/한글폴더/.aside/u/0'],
  ['a dollar and ampersand', '/Users/al/amp & dollar $x/.aside/u/0'],
  ['a windows root', WINDOWS_ROOT],
  ['a UNC root', UNC_ROOT],
]) {
  test('the rendered line parses and loads the right file with ' + name, async () => {
    const { skill, agents } = render(root);
    const want = helperLoadPathFor(root);
    assert.equal(await loadedPath(skill), want);
    assert.equal(await loadedPath(agents), want);
  });
}

test('backslashes become slashes one for one, so a UNC prefix survives', () => {
  assert.equal(helperLoadPathFor(WINDOWS_ROOT), 'C:/Users/super/.aside/u/0/codemode/cm.js');
  // Collapsing a run of backslashes would turn \\server\share into /server/share, which is a
  // different machine's path on the same line.
  assert.equal(helperLoadPathFor(UNC_ROOT), '//server/share/.aside/u/0/codemode/cm.js');
});

// Rendering is not installing. applyWrites can preserve a file it decides is the user's, so
// the bytes on disk after a real install verb are what an agent actually reads.
test('the skill written to disk by install carries this account path', async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'acm-loader-disk-'));
  const home = path.join(base, "it's mine", '.aside');
  const root = path.join(home, 'u', '0');
  mkdirSync(root, { recursive: true });
  const out = runInstaller({ verb: 'install', asideHome: home, account: '0' });
  assert.deepEqual(out.preserved, []);
  const onDisk = readFileSync(path.join(root, 'skills/user/aside-codemode/SKILL.md'), 'utf8');
  assert.equal(await loadedPath(onDisk), helperLoadPathFor(root));
  const block = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal(await loadedPath(block), helperLoadPathFor(root));
});

// The relative form stays in the documents as an explanation of why the absolute one is
// there. It must not come back as an instruction: the first runnable loader line is what an
// agent copies.
test('the session-relative form survives only as prose, never as the first instruction', async () => {
  const { skill, agents } = render('/Users/someone/.aside/u/0');
  for (const doc of [skill, agents]) {
    const runnable = doc.split('\n').filter((l) => /^\s{4,}.*fs\.readFile\(/.test(l));
    assert.equal(runnable.length > 0, true, 'no runnable loader line at all');
    for (const line of runnable) {
      assert.equal(line.includes('../../codemode/cm.js'), false, 'a runnable line still teaches the relative path: ' + line.trim());
    }
  }
  assert.equal(await loadedPath(skill), '/Users/someone/.aside/u/0/codemode/cm.js');
});

test('two account roots get two different loader paths, in the skill and in register', async () => {
  assert.notEqual(await loadedPath(render('/h/.aside/u/0').skill), await loadedPath(render('/h/.aside/u/1').skill));

  const asideHome = mkdtempSync(path.join(os.tmpdir(), 'acm-loader-home-'));
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'acm-loader-repo-'));
  mkdirSync(path.join(repoRoot, 'templates'), { recursive: true });
  mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'templates', 'AGENTS.codemode.md'),
    readFileSync(path.join(checkout, 'templates', 'AGENTS.codemode.md')));
  writeFileSync(path.join(repoRoot, 'bin', 'codemode.mjs'), '// fixture\n');
  for (const id of ['0', '1']) mkdirSync(path.join(asideHome, 'u', id), { recursive: true });

  const out = applyRegister({
    asideHome,
    repoRoot,
    execPath: '/abs/node-bin',
    homedir: mkdtempSync(path.join(os.tmpdir(), 'acm-loader-user-')),
    xdgConfigHome: mkdtempSync(path.join(os.tmpdir(), 'acm-loader-xdg-')),
  });
  assert.equal(out.accounts.length >= 2, true);
  for (const acct of out.accounts) {
    const written = readFileSync(acct.agentsPath, 'utf8');
    assert.equal(await loadedPath(written), helperLoadPathFor(acct.root),
      'account ' + acct.id + ' was handed another account path');
  }
});
