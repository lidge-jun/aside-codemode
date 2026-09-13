// AC 3 — sandbox: timeout, console capture, output cap, blocked globals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCode } from '../src/sandbox.js';

const globals = { search: {}, fs: {}, actions: {} };

test('sync infinite loop hits the vm timeout', async () => {
  const out = await runCode('for (;;) {}', { timeoutMs: 1000, globals, maxResultBytes: 1024 });
  assert.equal(out.ok, false);
  assert.match(out.error, /timed out|deadline/i);
});

test('console output is captured, not printed', async () => {
  const out = await runCode("console.log('hello', 1); return 'x';", { timeoutMs: 5000, globals, maxResultBytes: 1024 });
  assert.equal(out.ok, true);
  assert.deepEqual(out.logs, ['[log] hello 1']);
  assert.equal(out.result, 'x');
});

test('result is capped with a truncated flag', async () => {
  const out = await runCode("return 'y'.repeat(5000);", { timeoutMs: 5000, globals, maxResultBytes: 100 });
  assert.equal(out.ok, true);
  assert.equal(out.truncated, true);
  assert.ok(String(out.result).length <= 100);
});

test('require, process and fetch are absent', async () => {
  const out = await runCode("return [typeof require, typeof process, typeof fetch];", { timeoutMs: 5000, globals, maxResultBytes: 1024 });
  assert.deepEqual(out.result, ['undefined', 'undefined', 'undefined']);
});

test('code generation is disabled (dynamic eval throws inside the vm)', async () => {
  // guest code resolves eval indirectly; codeGeneration.strings=false must reject it
  const out = await runCode("return globalThis['ev' + 'al']('1+1');", { timeoutMs: 5000, globals, maxResultBytes: 1024 });
  assert.equal(out.ok, false);
});
