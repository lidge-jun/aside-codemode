import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowse } from '../src/host/browse/browse.js';
import { createBrowseSession } from '../src/host/browse/session.js';
import {
  contextDirectory, contextScope, normalizeBrowseContext,
} from '../src/host/browse/context.js';
import { cacheKey } from '../src/host/browse/cache.js';
import { parseCliArgs } from '../src/cli-args.js';
import { runCode } from '../src/sandbox.js';
import { createReport } from '../src/host/namespaces.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'codemode.mjs');
const final = JSON.stringify({
  type: 'final', items: [{ jobId: 'j000', url: 'https://a.test', ok: true }],
  leakedUrls: [], partial: [], rows: [{ ok: true }],
}) + '\n[ok | 1ms]';

test('browseContext is immutable and validates only account and host', () => {
  const selected = normalizeBrowseContext({ account: '1', host: 'remote device' });
  assert.deepEqual(selected, { account: 'u1', host: 'remote device' });
  assert.equal(Object.isFrozen(selected), true);
  assert.throws(() => normalizeBrowseContext({ account: 'nope' }), /profile id like u1/);
  assert.throws(() => normalizeBrowseContext({ host: '--code' }), /host id or device name/);
  assert.throws(() => normalizeBrowseContext({ tenant: 'x' }), /unknown field/);
});

test('the --code value is opaque even when it looks exactly like a selector flag', () => {
  const parsed = parseCliArgs(['--code', '--host', '--account', 'u2']);
  assert.equal(parsed.value('--code'), '--host');
  assert.equal(parsed.has('--host'), false);
  assert.equal(parsed.value('--account'), 'u2');
});

test('run and raw prepend the same selectors, while defaults keep the original argv', async () => {
  const selectedSpawns = [];
  const selected = createBrowseSession({
    resolveAside: async () => 'aside',
    spawnAside: async (_bin, args) => { selectedSpawns.push(args); return { stdout: final }; },
    browseContext: { account: 'u2', host: 'remote-a' },
  });
  await selected.run({ urls: ['https://a.test'], timeoutMs: 5000 });
  await selected.raw('return 1');
  assert.deepEqual(selectedSpawns.map((args) => args.slice(0, -1)), [
    ['--account', 'u2', '--host', 'remote-a', 'repl'],
    ['--account', 'u2', '--host', 'remote-a', 'repl'],
  ]);

  let defaultArgs;
  const inherited = createBrowseSession({
    resolveAside: async () => 'aside',
    spawnAside: async (_bin, args) => { defaultArgs = args; return { stdout: final }; },
  });
  await inherited.raw('return 1');
  assert.deepEqual(defaultArgs, ['repl', 'return 1']);
});

test('cache and approval storage differ across requested browser contexts', async () => {
  const a = { account: 'u1', host: 'remote-a' };
  const b = { account: 'u1', host: 'remote-b' };
  assert.notEqual(
    cacheKey({ namespace: 'readText', subject: 'https://x.test', accountRoot: contextScope(a) }),
    cacheKey({ namespace: 'readText', subject: 'https://x.test', accountRoot: contextScope(b) }),
  );
  assert.notEqual(contextDirectory('/tmp/approvals', a), contextDirectory('/tmp/approvals', b));

  const approvalDir = path.join(tmpdir(), 'codemode-context-approval-' + process.pid);
  const make = (browseContext) => createBrowse({
    config: { browseContext, browseCaps: { enabled: true, approvalDir } },
    resolveAside: async () => 'aside',
    spawnAside: async () => ({ stdout: final }),
  });
  const first = make(a);
  const second = make(b);
  const refusal = await first.exec({
    urls: ['https://a.test'], refsFingerprint: 'fingerprint', actions: [{ ref: 'e1', click: true }],
  });
  const crossed = await second.approve({ approvalId: refusal.approvalId });
  assert.equal(crossed.state, 'unknown');
  assert.equal(crossed.changed, false);
});

test('partial selectors cannot become a reusable inherited identity', async () => {
  assert.equal(contextScope({ account: 'u1' }, '/local/u/0'), null);
  assert.equal(contextScope({ host: 'remote-a' }, '/local/u/0'), null);
  assert.notEqual(
    contextDirectory('/tmp/approvals', { account: 'u1' }),
    contextDirectory('/tmp/approvals', { account: 'u1' }),
    'each unresolved context gets a private store',
  );

  const browse = createBrowse({
    config: { browseContext: { account: 'u1' }, browseCaps: { enabled: true } },
    resolveAside: async () => 'aside',
    spawnAside: async () => ({ stdout: final }),
  });
  const refusal = await browse.exec({
    urls: ['https://a.test'], refsFingerprint: 'fingerprint', actions: [{ ref: 'e1', click: true }],
  });
  assert.equal(refusal.approvalId, null);
  assert.equal(refusal.status, 'needs_input');
  await assert.rejects(
    () => browse.approve({ approvalId: 'approval-00000000-0000-0000-0000-000000000000' }),
    (error) => error.code === 'EUNRESOLVEDCONTEXT',
  );
});

test('remote capture is refused before any browser process starts', async () => {
  let spawned = false;
  const browse = createBrowse({
    config: { browseContext: { host: 'remote-a' }, browseCaps: { enabled: true } },
    resolveAside: async () => 'aside',
    spawnAside: async () => { spawned = true; return { stdout: final }; },
  });
  await assert.rejects(
    () => browse.captureMany(['https://a.test'], { outDir: tmpdir(), screenshot: {} }),
    (error) => error.code === 'EREMOTEARTIFACT',
  );
  assert.equal(spawned, false);

  const report = createReport({
    config: { browseContext: { host: 'remote-a' }, browseCaps: { enabled: true } },
  });
  await assert.rejects(
    () => report.build({ outFile: path.join(tmpdir(), 'must-not-exist.pdf') }),
    (error) => error.code === 'EREMOTEARTIFACT',
  );
});

test("host 'local' keeps local artifact materialization available", async () => {
  let spawned = false;
  const browse = createBrowse({
    config: { browseContext: { host: 'local' }, browseCaps: { enabled: true } },
    resolveAside: async () => 'aside',
    spawnAside: async () => { spawned = true; return { stdout: final }; },
  });
  const result = await browse.captureMany(['https://a.test'], {});
  assert.equal(result.ok, true);
  assert.equal(spawned, true);
});

test('output pressure never silently drops browser context metadata', async () => {
  const browseContext = {
    requested: { account: 'u1', host: 'remote-with-a-long-device-name' },
    source: { account: 'config', host: 'config' },
    actualIdentity: 'unverified',
  };
  const squeezed = await runCode("return 'x'.repeat(10000);", {
    maxResultBytes: 96,
    resultMeta: { browseContext },
  });
  assert.equal(Object.hasOwn(squeezed, 'browseContext'), true);
  assert.equal(squeezed.browseContext, null, 'the minimum budget names metadata loss explicitly');
  assert.ok(Buffer.byteLength(JSON.stringify(squeezed)) + 1 <= 96);

  const invalid = await runCode('', { maxResultBytes: 4096, resultMeta: { browseContext } });
  assert.deepEqual(invalid.browseContext, browseContext);
  assert.equal(invalid.ok, false);
});

test('CLI rejects unknown execution flags and reports validated selector overrides', () => {
  const env = {
    ...process.env,
    CODEMODE_IGNORE_REPO_CONFIG: '1',
    XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), 'codemode-context-cli-')),
  };
  const bad = spawnSync(process.execPath, [cli, '--code', 'return 1', '--wat'], { encoding: 'utf8', env });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout, /unknown execution argument/);

  const good = spawnSync(process.execPath, [cli, '--code', 'return 1', '--account', '2', '--host', 'remote-a'], { encoding: 'utf8', env });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  const out = JSON.parse(good.stdout);
  assert.equal(out.result, 1);
  assert.deepEqual(out.browseContext.requested, { account: 'u2', host: 'remote-a' });
  assert.deepEqual(out.browseContext.source, { account: 'cli-override', host: 'cli-override' });
  assert.equal(out.browseContext.actualIdentity, 'unverified');
});
