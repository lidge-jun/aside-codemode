// Tests for browser account and host routing (issue #44).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { TOOL_DEF, createToolHandler } from '../src/tools.js';
import { createBrowse } from '../src/host/browse/browse.js';
import { createReport } from '../src/host/namespaces.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'codemode.mjs');

const FINAL_OK = JSON.stringify({
  type: 'final', leakedUrls: [], partial: [],
  items: [{ jobId: 'j000', url: 'https://example.com', ok: true }],
  rows: [{ kind: 'tabs', tabs: [] }, { kind: 'page', tab: { targetId: 't1' } }],
}) + '\n[ok | 5ms]';

const writingJob = (url = 'https://example.com/write') => ({
  urls: [url],
  refsFingerprint: 'r1-test',
  actions: [{ ref: 'e1', click: true }],
});

test('CLI --account u99 --host sample-host --code return 1 produces selected browser context metadata', () => {
  const res = spawnSync(process.execPath, [cli, '--account', 'u99', '--host', 'sample-host', '--code', 'return 1'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `CLI failed with exit code ${res.status}: ${res.stderr || res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.result, 1);
  assert.ok(out.browserContext, 'expected out.browserContext metadata in CLI output');
  assert.equal(out.browserContext.account, 'u99');
  assert.equal(out.browserContext.host, 'sample-host');
});

test('CLI expression flags: -1 accepted expression, --code "--host" is JS error not missing selector, stray positional and duplicate flags rejected', () => {
  // 1. --code '-1' is accepted expression
  const resNeg = spawnSync(process.execPath, [cli, '--code', '-1'], { encoding: 'utf8' });
  assert.equal(resNeg.status, 0, `CLI --code '-1' failed: ${resNeg.stderr || resNeg.stdout}`);
  const outNeg = JSON.parse(resNeg.stdout);
  assert.equal(outNeg.ok, true, "--code '-1' must be accepted as an expression without CLI flag error");
  if (outNeg.result !== undefined) {
    assert.equal(outNeg.result, -1);
  }

  // 2. --code '--host' should be a JS error, not a selector missing error
  const resCodeHost = spawnSync(process.execPath, [cli, '--code', '--host'], { encoding: 'utf8' });
  const combined = (resCodeHost.stdout || '') + (resCodeHost.stderr || '');
  assert.ok(!/--host requires a value/.test(combined), 'should not be missing host selector error');
  assert.ok(!/--code requires a code string/.test(combined), 'should not be missing code error');
  const outCodeHost = JSON.parse(resCodeHost.stdout || '{}');
  assert.equal(outCodeHost.ok, false);
  if (outCodeHost.browserContext) {
    assert.equal(outCodeHost.browserContext.host, null, 'code argument "--host" must not be inferred as a host selector');
  }

  // 3. Stray positional arguments rejected before guest
  const resStrayStart = spawnSync(process.execPath, [cli, 'stray-arg', '--code', 'return 1'], { encoding: 'utf8' });
  assert.notEqual(resStrayStart.status, 0, 'stray positional argument at start must reject non-zero');
  const outStrayStart = JSON.parse(resStrayStart.stdout || '{}');
  assert.equal(outStrayStart.ok, false);

  const resStrayEnd = spawnSync(process.execPath, [cli, '--code', 'return 1', 'stray-tail'], { encoding: 'utf8' });
  assert.notEqual(resStrayEnd.status, 0, 'stray positional argument at end must reject non-zero');
  const outStrayEnd = JSON.parse(resStrayEnd.stdout || '{}');
  assert.equal(outStrayEnd.ok, false);

  // 4. Duplicate flags rejected before guest
  const resDupAcct = spawnSync(process.execPath, [cli, '--account', 'u1', '--account', 'u2', '--code', 'return 1'], { encoding: 'utf8' });
  assert.notEqual(resDupAcct.status, 0, 'duplicate --account must reject non-zero');
  const outDupAcct = JSON.parse(resDupAcct.stdout || '{}');
  assert.equal(outDupAcct.ok, false);

  const resDupHost = spawnSync(process.execPath, [cli, '--host', 'hostA', '--host', 'hostB', '--code', 'return 1'], { encoding: 'utf8' });
  assert.notEqual(resDupHost.status, 0, 'duplicate --host must reject non-zero');
  const outDupHost = JSON.parse(resDupHost.stdout || '{}');
  assert.equal(outDupHost.ok, false);
});

test('invalid/missing account/host and unknown execution flags reject before guest', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-routing-reject-'));
  const marker = path.join(dir, 'guest-marker.txt');
  const codeWithSideEffect = `await fs.write('${marker}', 'ran'); return 1;`;

  // 1. Invalid account format
  const resBadAcct = spawnSync(process.execPath, [cli, '--account', 'invalid-account', '--code', codeWithSideEffect], { encoding: 'utf8' });
  assert.notEqual(resBadAcct.status, 0, 'invalid account format must fail non-zero');
  const outBadAcct = JSON.parse(resBadAcct.stdout || '{}');
  assert.equal(outBadAcct.ok, false);
  assert.equal(existsSync(marker), false, 'guest code must not run when account format is invalid');

  // 2. Missing account value (flag immediately followed by another flag)
  const resMissingAcct = spawnSync(process.execPath, [cli, '--account', '--host', 'sample-host', '--code', codeWithSideEffect], { encoding: 'utf8' });
  assert.notEqual(resMissingAcct.status, 0, 'missing account value must fail non-zero');
  const outMissingAcct = JSON.parse(resMissingAcct.stdout || '{}');
  assert.equal(outMissingAcct.ok, false);
  assert.equal(existsSync(marker), false, 'guest code must not run when account value is missing');

  // 3. Missing host value (flag immediately followed by another flag)
  const resMissingHost = spawnSync(process.execPath, [cli, '--account', 'u1', '--host', '--code', codeWithSideEffect], { encoding: 'utf8' });
  assert.notEqual(resMissingHost.status, 0, 'missing host value must fail non-zero');
  const outMissingHost = JSON.parse(resMissingHost.stdout || '{}');
  assert.equal(outMissingHost.ok, false);
  assert.equal(existsSync(marker), false, 'guest code must not run when host value is missing');

  // 4. Unknown execution flags
  const resUnknownFlag = spawnSync(process.execPath, [cli, '--unknown-execution-flag', '--code', codeWithSideEffect], { encoding: 'utf8' });
  assert.notEqual(resUnknownFlag.status, 0, 'unknown execution flag must fail non-zero');
  const outUnknownFlag = JSON.parse(resUnknownFlag.stdout || '{}');
  assert.equal(outUnknownFlag.ok, false);
  assert.equal(existsSync(marker), false, 'guest code must not run when unknown execution flag is passed');
});

test('MCP schema accepts optional account/host and rejects unknown keys', async () => {
  const schema = TOOL_DEF.inputSchema;
  assert.equal(schema.type, 'object');
  assert.ok(schema.properties.account, 'inputSchema must define account property');
  assert.ok(schema.properties.host, 'inputSchema must define host property');
  assert.deepEqual(schema.required, ['code'], 'only code is required; account and host are optional');
  assert.equal(schema.additionalProperties, false, 'additionalProperties must be false');

  const handler = createToolHandler({
    config: { maxTimeoutMs: 30000, maxResultBytes: 65536 },
    globals: () => ({}),
  });

  // Unknown property must be rejected
  await assert.rejects(
    async () => handler({ code: 'return 1;', unknownKey: 'invalid' }),
    (err) => err.invalidParams === true,
    'unknown parameters must be rejected with invalidParams',
  );

  // Invalid account must be rejected
  await assert.rejects(
    async () => handler({ code: 'return 1;', account: 'invalid-account' }),
    (err) => err.invalidParams === true,
    'invalid account must be rejected with invalidParams',
  );

  // Valid optional account and host are accepted
  const res = await handler({ code: 'return 1;', account: 'u1', host: 'sample-host' });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.ok, true);
});

test('MCP rejects null and number account/host wrong types with invalidParams', async () => {
  const handler = createToolHandler({
    config: { maxTimeoutMs: 30000, maxResultBytes: 65536 },
    globals: () => ({}),
  });

  await assert.rejects(
    async () => handler({ code: 'return 1;', account: null }),
    (err) => err.invalidParams === true,
    'account: null must reject with invalidParams',
  );

  await assert.rejects(
    async () => handler({ code: 'return 1;', account: 123 }),
    (err) => err.invalidParams === true,
    'account as number must reject with invalidParams',
  );

  await assert.rejects(
    async () => handler({ code: 'return 1;', host: null }),
    (err) => err.invalidParams === true,
    'host: null must reject with invalidParams',
  );

  await assert.rejects(
    async () => handler({ code: 'return 1;', host: 123 }),
    (err) => err.invalidParams === true,
    'host as number must reject with invalidParams',
  );
});

test('handler forwards selected context via percall host creation, no global mutations', async () => {
  const baseConfig = Object.freeze({
    roots: [root],
    maxResultBytes: 65536,
    maxTimeoutMs: 30000,
    browseCaps: { enabled: true, timeoutMs: 25000, maxTabs: 8, concurrency: 4 },
  });

  const capturedContexts = [];
  const globalsFactory = (signal, context) => {
    capturedContexts.push(context);
    return {
      search: {},
      fs: {},
      read_file: async () => '',
      write_file: async () => '',
      edit_file: async () => '',
      apply_patch: async () => '',
      actions: {},
      browse: {},
      report: {},
      api: {},
      recipes: {},
    };
  };

  const handler = createToolHandler({ config: baseConfig, globals: globalsFactory });

  // Call 1 with explicit account and host
  await handler({ code: 'return 1;', account: 'u2', host: 'host-b' });

  // Call 2 with omitted account/host (should not inherit previous call's context)
  await handler({ code: 'return 1;' });

  assert.equal(capturedContexts.length, 2);
  const ctx1 = capturedContexts[0]?.browserContext;
  assert.ok(ctx1, 'call 1 must have browserContext');
  assert.equal(ctx1.account, 'u2', 'call 1 should receive selected account u2');
  assert.equal(ctx1.host, 'host-b', 'call 1 should receive selected host host-b');

  const ctx2 = capturedContexts[1]?.browserContext;
  assert.notEqual(ctx2?.account, 'u2', 'call 2 must not retain previous call account');
  assert.notEqual(ctx2?.host, 'host-b', 'call 2 must not retain previous call host');

  // Base config was frozen and had no properties added
  assert.equal(baseConfig.account, undefined);
  assert.equal(baseConfig.host, undefined);
});

test('browse native argv includes --account uN --host value before repl both exec/attach paths', async () => {
  let spawnedCalls = [];
  const fakeSpawn = async (bin, args) => {
    spawnedCalls.push({ bin, args });
    return {
      stdout: FINAL_OK,
      killed: false,
    };
  };
  const fakeResolve = async () => '/fake/bin/aside';

  const browse = createBrowse({
    config: {
      browseCaps: { enabled: true },
    },
    browserContext: { account: 'u3', host: 'remote-box' },
    spawnAside: fakeSpawn,
    resolveAside: fakeResolve,
  });

  // 1. exec path
  await browse.exec({ urls: ['https://example.com'] });
  assert.ok(spawnedCalls.length > 0, 'exec path must spawn aside');
  const execArgs = spawnedCalls[0].args;
  const replIdxExec = execArgs.indexOf('repl');
  assert.notEqual(replIdxExec, -1, 'args must contain "repl"');

  const acctIdxExec = execArgs.indexOf('--account');
  const hostIdxExec = execArgs.indexOf('--host');

  assert.notEqual(acctIdxExec, -1, 'exec args must contain "--account"');
  assert.equal(execArgs[acctIdxExec + 1], 'u3', '--account value must be normalized to uN');
  assert.ok(acctIdxExec < replIdxExec, '--account must appear before "repl"');

  assert.notEqual(hostIdxExec, -1, 'exec args must contain "--host"');
  assert.equal(execArgs[hostIdxExec + 1], 'remote-box', '--host value must be remote-box');
  assert.ok(hostIdxExec < replIdxExec, '--host must appear before "repl"');

  // 2. attach path
  spawnedCalls = [];
  await browse.attach({ urlIncludes: 'example' });
  assert.ok(spawnedCalls.length > 0, 'attach path must spawn aside');
  const attachArgs = spawnedCalls[0].args;
  const replIdxAttach = attachArgs.indexOf('repl');
  assert.notEqual(replIdxAttach, -1, 'args must contain "repl"');

  const acctIdxAttach = attachArgs.indexOf('--account');
  const hostIdxAttach = attachArgs.indexOf('--host');

  assert.notEqual(acctIdxAttach, -1, 'attach args must contain "--account"');
  assert.equal(attachArgs[acctIdxAttach + 1], 'u3', '--account value must be normalized to uN');
  assert.ok(acctIdxAttach < replIdxAttach, '--account must appear before "repl"');

  assert.notEqual(hostIdxAttach, -1, 'attach args must contain "--host"');
  assert.equal(attachArgs[hostIdxAttach + 1], 'remote-box', '--host value must be remote-box');
  assert.ok(hostIdxAttach < replIdxAttach, '--host must appear before "repl"');
});

test('concurrent distinct calls do not cross route', async () => {
  const spawned = [];
  const fakeSpawnConcurrent = async (bin, args) => {
    await new Promise((r) => setTimeout(r, 20));
    spawned.push({ bin, args });
    return {
      stdout: FINAL_OK,
      killed: false,
    };
  };
  const fakeResolve = async () => '/fake/bin/aside';

  const browse1 = createBrowse({
    config: {
      browseCaps: { enabled: true },
    },
    browserContext: { account: 'u1', host: 'host-alpha' },
    spawnAside: fakeSpawnConcurrent,
    resolveAside: fakeResolve,
  });

  const browse2 = createBrowse({
    config: {
      browseCaps: { enabled: true },
    },
    browserContext: { account: 'u2', host: 'host-beta' },
    spawnAside: fakeSpawnConcurrent,
    resolveAside: fakeResolve,
  });

  await Promise.all([
    browse1.exec({ urls: ['https://example.com/alpha'] }),
    browse2.exec({ urls: ['https://example.com/beta'] }),
  ]);

  assert.equal(spawned.length, 2, 'both calls must spawn');

  const call1 = spawned.find((s) => s.args.some((a) => a.includes('alpha')));
  const call2 = spawned.find((s) => s.args.some((a) => a.includes('beta')));

  assert.ok(call1, 'call 1 must be present');
  assert.ok(call2, 'call 2 must be present');

  const c1Acct = call1.args[call1.args.indexOf('--account') + 1];
  const c1Host = call1.args[call1.args.indexOf('--host') + 1];
  assert.equal(c1Acct, 'u1', 'call 1 must route to account u1');
  assert.equal(c1Host, 'host-alpha', 'call 1 must route to host-alpha');

  const c2Acct = call2.args[call2.args.indexOf('--account') + 1];
  const c2Host = call2.args[call2.args.indexOf('--host') + 1];
  assert.equal(c2Acct, 'u2', 'call 2 must route to account u2');
  assert.equal(c2Host, 'host-beta', 'call 2 must route to host-beta');
});

test('cross-account+host approval cannot claim (foreign approve returns unchanged and no spawn, original can approve once)', async () => {
  const approvalDir = path.join(tmpdir(), 'codemode-routing-approvals-' + Date.now());
  const spawnsA = [];
  const spawnsB = [];
  const spawnsC = [];

  const browseA = createBrowse({
    config: { browseCaps: { enabled: true, approvalDir } },
    browserContext: { account: 'u1', host: 'hostA' },
    resolveAside: async () => '/fake/aside',
    spawnAside: async (bin, args) => { spawnsA.push(args); return { stdout: FINAL_OK, killed: false }; },
  });

  const browseB = createBrowse({
    config: { browseCaps: { enabled: true, approvalDir } },
    browserContext: { account: 'u2', host: 'hostA' },
    resolveAside: async () => '/fake/aside',
    spawnAside: async (bin, args) => { spawnsB.push(args); return { stdout: FINAL_OK, killed: false }; },
  });

  const browseC = createBrowse({
    config: { browseCaps: { enabled: true, approvalDir } },
    browserContext: { account: 'u1', host: 'hostB' },
    resolveAside: async () => '/fake/aside',
    spawnAside: async (bin, args) => { spawnsC.push(args); return { stdout: FINAL_OK, killed: false }; },
  });

  const refused = await browseA.exec(writingJob());
  assert.equal(refused.status, 'needs_input');
  assert.ok(refused.approvalId, 'refusal must produce approvalId');

  // 1. Foreign account (u2, hostA) cannot claim
  const foreignAcct = await browseB.approve({ approvalId: refused.approvalId });
  assert.equal(foreignAcct.ok, false, 'foreign account approval must fail');
  assert.equal(foreignAcct.changed, false, 'foreign account approval must be unchanged');
  assert.equal(spawnsB.length, 0, 'foreign account must not spawn');

  // 2. Foreign host (u1, hostB) cannot claim
  const foreignHost = await browseC.approve({ approvalId: refused.approvalId });
  assert.equal(foreignHost.ok, false, 'foreign host approval must fail');
  assert.equal(foreignHost.changed, false, 'foreign host approval must be unchanged');
  assert.equal(spawnsC.length, 0, 'foreign host must not spawn');

  // 3. Original instance (u1, hostA) can approve once
  const original = await browseA.approve({ approvalId: refused.approvalId });
  assert.equal(original.ok, true, 'original instance approval must succeed');
  assert.equal(original.changed, true, 'original instance approval must report changed');
  assert.equal(spawnsA.length, 1, 'original instance must spawn once');

  // 4. Second approve on original instance is a safe no-op
  const second = await browseA.approve({ approvalId: refused.approvalId });
  assert.equal(second.changed, false, 'second approve must report changed: false');
  assert.equal(spawnsA.length, 1, 'second approve must not spawn again');
});

test('cache identity is partitioned per account and host context via readText', async () => {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount++;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>' + 'Visible text content for caching test '.repeat(15) + '</body></html>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/cache-test`;

  try {
    const browse1 = createBrowse({
      config: { browseCaps: { enabled: true } },
      browserContext: { account: 'u1', host: 'hostA' },
    });

    const browse2 = createBrowse({
      config: { browseCaps: { enabled: true } },
      browserContext: { account: 'u2', host: 'hostA' },
    });

    const browse3 = createBrowse({
      config: { browseCaps: { enabled: true } },
      browserContext: { account: 'u1', host: 'hostB' },
    });

    // 1. First fetch for context (u1, hostA) hits HTTP server
    const r1 = await browse1.readText(url);
    assert.equal(r1.ok, true);
    assert.equal(requestCount, 1, 'first readText must make an HTTP request');

    // 2. Second fetch for same context (u1, hostA) hits cache, no HTTP request
    const r1Cache = await browse1.readText(url);
    assert.equal(r1Cache.ok, true);
    assert.equal(requestCount, 1, 'repeated readText on same context must hit cache');

    // 3. Fetch for different account (u2, hostA) must miss cache
    const r2 = await browse2.readText(url);
    assert.equal(r2.ok, true);
    assert.equal(requestCount, 2, 'readText on different account must not reuse cache');

    // 4. Fetch for different host (u1, hostB) must miss cache
    const r3 = await browse3.readText(url);
    assert.equal(r3.ok, true);
    assert.equal(requestCount, 3, 'readText on different host must not reuse cache');
  } finally {
    server.close();
  }
});

test('report.build session receives routing context and passes context to spawn', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-report-route-'));
  const logFile = path.join(dir, 'argv.json');
  const fakeBin = path.join(dir, 'fake-aside');

  const script = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) {
  console.log('1.26.0');
  process.exit(0);
}
writeFileSync('${logFile}', JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({
  type: 'final',
  items: [{ jobId: 'j000', url: 'http://loopback', ok: true }],
  partial: [],
  leakedUrls: []
}));
console.log('[ok | 5ms]');
`;

  writeFileSync(fakeBin, script, { mode: 0o755 });

  const report = createReport({
    config: {
      browseCaps: { enabled: true },
      asidePath: fakeBin,
    },
    assertInside: (p) => p,
    browserContext: { account: 'u9', host: 'local' },
  });

  try {
    await report.build({ items: [], outFile: path.join(dir, 'out.pdf') });
  } catch (_) {
    // Expected post-spawn verification error since fakeBin produces mock output
  }

  assert.ok(existsSync(logFile), 'report.build must spawn the Aside binary');
  const recordedArgs = JSON.parse(readFileSync(logFile, 'utf8'));

  const replIdx = recordedArgs.indexOf('repl');
  assert.notEqual(replIdx, -1, 'argv must contain "repl"');

  const acctIdx = recordedArgs.indexOf('--account');
  const hostIdx = recordedArgs.indexOf('--host');

  assert.notEqual(acctIdx, -1, 'report session spawn argv must contain "--account"');
  assert.equal(recordedArgs[acctIdx + 1], 'u9', '--account value must be u9');
  assert.ok(acctIdx < replIdx, '--account must appear before "repl"');

  assert.notEqual(hostIdx, -1, 'report session spawn argv must contain "--host"');
  assert.equal(recordedArgs[hostIdx + 1], 'local', '--host value must be local for artifact materialization');
  assert.ok(hostIdx < replIdx, '--host must appear before "repl"');
});

test('maxResultBytes small envelope budget upheld despite browserContext metadata', () => {
  const smallBudget = 256;
  const res = spawnSync(
    process.execPath,
    [cli, '--account', 'u99', '--host', 'sample-host', '--code', 'return "x".repeat(500)'],
    {
      encoding: 'utf8',
      env: { ...process.env, CODEMODE_OUTPUT_BYTES: String(smallBudget) },
    },
  );
  assert.equal(res.status, 0, `CLI failed: ${res.stderr || res.stdout}`);
  const stdoutBytes = Buffer.byteLength(res.stdout);
  assert.ok(
    stdoutBytes <= smallBudget,
    `output bytes (${stdoutBytes}) exceeded small maxResultBytes budget (${smallBudget})`,
  );
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.truncated, true);
});

test('guest code equal to an administrative flag cannot select an administrative mode', () => {
  for (const code of ['--doctor', '--install-mcp', '--enable-browse', '--config', '--cwd']) {
    const child = spawnSync(process.execPath, [cli, '--code', code], { encoding: 'utf8', env: { ...process.env, CODEMODE_IGNORE_REPO_CONFIG: '1' } });
    const out = JSON.parse(child.stdout);
    assert.equal(child.status, 1);
    assert.equal(out.ok, false);
    assert.ok(out.browserContext, 'must reach guest execution, not administrative mode');
    assert.equal(out.registered, undefined);
  }
});
