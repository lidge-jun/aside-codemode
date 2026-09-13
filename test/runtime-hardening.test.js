import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runCode } from '../src/sandbox.js';
import { createActions } from '../src/host/actions.js';
import { loadConfig } from '../src/config.js';

const sandboxUrl = new URL('../src/sandbox.js', import.meta.url).href;
const cli = new URL('../src/cli.js', import.meta.url);
const options = { timeoutMs: 2000, globals: { search: {}, fs: {}, actions: {} }, maxResultBytes: 1024 };

for (const [name, code] of [
  ['async continuation', 'await Promise.resolve(); for (;;) {}'],
  ['serialization', 'return { toJSON() { for (;;) {} } }'],
]) {
  test(`watchdog stops ${name} without blocking its supervisor`, () => {
    const script = `import {runCode} from ${JSON.stringify(sandboxUrl)}; console.log(JSON.stringify(await runCode(${JSON.stringify(code)}, {timeoutMs:150,globals:{},maxResultBytes:1024})));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL' });
    assert.equal(r.error, undefined, 'external watchdog had to kill runCode: ' + r.error?.message);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).ok, false);
    assert.match(JSON.parse(r.stdout).error, /deadline|timed out/i);
  });
}

for (const code of [
  "return '한😀'.repeat(5000)",
  "return '\\n\\\"\\\\'.repeat(5000)",
  "console.log('한😀'.repeat(5000)); return 'ok'",
  "throw new Error('한😀'.repeat(5000))",
]) {
  test(`wire budget includes Unicode, JSON escapes, logs and errors: ${code.slice(0, 32)}`, async () => {
    const out = await runCode(code, options);
    assert.ok(Buffer.byteLength(JSON.stringify(out)) + 1 <= 1024);
    assert.doesNotMatch(JSON.stringify(out), /\uFFFD/);
  });
}

test('host closures work over RPC, and discovery stays synchronous', async () => {
  let calls = 0;
  const out = await runCode("const methods=actions.list('search'); return {value:await read_file({path:'fixture'}),methods:methods.map(x=>x.path)}", {
    ...options,
    globals: { actions: createActions(), read_file: async ({ path }) => { calls++; return path + '-data'; } },
  });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.value, 'fixture-data');
  assert.equal(out.result.methods.length, 3);
  assert.equal(calls, 1);
});

test('host errors retain structured patch progress', async () => {
  const out = await runCode('return await apply_patch("x")', {
    ...options,
    globals: { apply_patch: async () => { throw Object.assign(new Error('fixture failure'), { code: 'EFAULT', applied: ['a'], failedFile: 'b' }); } },
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'EFAULT');
  assert.deepEqual(out.applied, ['a']);
  assert.equal(out.failedFile, 'b');
});

test('invalid numeric settings fail instead of silently weakening limits', () => {
  for (const value of ['-1', '0', 'NaN', 'Infinity', '1.5']) {
    assert.throws(() => loadConfig([], { CODEMODE_TIMEOUT_MS: value }), /timeout|integer|range/i);
  }
  assert.throws(() => loadConfig([], { CODEMODE_OUTPUT_BYTES: '16' }), /bytes|integer|96/i);
});

test('CLI rejects malformed timeout instead of falling back to 30 seconds', () => {
  for (const value of ['-1', 'NaN', '0', '1.5']) {
    const r = spawnSync(process.execPath, [fileURLToPath(cli), '--timeout-ms', value, '--code', 'return 1'], { encoding: 'utf8', timeout: 3000 });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(JSON.parse(r.stdout).ok, false);
  }
});

test('an otherwise complete guest drains fire-and-forget host writes', async () => {
  let finished = false;
  const out = await runCode('write_file({}); return 1', {
    ...options,
    globals: { write_file: async () => { await new Promise(r => setImmediate(r)); finished = true; } },
  });
  assert.equal(out.ok, true, out.error);
  assert.equal(finished, true);
});

test('caller-supplied synchronous discovery is not replaced with a different registry', async () => {
  let calls = 0;
  const out = await runCode('return actions.answer() + await fs.value()', {
    ...options,
    globals: { actions: { answer: () => { calls++; return 31; } }, fs: { value: async () => 11 } },
  });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result, 42);
  assert.equal(calls, 1);
});

test('success clears the long deadline and permits natural process exit', () => {
  const script = `import {runCode} from ${JSON.stringify(sandboxUrl)}; console.log(JSON.stringify(await runCode('return 7',{timeoutMs:60000,maxResultBytes:1024,globals:{}})));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 3000 });
  assert.equal(r.error, undefined, r.error?.message);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).result, 7);
});

test('watchdog also supervises a thrown object with a looping message getter', () => {
  const code = 'throw { get message() { for (;;) {} } }';
  const script = `import {runCode} from ${JSON.stringify(sandboxUrl)}; console.log(JSON.stringify(await runCode(${JSON.stringify(code)},{timeoutMs:150,maxResultBytes:1024,globals:{}})));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 3000 });
  assert.equal(r.error, undefined, r.error?.message);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, false);
  assert.match(JSON.parse(r.stdout).error, /deadline|timed out/i);
});

test('cancellation reaches the per-execution host scope and prevents later writes', async () => {
  const controller = new AbortController();
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  let writes = 0;
  let cancelled = false;
  const running = runCode('await fs.wait(); await fs.touch()', {
    ...options, signal: controller.signal,
    globals: signal => ({ fs: {
      wait: () => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true });
        ready();
      }),
      touch: async () => { writes++; },
    } }),
  });
  await started;
  controller.abort();
  const out = await running;
  assert.equal(out.ok, false);
  assert.equal(out.code, 'ECANCELLED');
  assert.equal(cancelled, true);
  assert.equal(writes, 0);
  assert.equal(out.pendingHostCalls, undefined);
});
