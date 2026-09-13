import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRootGuard } from '../src/paths.js';
import { createFs } from '../src/host/fs.js';
import { createApplyPatch } from '../src/host/patch.js';

function fixture(t) {
  const root=mkdtempSync(path.join(os.tmpdir(),'codemode-boundary-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const fs=createFs({assertInside:makeRootGuard([root],{cwd:root})});
  return {root,fs};
}

test('paged reads decode a UTF-8 character split across the 64KiB chunk boundary', async t=>{
  const {root,fs}=fixture(t);
  const line='a'.repeat(65535)+'한';
  writeFileSync(path.join(root,'utf8.txt'),line+'\nsecond\n');
  const text=await fs.read_file({path:'utf8.txt',offset:1,limit:1});
  assert.equal(text,line);
});

test('streamed grep matches a UTF-8 character split across a chunk boundary', async t=>{
  const {root,fs}=fixture(t);
  writeFileSync(path.join(root,'utf8.txt'),'a'.repeat(65535)+'한\n');
  const hits=await fs.grepFile('utf8.txt','한$');
  assert.equal(hits.length,1);
  assert.ok(hits[0].text.endsWith('한'));
});

test('a single oversized line is refused instead of accumulating unbounded carry', async t=>{
  const {root,fs}=fixture(t);
  writeFileSync(path.join(root,'long.txt'),'x'.repeat(262145));
  await assert.rejects(fs.read_file({path:'long.txt',offset:1,limit:1}),/line|bytes|large|exceed/i);
});

test('End of File requires an actual EOF anchor, not merely the last match in the middle', async t=>{
  const {root,fs}=fixture(t);
  const original='head\nneedle\ntrailing\n';
  writeFileSync(path.join(root,'doc.txt'),original);
  const patch=createApplyPatch({write_file:fs.write_file,edit_file:fs.edit_file});
  await assert.rejects(patch('*** Begin Patch\n*** Update File: doc.txt\n@@\n-needle\n+changed\n*** End of File\n*** End Patch'),/EOF|end of file/i);
  assert.equal(readFileSync(path.join(root,'doc.txt'),'utf8'),original);
});

test('a valid long line is not rejected because the next chunk also contains other lines', async t=>{
  const {root,fs}=fixture(t);
  writeFileSync(path.join(root,'aligned.txt'),'x\n'+'z'.repeat(262144)+'\nend\n');
  const text=await fs.read_file({path:'aligned.txt',offset:2,limit:1});
  assert.equal(Buffer.byteLength(text),262144);
});

test('a page of many small lines has a total byte budget', async t=>{
  const {root,fs}=fixture(t);
  writeFileSync(path.join(root,'many.txt'),('x'.repeat(2000)+'\n').repeat(200));
  await assert.rejects(fs.read_file({path:'many.txt',offset:1,limit:200}),/page|budget|bytes|exceed/i);
});

test('cancelled reads and grep do not start another host traversal', async t=>{
  const {root}=fixture(t);const controller=new AbortController();controller.abort();
  writeFileSync(path.join(root,'doc.txt'),'needle\n');
  const fs=createFs({assertInside:makeRootGuard([root],{cwd:root}),signal:controller.signal});
  await assert.rejects(fs.read_file({path:'doc.txt',offset:1,limit:1}),/abort|cancel/i);
  await assert.rejects(fs.grepFile('doc.txt','needle'),/abort|cancel/i);
});
