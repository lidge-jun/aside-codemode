import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRgResolver, createRgRunner } from '../src/rg.js';
import { runStream } from '../src/rg-stream.js';

function fixture(t) {
  const root=mkdtempSync(path.join(os.tmpdir(),'codemode-search-boundary-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return root;
}

test('adjacent matches count as physical context lines for each other', async t=>{
  const root=fixture(t);
  writeFileSync(path.join(root,'lines.txt'),'before\nHIT one\nHIT two\nafter\n');
  const runner=createRgRunner(createRgResolver({}));
  const hits=await runner.content({path:root,query:'HIT',context:1});
  assert.equal(hits.length,2);
  assert.deepEqual(hits[0].context.after,[{line:3,text:'HIT two'}]);
  assert.deepEqual(hits[1].context.before,[{line:2,text:'HIT one'}]);
});

test('scope discloses filesize pruning and query modes that affect completeness', async t=>{
  const root=fixture(t);
  writeFileSync(path.join(root,'small.txt'),'needle\n');
  writeFileSync(path.join(root,'big.txt'),'needle'.repeat(300));
  const hits=await createRgRunner(createRgResolver({})).content({path:root,query:'needle',maxFilesize:'1K',fixedStrings:true,ignoreCase:true});
  assert.equal(hits.length,1);
  const scope=JSON.parse(JSON.stringify(hits)).scope;
  assert.equal(scope.maxFilesize,'1K');
  assert.equal(scope.fixedStrings,true);
  assert.equal(scope.ignoreCase,true);
  assert.equal(scope.query,'needle');
});

test('an already-cancelled search does not resolve or spawn a binary', async t=>{
  const root=fixture(t);const controller=new AbortController();controller.abort();
  let resolved=false;
  const runner=createRgRunner(async()=>{resolved=true;return await createRgResolver({})();},{signal:controller.signal});
  await assert.rejects(runner.files({path:root}),/abort|cancel/i);
  assert.equal(resolved,false);
});

test('cancelling an active stream kills its child instead of waiting for the rg deadline', async()=>{
  const controller=new AbortController();
  await assert.rejects(runStream(process.execPath,['-e',"process.stdout.write('ready\\n');setInterval(()=>{},1000)"],{
    signal:controller.signal,timeoutMs:300,max:10,
    onLine:()=>{controller.abort();return true;},
  }),e=>e.code==='ECANCELLED');
});
