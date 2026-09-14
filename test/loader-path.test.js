// The loader line the installed docs hand an agent has to work on the surface that reads it.
// Two surfaces read it and they resolve a relative path differently: 'aside repl' resolves
// from its session directory (two under the account root), and the in-app agent REPL was
// reported to resolve from the account root itself, where '../../' leaves the account root
// and the fs guard refuses it. The only form measured to work on both is the absolute path,
// so that is what the rendered docs must say — per account, because each account root has
// its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plannedFiles, agentsBody } from '../scripts/install-codemode.mjs';
import { applyRegister, helperLoadPathFor } from '../src/register.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.join(here, '..');
const node = '/abs/node';
const cli = path.join(checkout, 'bin', 'codemode.mjs');

const render = (accountRoot) => {
  const files = plannedFiles({ node, cli, accountRoot });
  const skill = files.find((f) => f.path.endsWith('SKILL.md')).content;
  return { skill, agents: agentsBody({ node, cli, accountRoot }) };
};

// The first thing an agent copies is the first readFile it sees. If that line is relative,
// the in-app surface refuses it before anything else in the document matters.
const firstLoader = (text) => {
  const m = text.match(/fs\.readFile\(\s*(['"])(.*?)\1/);
  return m ? m[2] : null;
};

test('the rendered skill and block name this account root by absolute path', () => {
  const root = '/Users/someone/.aside/u/2';
  const { skill, agents } = render(root);
  const want = root + '/codemode/cm.js';
  assert.equal(skill.includes(want), true, 'SKILL.md still hides the account path');
  assert.equal(agents.includes(want), true, 'the AGENTS block still hides the account path');
});

test('the first loader instruction is not the session-relative form', () => {
  const { skill, agents } = render('/Users/someone/.aside/u/0');
  assert.equal(firstLoader(skill), '/Users/someone/.aside/u/0/codemode/cm.js');
  assert.equal(firstLoader(agents), '/Users/someone/.aside/u/0/codemode/cm.js');
});

// A Windows account root joined with backslashes is not a JavaScript string literal: it
// dies at parse time with "Invalid Unicode escape sequence" on \u. The rendered line has to
// survive being read as code, so the path goes in with forward slashes.
test('a windows account root renders a line that actually parses', () => {
  const root = 'C:\\Users\\super\\.aside\\u\\0';
  const { skill } = render(root);
  const line = firstLoader(skill);
  assert.equal(line, 'C:/Users/super/.aside/u/0/codemode/cm.js');
  const src = "const p = '" + line + "';";
  const got = new Function(src + ' return p;')();
  assert.equal(got, 'C:/Users/super/.aside/u/0/codemode/cm.js');
});

test('two account roots get two different loader paths, in the skill and in register', () => {
  assert.notEqual(firstLoader(render('/h/.aside/u/0').skill), firstLoader(render('/h/.aside/u/1').skill));

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
    assert.equal(written.includes(helperLoadPathFor(acct.root)), true,
      'account ' + acct.id + ' got another account\'s helper path');
  }
});
