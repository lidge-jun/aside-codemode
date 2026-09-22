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
import { contextScope, contextDirectory } from '../src/host/browse/context.js';

const cli = fileURLToPath(new URL('../bin/codemode.mjs', import.meta.url));
const writingJob = { urls: ['https://a.test'], actions: [{ selector: 'button', click: true }] };
const response = (payload) => ({ stdout: JSON.stringify({ type: 'final', ...payload }) + '\n[ok | 1ms]' });

for (const context of [{}, { account: 'u1' }, { host: 'remote-a' }]) {
  test(`unresolved/remote host refuses local artifacts: ${JSON.stringify(context)}`, async () => {
    let spawns = 0;
    const config = { browseContext: context, browseCaps: { enabled: true } };
    const browse = createBrowse({ config, resolveAside: async () => 'aside', spawnAside: async () => { spawns++; return response({}); } });
    await assert.rejects(browse.captureMany(['https://a.test'], { outDir: tmpdir() }), error => error.code === 'EREMOTEARTIFACT' && /explicit.*local/.test(error.message));
    await assert.rejects(createReport({ config }).build({ outFile: 'unused.pdf' }), error => error.code === 'EREMOTEARTIFACT');
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
      config: { browseContext: context, browseCaps: { enabled: true, approvalDir, tabJournalDir } },
      resolveAside: async () => 'aside',
      spawnAside: async () => {
        spawns++;
        return response({ rows: [{ url: 'https://a.test', title: selected }] });
      },
    });
    assert.equal(contextScope(context), null);
    assert.throws(() => contextDirectory(dir, context), /requires both account and host/);
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
