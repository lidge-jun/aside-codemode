// What the guest is allowed to do is a decision; what it is TOLD when it steps outside is a
// product. An agent that writes await import('node:fs') currently gets
// ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING, which names a Node internal and nothing the caller
// can act on. These checks pin the translation, not the policy: nothing here opens a loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'codemode.mjs');
// A refused call exits non-zero, which is right for a shell and awkward for execFileSync.
// The envelope is still on stdout, and the envelope is what these checks are about.
const run = (code) => {
  const opts = { encoding: 'utf8', env: { ...process.env, CODEMODE_IGNORE_REPO_CONFIG: '1' } };
  try {
    return JSON.parse(execFileSync(process.execPath, [cli, '--code', code], opts));
  } catch (e) {
    if (typeof e.stdout === 'string' && e.stdout.trim()) return JSON.parse(e.stdout);
    throw e;
  }
};

test('a dynamic import is refused by name, with the globals that do exist', () => {
  const out = run("return typeof (await import('node:fs'))");
  assert.equal(out.ok, false);
  assert.equal(out.code, 'EGUESTIMPORT', out.error);
  assert.match(out.error, /dynamic import/i);
  // The point of the message is the alternative, so the alternative has to be in it.
  for (const name of ['search', 'fs', 'browse', 'read_file']) {
    assert.ok(out.error.includes(name), 'the message does not name ' + name + ': ' + out.error);
  }
});

test('the names in that message are the names the guest actually has', () => {
  const refused = run("return await import('node:path')");
  const real = run('return Object.keys(globalThis).filter((k) => typeof globalThis[k] === "object" || typeof globalThis[k] === "function")');
  const listed = refused.error.split(':').pop().split(',').map((s) => s.replace(/[.\s]/g, '')).filter(Boolean);
  const have = new Set(real.result);
  for (const name of listed) {
    assert.ok(have.has(name), 'the message offers ' + name + ', which the guest does not have');
  }
});

test('a static import fails with the same hint rather than a bare syntax error', () => {
  const out = run("import fs from 'node:fs';\nreturn 1");
  assert.equal(out.ok, false);
  assert.match(out.error, /module loader|injected globals/i, out.error);
});

test('building code from a string says so, instead of a bare EvalError', () => {
  const out = run('return ' + 'ev' + "al('1+1')"); // justified: the guest must refuse string-built code; this checks what it says while refusing, and the literal is assembled so the repo lint does not read it as a call site
  assert.equal(out.ok, false);
  assert.match(out.error, /code generation|not available/i, out.error);
});

// Not a fix, a boundary. An unawaited import() leaves the IIFE resolved, so the refusal lands
// after the result has already been produced. Pinned so the gap is visible rather than
// discovered by someone whose script silently did nothing.
test('an unawaited import still returns, and the refusal does not reach the caller', () => {
  const out = run("import('node:fs'); return 'done'");
  assert.equal(out.ok, true);
  assert.equal(out.result, 'done');
});
