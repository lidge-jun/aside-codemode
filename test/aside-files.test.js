import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRootGuard } from '../src/paths.js';
import { createFs } from '../src/host/fs.js';
import { createActions } from '../src/host/actions.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');

function host() {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-aside-'));
  const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }) });
  return { root, fs };
}

test('read_file returns the whole small file', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'a.txt'), 'hello');
  assert.equal(await fs.read_file({ path: 'a.txt' }), 'hello');
});

test('read_file offset/limit are 1-indexed lines', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'a.txt'), 'a\nb\nc');
  assert.equal(await fs.read_file({ path: 'a.txt', offset: 2, limit: 1 }), 'b');
});

test('read_file rejects non-positive offset', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'a.txt'), 'a');
  await assert.rejects(fs.read_file({ path: 'a.txt', offset: 0 }), /positive integer/);
});

test('write_file is create-only', async () => {
  const { root, fs } = host();
  await fs.write_file({ file_path: 'n.txt', content: 'one' });
  await assert.rejects(fs.write_file({ file_path: 'n.txt', content: 'two' }), /already exists/);
  assert.equal(await fs.read_file({ path: 'n.txt' }), 'one');
});

test('edit_file unique replacement', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'e.txt'), 'alpha beta');
  const out = await fs.edit_file({ path: 'e.txt', edits: [{ oldText: 'beta', newText: 'gamma' }] });
  assert.equal(out.replacements, 1);
  assert.equal(await fs.read_file({ path: 'e.txt' }), 'alpha gamma');
});

test('edit_file duplicate oldText throws', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'e.txt'), 'xx xx');
  await assert.rejects(
    fs.edit_file({ path: 'e.txt', edits: [{ oldText: 'xx', newText: 'y' }] }),
    /not unique/,
  );
});

test('edit_file empty edits without appendText throws', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'e.txt'), 'x');
  await assert.rejects(fs.edit_file({ path: 'e.txt', edits: [] }), /appendText/);
});

test('edit_file appendText only', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'e.txt'), 'x');
  await fs.edit_file({ path: 'e.txt', appendText: 'y' });
  assert.equal(await fs.read_file({ path: 'e.txt' }), 'xy');
});

test('read_file on a directory throws', async () => {
  const { root, fs } = host();
  mkdirSync(path.join(root, 'd'));
  await assert.rejects(fs.read_file({ path: 'd' }), /directory/);
});

test('write_file missing parent throws', async () => {
  const { fs } = host();
  await assert.rejects(fs.write_file({ file_path: 'nope/a.txt', content: 'x' }), /ENOENT|no such file/i);
});

test('edit_file overlapping edits throw', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'e.txt'), 'abcdef');
  await assert.rejects(
    fs.edit_file({
      path: 'e.txt',
      edits: [
        { oldText: 'abcd', newText: '1' },
        { oldText: 'cdef', newText: '2' },
      ],
    }),
    /overlapping/,
  );
});

test('read_file unpaged over 262144 bytes throws', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(262145));
  await assert.rejects(fs.read_file({ path: 'big.txt' }), /262144/);
});

test('CLI guest read_file honors --cwd', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-aside-cli-'));
  writeFileSync(path.join(root, 'x'), 'via-cli');
  const r = spawnSync(process.execPath, [cli, '--cwd', root, '--code', "return await read_file({path:'x'})"], {
    encoding: 'utf8',
    env: { ...process.env, CODEMODE_ROOTS: root },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).result, 'via-cli');
});

test('actions catalog includes Aside file names and keeps deprecated fs rows', () => {
  const actions = createActions();
  const paths = actions.list().map((a) => a.path);
  assert.ok(paths.includes('read_file'));
  assert.ok(paths.includes('write_file'));
  assert.ok(paths.includes('edit_file'));
  assert.ok(paths.includes('fs.read'));
  assert.ok(paths.includes('fs.write'));
  assert.match(actions.describe('fs.read').notes, /deprecated/);
  assert.equal(actions.find('edit')[0].path, 'edit_file');
});

test('Node and Aside REPL file names teach the guest equivalents', () => {
  const { fs } = host();
  const expected = {
    readFile: ['fs.read(path)', 'read_file({path, offset, limit})'],
    writeFile: ['write_file({file_path, content})', 'fs.write(path, content)'],
    readdir: ['fs.list(path)'],
    appendFile: ['edit_file({path, appendText})'],
    existsSync: ['await fs.exists(path)'],
    readFileSync: ['await fs.read(path)'],
    writeFileSync: ['await fs.write(path, content)'],
    statSync: ['await fs.stat(path)'],
    unlink: ['guest cannot delete files'],
    rm: ['guest cannot delete files'],
  };
  for (const [name, calls] of Object.entries(expected)) {
    assert.throws(() => fs[name]('/p', 'x'), (error) => (
      error.code === 'EGUESTNAME' && calls.every((call) => error.message.includes(call))
    ));
  }
});

test('teaching file-name stubs do not change the real fs surface or actions catalog', () => {
  const { fs } = host();
  assert.deepEqual(Object.keys(fs), [
    'read', 'readMany', 'grepFile', 'write', 'mkdir', 'stat', 'exists', 'list',
    'read_file', 'write_file', 'edit_file',
  ]);
  for (const name of [
    'readFile', 'writeFile', 'readdir', 'appendFile', 'existsSync',
    'readFileSync', 'writeFileSync', 'statSync', 'unlink', 'rm',
  ]) {
    assert.equal(typeof fs[name], 'function');
    assert.equal(createActions().list().some((entry) => entry.path === `fs.${name}`), false);
  }
});
