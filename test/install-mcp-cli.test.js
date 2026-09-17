// The --install-mcp branch, exercised through the real CLI.
//
// The unit tests inject run(), so they can never catch an argument the CLI fails to check
// before it reaches the daemon. An audit found exactly that: --account nope silently
// configured whichever profile was current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(checkout, 'bin', 'codemode.mjs');

function asideHomeWith(accounts) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codemode-install-mcp-'));
  writeFileSync(path.join(home, 'accounts.json'), JSON.stringify({ currentAccountId: accounts[0], accounts: accounts.map((id) => ({ id })) }));
  for (const id of accounts) {
    mkdirSync(path.join(home, 'u', String(id)), { recursive: true });
    writeFileSync(path.join(home, 'u', String(id), 'settings.json'), JSON.stringify({ mcp: { servers: {} } }, null, 2));
  }
  return home;
}

function runCli(args, env = {}) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

test('an --account value that is not a profile id is refused, not reinterpreted', () => {
  const home = asideHomeWith(['1']);
  const out = runCli(['--install-mcp', '--account', 'nope'], { ASIDE_HOME: home });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /--account must be an Aside profile id/);
  // Nothing reached the daemon, so the account it would have fallen back to is untouched.
  assert.deepEqual(JSON.parse(readFileSync(path.join(home, 'u', '1', 'settings.json'), 'utf8')).mcp.servers, {});
});

test('a missing --account value does not swallow the next flag', () => {
  const home = asideHomeWith(['1']);
  const out = runCli(['--install-mcp', '--account', '--json'], { ASIDE_HOME: home });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /--account needs an account id/);
});

test('an account Aside has never opened is refused by name', () => {
  const home = asideHomeWith(['1']);
  const out = runCli(['--install-mcp', '--account', 'u9'], { ASIDE_HOME: home });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /account u9 has no settings\.json/);
});

// The stub is an executable script, which is a POSIX arrangement. The argument checks above
// are the part that has to hold on every platform, and they do not spawn anything.
const stubbable = process.platform !== 'win32';

test('the CLI reports the inventory Aside wrote, not its own intent', { skip: stubbable ? false : 'needs an executable stub' }, () => {
  const home = asideHomeWith(['1']);
  const settings = path.join(home, 'u', '1', 'settings.json');
  const stub = path.join(home, 'aside-stub.mjs');
  writeFileSync(stub, [
    '#!/usr/bin/env node',
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "const settings = process.env.STUB_SETTINGS;",
    "const verb = process.argv.slice(2).find((a) => a === 'repl' || a === 'exec');",
    "if (verb === 'repl') {",
    "  const s = JSON.parse(readFileSync(settings, 'utf8'));",
    "  s.mcp = { servers: { 'aside-codemode': { enabled: true } } };",
    "  writeFileSync(settings, JSON.stringify(s));",
    '  console.log(JSON.stringify({ codemodeActivation: 1, ok: true, wrote: "aside-codemode", servers: ["aside-codemode"], version: null, inventories: [] }));',
    '} else {',
    "  const s = JSON.parse(readFileSync(settings, 'utf8'));",
    "  s.mcp.toolInventoryMigrationVersion = 1;",
    "  s.mcp.inventories = { 'aside-codemode': { tools: [{ name: 'execute_code' }] } };",
    "  writeFileSync(settings, JSON.stringify(s));",
    "  console.log('ok');",
    '}',
    '',
  ].join('\n'));
  chmodSync(stub, 0o755);

  const out = runCli(['--install-mcp', '--account', 'u1', '--json'], {
    ASIDE_HOME: home, CODEMODE_ASIDE_CLI: stub, STUB_SETTINGS: settings,
  });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const report = JSON.parse(out.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.activated, true);
  assert.deepEqual(report.tools, ['execute_code']);
  assert.equal(report.account, 'u1');
});

test('a discovery pass that cached nothing of ours fails the command', { skip: stubbable ? false : 'needs an executable stub' }, () => {
  const home = asideHomeWith(['1']);
  const settings = path.join(home, 'u', '1', 'settings.json');
  const stub = path.join(home, 'aside-silent.mjs');
  writeFileSync(stub, [
    '#!/usr/bin/env node',
    "const verb = process.argv.slice(2).find((a) => a === 'repl' || a === 'exec');",
    "if (verb === 'repl') console.log(JSON.stringify({ codemodeActivation: 1, ok: true, wrote: 'aside-codemode', servers: ['aside-codemode'], version: null, inventories: [] }));",
    "else console.log('ok');",
    '',
  ].join('\n'));
  chmodSync(stub, 0o755);

  const out = runCli(['--install-mcp', '--account', 'u1', '--json'], {
    ASIDE_HOME: home, CODEMODE_ASIDE_CLI: stub, STUB_SETTINGS: settings,
  });
  assert.equal(out.status, 1);
  const report = JSON.parse(out.stdout);
  assert.equal(report.activated, false);
  assert.match(report.next, /not in the cached inventory/);
});

test('an aside CLI that is not there says so', () => {
  const home = asideHomeWith(['1']);
  const out = runCli(['--install-mcp', '--account', 'u1', '--json'], {
    ASIDE_HOME: home,
    CODEMODE_ASIDE_CLI: path.join(home, 'no-such-aside-binary'),
  });
  assert.equal(out.status, 1);
  const report = JSON.parse(out.stdout);
  assert.equal(report.cliMissing, true);
  assert.match(report.detail, /ENOENT|no such file|not found/i);
});
