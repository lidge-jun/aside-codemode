import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFs } from '../src/host/fs.js';
import { makeRootGuard } from '../src/paths.js';
import { createApplyPatch } from '../src/host/patch.js';
import { acquireFileLock, lockPathFor } from '../src/host/file-lock.js';
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-file-edge-'));
  const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }) });
  return { root, fs, patch: createApplyPatch({ write_file: fs.write_file, edit_file: fs.edit_file }) };
}

test('paged read preserves UTF-8 across the 64KiB chunk boundary', async () => {
  const { root, fs } = fixture();
  const line = 'a'.repeat(65535) + '한글';
  writeFileSync(path.join(root,'unicode.txt'), line+'\nlast');
  assert.equal(await fs.read_file({path:'unicode.txt', offset:1, limit:1}), line);
});

test('grep does not miss a multibyte match split between read chunks', async () => {
  const { root, fs } = fixture();
  writeFileSync(path.join(root,'unicode.txt'), 'a'.repeat(65535)+'한글\n');
  const hits = await fs.grepFile('unicode.txt','한글');
  assert.equal(hits.length,1);
  assert.equal(hits[0].line,1);
});

test('byte-capped read does not manufacture replacement characters at its boundary', async () => {
  const { root, fs } = fixture();
  writeFileSync(path.join(root,'unicode.txt'),'한글');
  const result = await fs.read('unicode.txt',{maxBytes:5});
  assert.doesNotMatch(result,/\uFFFD/);
  assert.match(result,/truncated/);
});

test('EOF patch marker refuses a match that is not actually at the end', async () => {
  const { root, fs, patch } = fixture();
  writeFileSync(path.join(root,'tail.txt'),'alpha\nremaining\n');
  await assert.rejects(patch('*** Begin Patch\n*** Update File: tail.txt\n@@\n-alpha\n+changed\n*** End of File\n*** End Patch'),/end|EOF|tail/i);
  assert.equal(await fs.read_file({path:'tail.txt'}),'alpha\nremaining\n');
});

test('anchorless update is rejected during parse before an earlier Add writes', async () => {
  const { root, patch } = fixture();
  writeFileSync(path.join(root,'old.txt'),'old');
  await assert.rejects(patch('*** Begin Patch\n*** Add File: first.txt\n+created\n*** Update File: old.txt\n@@\n+anchorless\n*** End Patch'),/anchor|oldText|context/i);
  assert.equal(existsSync(path.join(root,'first.txt')),false);
});

test('release never removes a replaced lock whose owner cannot be identified', async () => {
  const { root } = fixture();
  const target=path.join(root,'lock.txt');
  const release=await acquireFileLock(target);
  const lock=lockPathFor(target);
  writeFileSync(lock,'unknown replacement owner');
  try { await release(); assert.equal(existsSync(lock),true); }
  finally { if(existsSync(lock)) unlinkSync(lock); }
});

test('paged read keeps the trailing empty line from the original split-based API', async () => {
  const { root, fs } = fixture();
  writeFileSync(path.join(root,'last-line.txt'),'first\nsecond\n');
  assert.equal(await fs.read_file({path:'last-line.txt',offset:1}),'first\nsecond\n');
});

test('a valid near-limit line is not confused with the following line in its chunk', async () => {
  const { root, fs } = fixture();
  const first='x'.repeat(262143);
  writeFileSync(path.join(root,'large-line.txt'),first+'\ny\n');
  assert.equal(await fs.read_file({path:'large-line.txt',offset:1,limit:1}),first);
});

test('paged output refuses an excessive retained window instead of buffering the file', async () => {
  const { root, fs } = fixture();
  writeFileSync(path.join(root,'large-window.txt'),'short line\n'.repeat(30000));
  await assert.rejects(fs.read_file({path:'large-window.txt',offset:1}),/window|output|bytes|limit/i);
});

test('streamed grep refuses an oversized unterminated line', async () => {
  const { root, fs } = fixture();
  writeFileSync(path.join(root,'long-grep.txt'),'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(fs.grepFile('long-grep.txt','absent'),/line|bytes|limit/i);
});

test('a cancelled file scope does not start a read', async () => {
  const { root } = fixture();
  writeFileSync(path.join(root,'cancel.txt'),'keep');
  const controller=new AbortController(); controller.abort();
  const fs=createFs({assertInside:makeRootGuard([root],{cwd:root}),signal:controller.signal});
  await assert.rejects(fs.read_file({path:'cancel.txt'}),/abort/i);
});
