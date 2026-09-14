// --code-file and stdin exist because --code '<js>' is a quoting trap: guest code carries
// its own quotes, and a url closes the agent's outer quote early. In bash that HANGS
// waiting for the missing quote; in PowerShell it mangles into a parse error. Both were
// observed from real Aside agent runs on 2026-09-14.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'codemode.mjs');
const run = (args, input) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', input }));

// The exact shape that breaks a shell: single quotes inside the code.
const QUOTED = "const u = ['https://example.com']; return { n: u.length, first: u[0] };";

test('--code-file runs a script whose own quotes would have broken a shell', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-codefile-'));
  const f = path.join(dir, 'job.js');
  writeFileSync(f, QUOTED);
  const out = run(['--code-file', f]);
  assert.equal(out.ok, true);
  assert.equal(out.result.n, 1);
  assert.equal(out.result.first, 'https://example.com');
});

test('--code - reads the same script from stdin', () => {
  const out = run(['--code', '-'], QUOTED);
  assert.equal(out.ok, true);
  assert.equal(out.result.first, 'https://example.com');
});

test('a missing --code-file fails with a clear message, not a stack trace', () => {
  try {
    run(['--code-file', path.join(tmpdir(), 'definitely-not-here-12345.js')]);
    assert.fail('should have exited non-zero');
  } catch (e) {
    const text = String(e.stdout || '') + String(e.stderr || '');
    assert.match(text, /--code-file could not be read/);
    assert.ok(!/at Object\./.test(text), 'a raw stack trace is not an error message');
  }
});

test('an empty script is refused rather than silently returning nothing', () => {
  for (const args of [['--code', '   '], ['--code-file', (() => { const d = mkdtempSync(path.join(tmpdir(), 'codemode-empty-')); const f = path.join(d, 'e.js'); writeFileSync(f, '  \n'); return f; })()]]) {
    try { run(args); assert.fail('should have exited non-zero'); }
    catch (e) { assert.match(String(e.stdout || '') + String(e.stderr || ''), /usage:/); }
  }
});

test('the usage text names the two quoting-safe forms', () => {
  try { run([]); assert.fail('should have exited non-zero'); }
  catch (e) {
    const text = String(e.stdout || '') + String(e.stderr || '');
    assert.match(text, /--code-file <path>/);
    assert.match(text, /--code - < script\.js/);
  }
});

test('every browse namespace is discoverable through actions', () => {
  // An agent's path is find -> describe -> check. browse.exec used to answer
  // 'unknown action' while the function worked, so the shape was undiscoverable.
  const out = run(['--code', "return { find: actions.find('browse').map(a => a.path), sig: actions.describe('browse.exec').signature, chk: actions.check('browse.exec', { urls: ['https://x.test'] }).ok };"]);
  assert.ok(out.result.find.includes('browse.exec'));
  assert.ok(out.result.find.includes('browse.captureMany'));
  assert.match(out.result.sig, /browse\.exec\(\{ urls/);
  assert.equal(out.result.chk, true);
});

test('report, api and recipes are discoverable too', () => {
  const out = run(['--code', "return actions.list().map(a => a.path).filter(p => /^(report|api|recipes)\\./.test(p));"]);
  for (const p of ['report.build', 'api.batch', 'recipes.run']) {
    assert.ok(out.result.includes(p), p + ' must be discoverable');
  }
});
