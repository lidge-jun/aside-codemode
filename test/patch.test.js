import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRootGuard } from '../src/paths.js';
import { createFs } from '../src/host/fs.js';
import { createApplyPatch, parseApplyPatch } from '../src/host/patch.js';
import { createActions } from '../src/host/actions.js';
import { runCode } from '../src/sandbox.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');

function host() {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-patch-'));
  const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }) });
  const apply_patch = createApplyPatch({ write_file: fs.write_file, edit_file: fs.edit_file });
  return { root, fs, apply_patch };
}

function addPatch(name, body = 'hi') {
  return `*** Begin Patch\n*** Add File: ${name}\n+${body}\n*** End Patch`;
}

test('Add File then read back', async () => {
  const { fs, apply_patch } = host();
  assert.deepEqual(await apply_patch(addPatch('n.txt', 'hello')), {});
  assert.equal(await fs.read_file({ path: 'n.txt' }), 'hello');
});

test('Update File unique line', async () => {
  const { fs, apply_patch } = host();
  await fs.write_file({ file_path: 'e.txt', content: 'alpha beta' });
  const patch = [
    '*** Begin Patch',
    '*** Update File: e.txt',
    '@@',
    '-alpha beta',
    '+alpha gamma',
    '*** End Patch',
  ].join('\n');
  assert.deepEqual(await apply_patch(patch), {});
  assert.equal(await fs.read_file({ path: 'e.txt' }), 'alpha gamma');
});

test('Delete File throws; existing file unchanged', async () => {
  const { root, fs, apply_patch } = host();
  writeFileSync(path.join(root, 'keep.txt'), 'stay');
  const patch = '*** Begin Patch\n*** Delete File: keep.txt\n*** End Patch';
  await assert.rejects(apply_patch(patch), /delete\/move\/environment not supported/);
  assert.equal(await fs.read_file({ path: 'keep.txt' }), 'stay');
});

test('Missing Begin/End throws', async () => {
  assert.throws(() => parseApplyPatch('not a patch'), /Begin Patch \/ \*\*\* End Patch/);
});

test('runCode apply_patch returns {}', async () => {
  const { apply_patch } = host();
  const out = await runCode(
    `return await apply_patch(${JSON.stringify(addPatch('via-vm.txt', 'vm'))})`,
    { timeoutMs: 5000, globals: { apply_patch }, maxResultBytes: 4096 },
  );
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.result, {});
});

test('partial apply: first Add stays when second path is outside roots', async () => {
  const { root, fs, apply_patch } = host();
  const outside = path.join(tmpdir(), `codemode-outside-${Date.now()}.txt`);
  const patch = [
    '*** Begin Patch',
    '*** Add File: first.txt',
    '+kept',
    `*** Add File: ${outside}`,
    '+nope',
    '*** End Patch',
  ].join('\n');
  await assert.rejects(apply_patch(patch), /outside|root|refused|EROOT/i);
  assert.equal(await fs.read_file({ path: 'first.txt' }), 'kept');
  assert.equal(existsSync(outside), false);
  assert.equal(existsSync(path.join(root, path.basename(outside))), false);
});

test('Begin Patch extra suffix throws (exact marker)', () => {
  assert.throws(
    () => parseApplyPatch('*** Begin Patch extra\n*** Add File: x\n+y\n*** End Patch'),
    /exactly \*\*\* Begin Patch/,
  );
});

test('CLI --code apply_patch returns envelope result {}', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-patch-cli-'));
  const code = "return await apply_patch(`*** Begin Patch\\n*** Add File: n.txt\\n+hi\\n*** End Patch`)";
  const r = spawnSync(process.execPath, [cli, '--cwd', root, '--code', code], {
    encoding: 'utf8',
    env: { ...process.env, CODEMODE_ROOTS: root },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(r.stdout).result, {});
  assert.equal(readFileSync(path.join(root, 'n.txt'), 'utf8'), 'hi');
});

test('actions.find(patch) ranks apply_patch', () => {
  const actions = createActions();
  assert.equal(actions.find('patch')[0].path, 'apply_patch');
});

test('fenced Add File works', async () => {
  const { fs, apply_patch } = host();
  const fenced = '```\n' + addPatch('f.txt', 'in') + '\n```';
  await apply_patch(fenced);
  assert.equal(await fs.read_file({ path: 'f.txt' }), 'in');
});

test('empty apply_patch throws and writes nothing', async () => {
  const { root, apply_patch } = host();
  await assert.rejects(apply_patch(''), /freeform string required/);
  assert.equal(existsSync(path.join(root, 'n.txt')), false);
});
