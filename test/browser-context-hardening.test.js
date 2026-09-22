import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowse } from '../src/host/browse/browse.js';
import { createReport } from '../src/host/namespaces.js';
import { createApprovals } from '../src/host/browse/approvals.js';
import { createTabJournal } from '../src/host/browse/tab-journal.js';
import { buildCacheIdentity, browserContextDirectory, resolveBrowserContext, validateHost } from '../src/browser-context.js';
import { createToolHandler } from '../src/tools.js';
import { createHostGlobals } from '../src/host/globals.js';
import { makeRootGuard } from '../src/paths.js';

const cli = fileURLToPath(new URL('../bin/codemode.mjs', import.meta.url));
const writingJob = { urls: ['https://a.test'], actions: [{ selector: 'button', click: true }] };
const response = (payload) => ({ stdout: JSON.stringify({ type: 'final', ...payload }) + '\n[ok | 1ms]' });

test('host validation refuses option injection and control characters through CLI and MCP', async () => {
  let calls = 0;
  const handler = createToolHandler({
    config: { maxTimeoutMs: 1000, maxResultBytes: 65536 },
    globals: () => { calls++; return {}; },
  });
  for (const host of ['-p', '-h', ' remote\n', 'remote\tname', 'remote\u007fname', '\u0000local']) {
    assert.throws(() => validateHost(host), /--host/);
    await assert.rejects(handler({ code: 'return 1', host }), error => error.invalidParams === true);
    if (!host.includes('\u0000')) {
      const out = spawnSync(process.execPath, [cli, '--host', host, '--code', 'return 1'], { encoding: 'utf8' });
      assert.equal(out.status, 1);
      assert.match(out.stdout, /--host/);
    }
  }
  assert.equal(calls, 0);
  assert.equal(validateHost('remote device'), 'remote device');
});

test('per-call MCP selectors still override config and reach browse.context', async () => {
  const config = { maxTimeoutMs: 1000, maxResultBytes: 65536, browseContext: { account: 'u3', host: 'configured-host' } };
  const handler = createToolHandler({
    config,
    globals: (signal, options) => createHostGlobals(config, makeRootGuard([tmpdir()]), signal, options),
  });
  const selected = JSON.parse((await handler({ code: 'return browse.context()', account: 'u1', host: 'local' })).content[0].text);
  assert.equal(selected.result.account, 'u1');
  assert.equal(selected.result.host, 'local');
  assert.equal(selected.browserContext.accountSource, 'explicit');
  const configured = JSON.parse((await handler({ code: 'return browse.context()' })).content[0].text);
  assert.equal(configured.result.account, 'u3');
  assert.equal(configured.result.host, 'configured-host');
  assert.equal(configured.browserContext.hostSource, 'config');
});

test('explicit local host still permits capture execution', async () => {
  let spawns = 0;
  const browserContext = resolveBrowserContext({ mcpArgs: { account: 'u1', host: 'local' } });
  const browse = createBrowse({
    browserContext, config: { browseCaps: { enabled: true } },
    resolveAside: async () => 'aside',
    spawnAside: async () => { spawns++; return response({ items: [{ jobId: 'j000', url: 'https://a.test', ok: true }], partial: [], leakedUrls: [] }); },
  });
  assert.equal((await browse.captureMany(['https://a.test'])).ok, true);
  assert.equal(spawns, 1);
});

for (const context of [{}, { account: 'u1' }, { host: 'remote-a' }]) {
  test(`unresolved/remote host refuses local artifacts: ${JSON.stringify(context)}`, async () => {
    let spawns = 0;
    const config = { browseCaps: { enabled: true } };
    const browserContext = resolveBrowserContext({ mcpArgs: context });
    const browse = createBrowse({ config, browserContext, resolveAside: async () => 'aside', spawnAside: async () => { spawns++; return response({}); } });
    await assert.rejects(browse.captureMany(['https://a.test'], { outDir: tmpdir() }), error => error.code === 'EREMOTEARTIFACT' && /explicit.*local/.test(error.message));
    await assert.rejects(createReport({ config, browserContext }).build({ outFile: 'unused.pdf' }), error => error.code === 'EREMOTEARTIFACT');
    assert.equal(spawns, 0);
  });
}

for (const context of [{}, { account: 'u1' }, { host: 'local' }]) {
  test(`incomplete context never reuses browser state: ${JSON.stringify(context)}`, async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cm-unresolved-review-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const approvalDir = path.join(dir, 'approvals');
    const tabJournalDir = path.join(dir, 'tabs');
    // Legacy records are deliberately present. Neither matching the local account nor
    // seeing the same target id establishes the identity of an inherited remote host.
    const legacy = createApprovals({ dir: approvalDir });
    const held = legacy.open({ job: writingJob, wants: ['click'], urls: writingJob.urls });
    const journal = createTabJournal({ dir: tabJournalDir });
    journal.record({ runId: 'legacy-run', stdout: JSON.stringify({ type: 'tab', ev: 'open', targetId: 'same-id', url: 'https://a.test' }) });
    const before = readdirSync(tabJournalDir);
    let selected = 'identity-a';
    let spawns = 0;
    const make = () => createBrowse({
      config: { browseCaps: { enabled: true, approvalDir, tabJournalDir } },
      browserContext: resolveBrowserContext({ mcpArgs: context }),
      resolveAside: async () => 'aside',
      spawnAside: async () => {
        spawns++;
        return response({ rows: [{ url: 'https://a.test', title: selected }] });
      },
    });
    assert.equal(buildCacheIdentity('/local/u/0', context), null);
    assert.throws(() => browserContextDirectory(dir, context), /requires both account and host/);
    const browse = make();
    const query = 'isolated-' + path.basename(dir);
    const first = await browse.searchMany([query], { engine: 'youtube' });
    assert.equal(first.items[0].rows[0].title, 'identity-a');
    selected = 'identity-b';
    const second = await browse.searchMany([query], { engine: 'youtube' });
    const third = await make().searchMany([query], { engine: 'youtube' });
    assert.equal(second.items[0].rows[0].title, 'identity-b');
    assert.equal(third.items[0].rows[0].title, 'identity-b');
    assert.equal(spawns, 3, 'no cache reuse even within the same host-globals instance');
    const refusal = await browse.exec(writingJob);
    assert.equal(refusal.approvalId, null);
    for (const method of ['approve', 'reject']) {
      await assert.rejects(browse[method]({ approvalId: held.approvalId }), error => error.code === 'EUNRESOLVEDCONTEXT');
    }
    assert.equal(legacy.read(held.approvalId).state, 'pending');
    assert.equal((await browse.leakedTabs()).code, 'EUNRESOLVEDCONTEXT');
    assert.equal(spawns, 3, 'approval and journal lookups start no browser work');
    assert.deepEqual(readdirSync(tabJournalDir), before);
    assert.equal(readdirSync(path.join(approvalDir, 'pending')).length, 1);
  });
}

for (const mode of ['--enable-browse', '--install-mcp']) {
  test(`${mode} validates all flags before changing settings`, (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cm-argv-review-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const configDir = path.join(dir, 'codemode');
    const accountDir = path.join(dir, 'u', '1');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(accountDir, { recursive: true });
    const config = path.join(configDir, 'config.json');
    const settings = path.join(accountDir, 'settings.json');
    const configBefore = '{"browseCaps":{"enabled":false},"untouched":true}\n';
    const settingsBefore = '{"mcp":{"servers":{}},"untouched":true}\n';
    writeFileSync(config, configBefore);
    writeFileSync(settings, settingsBefore);
    writeFileSync(path.join(dir, 'accounts.json'), '{"currentAccountId":1,"accounts":[{"id":1}]}');
    const invalid = [
      ['--typo'], ['--host', 'remote-a'], ['--config', 'ignored.json'],
      ['--code', 'return 1'], ['--doctor'], ['--account'], ['--host', ''],
      [mode === '--enable-browse' ? '--install-mcp' : '--enable-browse'],
    ];
    if (mode === '--enable-browse') invalid.push(['--account', 'u1'], ['--force']);
    for (const flags of invalid) {
      const out = spawnSync(process.execPath, [cli, mode, ...flags], {
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, XDG_CONFIG_HOME: dir, ASIDE_HOME: dir, CODEMODE_ASIDE_CLI: path.join(dir, 'must-not-run'), CODEMODE_IGNORE_REPO_CONFIG: '1' },
      });
      assert.equal(out.status, 1, JSON.stringify(flags) + out.stdout + out.stderr);
      assert.equal(JSON.parse(out.stdout).code, 'EBADARGV');
      assert.equal(readFileSync(config, 'utf8'), configBefore);
      assert.equal(readFileSync(settings, 'utf8'), settingsBefore);
      assert.deepEqual(readdirSync(accountDir), ['settings.json'], 'no backup or new settings file');
    }
  });
}
