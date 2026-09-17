import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { userConfigPath } from '../src/config.js';
import { applyRegister, configureMcpActivation } from '../src/register.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.join(here, '..');
const templateSrc = path.join(checkout, 'templates', 'AGENTS.codemode.md');
const mjs = path.join(checkout, 'scripts', 'register-aside.mjs');
const checkoutCfg = path.join(checkout, 'codemode.config.json');
const START = '<!-- aside-codemode:start -->';

function fixture() {
  const asideHome = mkdtempSync(path.join(tmpdir(), 'codemode-aside-'));
  const xdg = mkdtempSync(path.join(tmpdir(), 'codemode-xdg-'));
  const homedir = mkdtempSync(path.join(tmpdir(), 'codemode-home-'));
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'codemode-repo-'));
  mkdirSync(path.join(repoRoot, 'templates'), { recursive: true });
  mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'templates', 'AGENTS.codemode.md'), readFileSync(templateSrc));
  writeFileSync(path.join(repoRoot, 'bin', 'codemode.mjs'), '// fixture\n');
  const execPath = '/abs/node-bin';
  return { asideHome, xdg, homedir, repoRoot, execPath };
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

test('missing settings.json still writes AGENTS and settingsOk is false', () => {
  const fx = fixture();
  const r = run(fx);
  assert.equal(r.ok, true);
  assert.equal(r.settingsOk, false);
  assert.equal(r.serverEntry, 'absent');
  assert.equal(r.mcpActivated, false);
  assert.match(r.activationRequired, /Refresh tools/);
  assert.match(r.settingsError, /settings\.json not found/);
  assert.ok(existsSync(path.join(fx.asideHome, 'u', '0', 'AGENTS.md')));
});

test('second register does not duplicate markers', () => {
  const fx = fixture();
  run(fx);
  run(fx);
  const text = readFileSync(path.join(fx.asideHome, 'u', '0', 'AGENTS.md'), 'utf8');
  assert.equal(text.split(START).length - 1, 1);
});

test('rendered AGENTS contains execPath, absolute cli, and banned `rg`', () => {
  const fx = fixture();
  const r = run(fx);
  const text = readFileSync(r.agentsPath, 'utf8');
  assert.match(text, /`rg`/);
  assert.ok(text.includes(fx.execPath));
  assert.ok(text.includes(path.join(fx.repoRoot, 'bin', 'codemode.mjs')));
  assert.ok(text.includes('--cwd <abs-project>'));
});

test('existing settings.json is retargeted; AGENTS still written', () => {
  const fx = fixture();
  const account = path.join(fx.asideHome, 'u', '0');
  mkdirSync(account, { recursive: true });
  writeFileSync(path.join(account, 'settings.json'), JSON.stringify({ mcp: { servers: {} } }, null, 2));
  const r = run(fx);
  assert.equal(r.ok, true);
  assert.equal(r.settingsOk, true);
  assert.equal(r.serverEntry, 'written');
  assert.equal(r.mcpActivated, false);
  const settings = JSON.parse(readFileSync(path.join(account, 'settings.json'), 'utf8'));
  assert.equal(settings.mcp.servers['aside-codemode'].command, fx.execPath);
  assert.ok(settings.mcp.servers['aside-codemode'].args[0].endsWith(`${path.sep}src${path.sep}server.js`));
  assert.equal(Object.hasOwn(settings.mcp, 'inventories'), false, 'registration must not synthesize Aside-owned inventory data');
  assert.ok(existsSync(r.agentsPath));
});

test('activation writer normalizes only our server and backs up settings', () => {
  const fx = fixture();
  const account = path.join(fx.asideHome, 'u', '0');
  const settingsPath = path.join(account, 'settings.json');
  const unrelated = { exact: ['value', 7] };
  mkdirSync(account, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({
    unrelated,
    mcp: {
      servers: { 'aside-codemode': { enabled: false, command: '/old', extra: true } },
      inventories: {},
      toolInventoryMigrationVersion: 1,
    },
  }, null, 2) + '\n');

  const out = configureMcpActivation({ settingsPath, execPath: fx.execPath, repoRoot: fx.repoRoot });
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(out.activationPending, true);
  assert.equal(out.activationPendingReason, 'daemon-settings-reread-required');
  assert.deepEqual(settings.unrelated, unrelated);
  assert.deepEqual(settings.mcp.servers['aside-codemode'], {
    enabled: true,
    transport: 'stdio',
    command: fx.execPath,
    args: [path.join(fx.repoRoot, 'src', 'server.js'), '--config', path.join(fx.repoRoot, 'codemode.config.json')],
    env: {},
  });
  assert.equal(Object.hasOwn(settings.mcp, 'inventories'), false);
  assert.equal(Object.hasOwn(settings.mcp, 'toolInventoryMigrationVersion'), false);
  assert.ok(readdirSync(account).some((name) => name.startsWith('settings.json.bak-')));
});

test('retargeting merges the named server and leaves Aside-owned settings intact', () => {
  const fx = fixture();
  const account = path.join(fx.asideHome, 'u', '0');
  const settingsPath = path.join(account, 'settings.json');
  const inventory = { tools: [{ name: 'unrelated-tool' }], refreshedAt: 'fixture' };
  const otherServer = { command: '/opt/other', args: ['serve'], enabled: false };
  mkdirSync(account, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({
    theme: 'custom',
    mcp: {
      customField: { ownedBy: 'aside' },
      inventories: { unrelated: inventory },
      servers: {
        unrelated: otherServer,
        'aside-codemode': {
          command: '/stale/node', args: ['old'], enabled: false,
          transport: 'stdio', env: { CODEMODE_RG: '/opt/rg' }, asideOwned: { keep: true },
        },
      },
    },
  }, null, 4) + '\n');

  const first = run(fx);
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(first.serverEntry, 'written');
  assert.deepEqual(settings.mcp.servers.unrelated, otherServer);
  assert.deepEqual(settings.mcp.inventories, { unrelated: inventory });
  assert.deepEqual(settings.mcp.customField, { ownedBy: 'aside' });
  assert.equal(settings.theme, 'custom');
  assert.equal(settings.mcp.servers['aside-codemode'].enabled, false);
  assert.equal(settings.mcp.servers['aside-codemode'].transport, 'stdio');
  assert.deepEqual(settings.mcp.servers['aside-codemode'].env, { CODEMODE_RG: '/opt/rg' });
  assert.deepEqual(settings.mcp.servers['aside-codemode'].asideOwned, { keep: true });

  const afterFirst = readFileSync(settingsPath, 'utf8');
  const second = run(fx);
  assert.equal(second.serverEntry, 'unchanged');
  assert.equal(readFileSync(settingsPath, 'utf8'), afterFirst, 'an unchanged entry must not rewrite the settings file');
});

test('user config lands under injected XDG/homedir, not os.homedir()', () => {
  const fx = fixture();
  const r = run(fx);
  const expected = userConfigPath({ XDG_CONFIG_HOME: fx.xdg }, fx.homedir);
  assert.equal(r.userConfigPath, expected);
  assert.ok(existsSync(expected));
  assert.ok(expected.startsWith(fx.xdg + path.sep) || expected.startsWith(fx.homedir + path.sep));
  const live = userConfigPath();
  assert.notEqual(expected, live);
  assert.equal(existsSync(path.join(fx.homedir, '.config', 'codemode', 'config.json')) || expected.includes(fx.xdg), true);
});

test('thin CLI exits 0 without settings.json and does not touch checkout config', () => {
  const fx = fixture();
  const beforeExists = existsSync(checkoutCfg);
  const before = beforeExists ? { mtime: statSync(checkoutCfg).mtimeMs, body: readFileSync(checkoutCfg) } : null;
  const r = spawnSync(process.execPath, [mjs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ASIDE_HOME: fx.asideHome,
      XDG_CONFIG_HOME: fx.xdg,
      HOME: fx.homedir,
      CODEMODE_REPO_ROOT: fx.repoRoot,
    },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.settingsOk, false);
  assert.equal(parsed.mcpActivated, false);
  assert.match(r.stderr, /mcp-entry=absent/);
  assert.match(r.stderr, /MCP activation is still required/);
  assert.ok(existsSync(path.join(fx.asideHome, 'u', '0', 'AGENTS.md')));
  if (before) {
    assert.equal(statSync(checkoutCfg).mtimeMs, before.mtime);
    assert.deepEqual(readFileSync(checkoutCfg), before.body);
  } else {
    assert.equal(existsSync(checkoutCfg), false);
  }
});

test('package.json description is CLI-first', async () => {
  const pkg = JSON.parse(readFileSync(path.join(checkout, 'package.json'), 'utf8'));
  assert.equal(pkg.description.includes('MCP server'), false);
  assert.match(pkg.description, /codemode --code/);
  assert.ok(pkg.files.includes('templates/'));
});
