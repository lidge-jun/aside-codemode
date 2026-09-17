import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(checkout, 'bin', 'codemode.mjs');
const serverPath = path.join(checkout, 'src', 'server.js');
const configPath = path.join(checkout, 'codemode.config.json');
const next = 'Open Aside Settings > Plugins & MCPs > MCPs, select the aside-codemode server, use Refresh tools, then start a NEW Aside session.';

function server(command = process.execPath, args = [serverPath, '--config', configPath]) {
  return { command, args, transport: 'stdio' };
}

function writeSettings(asideHome, id, value) {
  const root = path.join(asideHome, 'u', id);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'settings.json'), typeof value === 'string' ? value : JSON.stringify(value));
}

test('--doctor distinguishes MCP registration, activation, stale, and settings error states', (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'codemode-doctor-mcp-'));
  const asideHome = path.join(base, '.aside');
  t.after(() => rmSync(base, { recursive: true, force: true }));

  writeSettings(asideHome, '0', { mcp: { servers: {} } });
  writeSettings(asideHome, '1', { mcp: { servers: { 'aside-codemode': server() } } });
  writeSettings(asideHome, '2', {
    mcp: {
      servers: { 'aside-codemode': server() },
      inventories: {
        'aside-codemode': { tools: [{ name: 'execute_code' }, { name: 'search_content' }] },
      },
    },
  });
  writeSettings(asideHome, '3', {
    mcp: {
      servers: {
        'aside-codemode': server(process.execPath, [path.join(base, 'old-install', 'src', 'server.js'), '--config', path.join(base, 'old-install', 'codemode.config.json')]),
      },
      inventories: { 'aside-codemode': { tools: [{ name: 'execute_code' }] } },
    },
  });
  writeSettings(asideHome, '4', '{ malformed json');
  mkdirSync(path.join(asideHome, 'u', '5'), { recursive: true });

  // If doctor consulted accounts.json, this unbacked account would appear. Account
  // discovery is intentionally directory-only so no account metadata is read.
  writeFileSync(path.join(asideHome, 'accounts.json'), JSON.stringify({ currentAccountId: 99, accounts: [{ id: 99 }] }));
  writeFileSync(path.join(asideHome, 'credentials.json'), '{ unreadable on purpose');

  const run = spawnSync(process.execPath, [cli, '--doctor'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ASIDE_HOME: asideHome,
      CODEMODE_ROOTS: base,
      CODEMODE_RG: process.execPath,
      CODEMODE_IGNORE_REPO_CONFIG: '1',
      XDG_CONFIG_HOME: path.join(base, 'config'),
    },
  });

  assert.equal(run.status, 0, run.stderr + run.stdout);
  const report = JSON.parse(run.stdout);
  assert.equal(report.mcp.rgPathAbsolute, true);
  assert.equal(report.mcp.rgPathConsequence, null);
  assert.equal(report.mcp.discoveryError, null);
  assert.equal(report.mcp.accountsTruncated, false);
  assert.deepEqual(report.mcp.accounts.map((account) => account.id), ['0', '1', '2', '3', '4', '5']);

  const byId = Object.fromEntries(report.mcp.accounts.map((account) => [account.id, account]));
  assert.deepEqual(byId['0'], {
    id: '0', settingsReadable: true, settingsError: null,
    serverRegistered: false, pointsToThisInstallation: null,
    cachedToolCount: 0, cachedToolNames: [], state: 'not-registered', next,
  });
  assert.equal(byId['1'].state, 'registered-not-activated');
  assert.equal(byId['1'].serverRegistered, true);
  assert.equal(byId['1'].pointsToThisInstallation, true);
  assert.equal(byId['1'].cachedToolCount, 0);
  assert.equal(byId['1'].next, next);

  assert.equal(byId['2'].state, 'activated');
  assert.deepEqual(byId['2'].cachedToolNames, ['execute_code', 'search_content']);
  assert.equal(byId['2'].cachedToolCount, 2);
  assert.equal(Object.hasOwn(byId['2'], 'next'), false);

  assert.equal(byId['3'].state, 'stale-entry');
  assert.equal(byId['3'].serverRegistered, true);
  assert.equal(byId['3'].pointsToThisInstallation, false);
  assert.equal(byId['3'].cachedToolCount, 1);
  assert.equal(byId['3'].next, next);

  for (const id of ['4', '5']) {
    assert.equal(byId[id].state, 'not-registered');
    assert.equal(byId[id].settingsReadable, false);
    assert.equal(typeof byId[id].settingsError, 'string');
    assert.equal(byId[id].serverRegistered, null);
    assert.equal(byId[id].pointsToThisInstallation, null);
    assert.equal(byId[id].next, next);
  }
  assert.equal(byId['99'], undefined);
});

test('--doctor reports a missing Aside installation without failing', (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'codemode-doctor-no-aside-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [cli, '--doctor'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ASIDE_HOME: path.join(base, 'missing'),
      CODEMODE_ROOTS: base,
      CODEMODE_RG: process.execPath,
      CODEMODE_IGNORE_REPO_CONFIG: '1',
      XDG_CONFIG_HOME: path.join(base, 'config'),
    },
  });

  assert.equal(run.status, 0, run.stderr + run.stdout);
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.mcp.accounts, []);
  assert.equal(typeof report.mcp.discoveryError, 'string');
});
