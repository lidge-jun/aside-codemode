import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeRootGuard } from '../src/paths.js';
import { createFs } from '../src/host/fs.js';
import { createApplyPatch } from '../src/host/patch.js';
import { runCode } from '../src/sandbox.js';

function host() {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-patch-line-'));
  const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }) });
  const apply_patch = createApplyPatch({ write_file: fs.write_file, edit_file: fs.edit_file });
  return { root, fs, apply_patch };
}

function updatePatch(file, bodyLines) {
  return ['*** Begin Patch', `*** Update File: ${file}`, '@@', ...bodyLines, '*** End Patch'].join('\n');
}

test('foobar substring hunk is refused and the file stays foobar', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'doc.txt', content: 'foobar' });
  await assert.rejects(apply_patch(updatePatch('doc.txt', ['-foo', '+bar'])), /not found/);
  assert.equal(readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'foobar');
});

test('delete-only -beta removes the line without leaving a blank', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'doc.txt', content: 'alpha\nbeta\ngamma\n' });
  assert.deepEqual(await apply_patch(updatePatch('doc.txt', ['-beta'])), {});
  assert.equal(readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'alpha\ngamma\n');
});

test('CRLF context hunk replaces beta and keeps CRLF', async () => {
  const { root, apply_patch } = host();
  writeFileSync(path.join(root, 'doc.txt'), 'alpha\r\nbeta\r\ngamma\r\n');
  assert.deepEqual(await apply_patch(updatePatch('doc.txt', [' alpha', '-beta', '+BETA'])), {});
  assert.equal(readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'alpha\r\nBETA\r\ngamma\r\n');
});

test('LF context hunk replaces beta and keeps LF', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'doc.txt', content: 'alpha\nbeta\ngamma\n' });
  assert.deepEqual(await apply_patch(updatePatch('doc.txt', [' alpha', '-beta', '+BETA'])), {});
  assert.equal(readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'alpha\nBETA\ngamma\n');
});

test('CRLF patch text applies to an LF file', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'doc.txt', content: 'alpha\nbeta\ngamma\n' });
  const patch = ['*** Begin Patch', '*** Update File: doc.txt', '@@', '-beta', '+BETA', '*** End Patch'].join('\r\n');
  assert.deepEqual(await apply_patch(patch), {});
  assert.equal(readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'alpha\nBETA\ngamma\n');
});

test('ambiguous dup without EOF is refused; EOF replaces the last line', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'amb.txt', content: 'dup\nmid\ndup' });
  await assert.rejects(
    apply_patch(['*** Begin Patch', '*** Update File: amb.txt', '@@', '-dup', '+X', '*** End Patch'].join('\n')),
    /not unique/,
  );
  assert.equal(readFileSync(path.join(root, 'amb.txt'), 'utf8'), 'dup\nmid\ndup');

  assert.deepEqual(
    await apply_patch(
      ['*** Begin Patch', '*** Update File: amb.txt', '@@', '-dup', '+LAST', '*** End of File', '*** End Patch'].join('\n'),
    ),
    {},
  );
  assert.equal(readFileSync(path.join(root, 'amb.txt'), 'utf8'), 'dup\nmid\nLAST');
});

test('guest apply_patch refuses the foobar substring hunk', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'doc.txt', content: 'foobar' });
  const patch = updatePatch('doc.txt', ['-foo', '+bar']);
  const out = await runCode(
    `return await apply_patch(${JSON.stringify(patch)})`,
    { timeoutMs: 5000, globals: { apply_patch }, maxResultBytes: 4096 },
  );
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'foobar');
});

test('mixed-EOL replace keeps each line EOL', async () => {
  const { root, apply_patch } = host();
  writeFileSync(path.join(root, 'doc.txt'), 'alpha\r\nbeta\ngamma\r\n');
  assert.deepEqual(await apply_patch(updatePatch('doc.txt', [' alpha', '-beta', '+BETA', ' gamma'])), {});
  assert.equal(readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'alpha\r\nBETA\ngamma\r\n');
});

test('mixed-EOL delete with context does not give gamma beta\'s LF', async () => {
  const { root, apply_patch } = host();
  writeFileSync(path.join(root, 'doc.txt'), 'alpha\r\nbeta\ngamma\r\n');
  assert.deepEqual(await apply_patch(updatePatch('doc.txt', [' alpha', '-beta', ' gamma'])), {});
  assert.equal(readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'alpha\r\ngamma\r\n');
});

test('mixed-EOL insert takes the following old line EOL', async () => {
  const { root, apply_patch } = host();
  writeFileSync(path.join(root, 'doc.txt'), 'alpha\r\nbeta\n');
  assert.deepEqual(await apply_patch(updatePatch('doc.txt', [' alpha', '+NEW', ' beta'])), {});
  assert.equal(readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'alpha\r\nNEW\nbeta\n');
});
