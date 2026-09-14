import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRegister, installLauncher, listAccountRoots, renderPosixLauncher,
} from '../src/register.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.join(here, '..');
const templateSrc = path.join(checkout, 'templates', 'AGENTS.codemode.md');
const START = '<!-- aside-codemode:start -->';

function fixture() {
  const asideHome = mkdtempSync(path.join(tmpdir(), 'codemode-acct-'));
  const xdg = mkdtempSync(path.join(tmpdir(), 'codemode-xdg-'));
  const homedir = mkdtempSync(path.join(tmpdir(), 'codemode-home-'));
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'codemode-repo-'));
  mkdirSync(path.join(repoRoot, 'templates'), { recursive: true });
  mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'templates', 'AGENTS.codemode.md'), readFileSync(templateSrc));
  writeFileSync(path.join(repoRoot, 'bin', 'codemode.mjs'), '// fixture\n');
  return { asideHome, xdg, homedir, repoRoot, execPath: '/abs/node-bin' };
}

function run(fx, extra = {}) {
  return applyRegister({
    asideHome: fx.asideHome,
    repoRoot: fx.repoRoot,
    execPath: fx.execPath,
    homedir: fx.homedir,
    xdgConfigHome: fx.xdg,
    ...extra,
  });
}

function writeAccounts(fx, obj) {
  writeFileSync(path.join(fx.asideHome, 'accounts.json'),
    typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

function mkAccountDirs(fx, ids) {
  for (const id of ids) mkdirSync(path.join(fx.asideHome, 'u', String(id)), { recursive: true });
}

test('no accounts.json and no u/ falls back to u/0 (back-compat)', () => {
  const fx = fixture();
  const { roots, truncated } = listAccountRoots({ asideHome: fx.asideHome });
  assert.equal(truncated, false);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].id, '0');
  assert.equal(roots[0].current, true);
});

test('currentAccountId leads, and every listed account is a root', () => {
  const fx = fixture();
  writeAccounts(fx, {
    currentAccountId: 1,
    accounts: [{ id: 1, name: 'cloud' }, { id: 0, name: 'local' }, { id: 2, name: 'local' }],
  });
  const { roots } = listAccountRoots({ asideHome: fx.asideHome });
  assert.deepEqual(roots.map((r) => r.id), ['1', '0', '2']);
  assert.equal(roots[0].current, true);
  assert.equal(roots.filter((r) => r.current).length, 1);
});

test('directory scan adds roots accounts.json never mentions, and skips non-numeric names', () => {
  const fx = fixture();
  writeAccounts(fx, { currentAccountId: 0, accounts: [{ id: 0 }] });
  mkAccountDirs(fx, [0, 3, 11]);
  mkdirSync(path.join(fx.asideHome, 'u', 'scratch'), { recursive: true });
  writeFileSync(path.join(fx.asideHome, 'u', '.DS_Store'), 'junk');
  const { roots } = listAccountRoots({ asideHome: fx.asideHome });
  assert.deepEqual(roots.map((r) => r.id), ['0', '3', '11']);
});

test('malformed accounts.json is not fatal; the directory scan still stands', () => {
  const fx = fixture();
  writeAccounts(fx, '{ this is not json');
  mkAccountDirs(fx, [0, 1]);
  const { roots } = listAccountRoots({ asideHome: fx.asideHome });
  assert.deepEqual(roots.map((r) => r.id), ['0', '1']);
  assert.equal(roots[0].current, true);
});

test('an explicit account list narrows the set', () => {
  const fx = fixture();
  writeAccounts(fx, { currentAccountId: 1, accounts: [{ id: 0 }, { id: 1 }, { id: 2 }] });
  const { roots } = listAccountRoots({ asideHome: fx.asideHome, only: ['2'] });
  assert.deepEqual(roots.map((r) => r.id), ['2']);
  assert.equal(roots[0].current, true, 'the only requested root becomes primary');
});

test('more than 32 roots is truncated and reported, not fanned out', () => {
  const fx = fixture();
  const accounts = [];
  for (let i = 0; i < 50; i += 1) accounts.push({ id: i });
  writeAccounts(fx, { currentAccountId: 0, accounts });
  const { roots, truncated } = listAccountRoots({ asideHome: fx.asideHome });
  assert.equal(truncated, true);
  assert.equal(roots.length, 32);
});

test('register writes the block into every account root, current one first', () => {
  const fx = fixture();
  writeAccounts(fx, { currentAccountId: 1, accounts: [{ id: 0 }, { id: 1 }, { id: 2 }] });
  const r = run(fx);
  assert.equal(r.ok, true);
  assert.equal(r.accountsWritten, 3);
  assert.equal(r.accounts[0].id, '1');
  assert.equal(r.accounts[0].current, true);
  assert.equal(r.agentsPath, path.join(fx.asideHome, 'u', '1', 'AGENTS.md'));
  for (const id of ['0', '1', '2']) {
    const p = path.join(fx.asideHome, 'u', id, 'AGENTS.md');
    assert.ok(existsSync(p), 'missing AGENTS.md for u/' + id);
    assert.ok(readFileSync(p, 'utf8').includes(fx.execPath));
  }
});

test('the macmini shape: registering no longer lands on an unused profile', () => {
  const fx = fixture();
  // accounts.json says the live cloud account is id 1; u/0 is an anonymous local one.
  writeAccounts(fx, {
    currentAccountId: 1,
    accounts: [
      { id: 1, name: 'bitkyc07', provider: 'google', mode: 'cloud' },
      { id: 0, name: 'Local Account', provider: 'anonymous', mode: 'local' },
    ],
  });
  mkAccountDirs(fx, [0, 1]);
  writeFileSync(path.join(fx.asideHome, 'u', '1', 'AGENTS.md'), '# tiny stub\n');
  const r = run(fx);
  const live = readFileSync(path.join(fx.asideHome, 'u', '1', 'AGENTS.md'), 'utf8');
  assert.ok(live.includes(START), 'the live account root must carry the managed block');
  assert.ok(live.includes('# tiny stub'), 'pre-existing content is preserved');
  assert.equal(r.accounts.find((a) => a.id === '1').current, true);
});

test('re-register does not duplicate the marker in any root', () => {
  const fx = fixture();
  writeAccounts(fx, { currentAccountId: 0, accounts: [{ id: 0 }, { id: 1 }] });
  run(fx);
  run(fx);
  for (const id of ['0', '1']) {
    const text = readFileSync(path.join(fx.asideHome, 'u', id, 'AGENTS.md'), 'utf8');
    assert.equal(text.split(START).length - 1, 1, 'duplicate marker in u/' + id);
  }
});

test('the MCP entry lands on the current account only, and ok stays true', () => {
  const fx = fixture();
  writeAccounts(fx, { currentAccountId: 1, accounts: [{ id: 0 }, { id: 1 }] });
  mkAccountDirs(fx, [0, 1]);
  writeFileSync(path.join(fx.asideHome, 'u', '1', 'settings.json'), JSON.stringify({ mcp: { servers: {} } }));
  writeFileSync(path.join(fx.asideHome, 'u', '0', 'settings.json'), JSON.stringify({ mcp: { servers: {} } }));
  const r = run(fx);
  assert.equal(r.ok, true);
  const cur = r.accounts.find((a) => a.id === '1');
  const other = r.accounts.find((a) => a.id === '0');
  assert.equal(cur.settingsOk, true);
  assert.equal(other.settingsSkipped, true, 'an untouched profile keeps its settings.json');
  const untouched = JSON.parse(readFileSync(path.join(fx.asideHome, 'u', '0', 'settings.json'), 'utf8'));
  assert.deepEqual(untouched.mcp.servers, {});
});

test('a non-current root that already has an aside-codemode entry is refreshed', () => {
  const fx = fixture();
  writeAccounts(fx, { currentAccountId: 1, accounts: [{ id: 0 }, { id: 1 }] });
  mkAccountDirs(fx, [0, 1]);
  writeFileSync(path.join(fx.asideHome, 'u', '0', 'settings.json'),
    JSON.stringify({ mcp: { servers: { 'aside-codemode': { command: '/stale/node', args: [] } } } }));
  const r = run(fx);
  const other = r.accounts.find((a) => a.id === '0');
  assert.equal(other.settingsOk, true);
  const s = JSON.parse(readFileSync(path.join(fx.asideHome, 'u', '0', 'settings.json'), 'utf8'));
  assert.equal(s.mcp.servers['aside-codemode'].command, fx.execPath);
});

test('launcher renders an exec shim that survives spaces in either path', () => {
  const body = renderPosixLauncher({ node: '/opt/my node/bin/node', cli: '/Users/a b/aside-codemode/bin/codemode.mjs' });
  assert.match(body, /^#!\/bin\/sh/);
  assert.ok(body.includes('exec "/opt/my node/bin/node" "/Users/a b/aside-codemode/bin/codemode.mjs" "$@"'));
});

test('installLauncher backs up a foreign file and is idempotent afterwards', () => {
  const fx = fixture();
  const bin = path.join(fx.homedir, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'codemode'), '#!/bin/sh\necho someone elses script\n');
  const first = installLauncher({ homedir: fx.homedir, node: '/n', cli: '/c', platform: 'linux' });
  assert.equal(first.ok, true);
  assert.ok(first.backedUp, 'a foreign file must be backed up');
  assert.ok(existsSync(first.backedUp));
  const second = installLauncher({ homedir: fx.homedir, node: '/n', cli: '/c', platform: 'linux' });
  assert.equal(second.ok, true);
  assert.equal(second.backedUp, null, 'our own shim is not backed up again');
});

test('register with launcher:true reports the shim path', () => {
  const fx = fixture();
  const r = run(fx, { launcher: true, platform: 'linux' });
  assert.equal(r.launcher.ok, true);
  assert.equal(r.launcher.path, path.join(fx.homedir, '.local', 'bin', 'codemode'));
  assert.ok(readFileSync(r.launcher.path, 'utf8').includes(r.cli));
});

test('browsing stays off unless the install explicitly asks for it', () => {
  const fx = fixture();
  run(fx);
  const cfg = JSON.parse(readFileSync(path.join(fx.xdg, 'codemode', 'config.json'), 'utf8'));
  assert.equal(cfg.browseCaps === undefined || cfg.browseCaps.enabled !== true, true);
});

test('enableBrowse opts the machine in without dropping the other browse caps', () => {
  const fx = fixture();
  const cfgPath = path.join(fx.xdg, 'codemode', 'config.json');
  mkdirSync(path.dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, JSON.stringify({ browseCaps: { enabled: false, maxTabs: 3 } }));
  run(fx, { enableBrowse: true });
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  assert.equal(cfg.browseCaps.enabled, true);
  assert.equal(cfg.browseCaps.maxTabs, 3, 'an existing cap must survive the opt-in');
});
