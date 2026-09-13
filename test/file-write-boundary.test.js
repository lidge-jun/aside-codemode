import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFs } from '../src/host/fs.js';
import { makeRootGuard } from '../src/paths.js';

function fixture(t) {
  const root=mkdtempSync(path.join(os.tmpdir(),'codemode-write-boundary-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,fs:createFs({assertInside:makeRootGuard([root],{cwd:root})})};
}

test('a valid long filename can be atomically edited without growing its temporary name', async t=>{
  const {root,fs}=fixture(t);const name='x'.repeat(220)+'.txt';
  writeFileSync(path.join(root,name),'before',{mode:0o600});
  await fs.edit_file({path:name,edits:[{oldText:'before',newText:'after'}]});
  assert.equal(readFileSync(path.join(root,name),'utf8'),'after');
  assert.deepEqual(readdirSync(root),[name]);
  if(process.platform!=='win32')assert.equal(statSync(path.join(root,name)).mode&0o777,0o600);
});

test('an aborted write neither changes the original nor leaves staging files', async t=>{
  const {root}=fixture(t);const signal=AbortSignal.abort();
  writeFileSync(path.join(root,'doc.txt'),'original');
  const fs=createFs({assertInside:makeRootGuard([root],{cwd:root}),signal});
  await assert.rejects(fs.write('doc.txt','replacement'),/abort|cancel/i);
  assert.equal(readFileSync(path.join(root,'doc.txt'),'utf8'),'original');
  assert.deepEqual(readdirSync(root),['doc.txt']);
});
