import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSearch } from '../src/host/search.js';
import { makeRootGuard } from '../src/paths.js';
import { createRgRunner, createRgResolver } from '../src/rg.js';
import { runStream } from '../src/rg-stream.js';
function fixture() {
  const root=mkdtempSync(path.join(tmpdir(),'codemode-search-edge-'));
  const search=createSearch({assertInside:makeRootGuard([root]),rgRunner:createRgRunner(createRgResolver({})),caps:{files:5000,content:500}});
  return {root,search};
}

test('adjacent matches appear in each other\'s context',async()=>{
 const {root,search}=fixture();
 writeFileSync(path.join(root,'a.txt'),'first\nNEEDLE A\nNEEDLE B\nlast\n');
 const hits=await search.content({path:root,query:'NEEDLE',context:1});
 assert.deepEqual(hits[0].context.after,[{line:3,text:'NEEDLE B'}]);
 assert.deepEqual(hits[1].context.before,[{line:2,text:'NEEDLE A'}]);
});

test('scope exposes a file-size exclusion instead of an unexplained complete count',async()=>{
 const {root,search}=fixture();
 writeFileSync(path.join(root,'a.txt'),'NEEDLE\n');
 const result=await search.count({path:root,query:'NEEDLE',maxFilesize:'1K',ignoreCase:true});
 assert.equal(result.scope.maxFilesize,'1K');
 assert.equal(result.scope.ignoreCase,true);
});

test('an abort signal terminates an already running search child',async()=>{
 const controller=new AbortController();
 const result=runStream(process.execPath,['-e','console.log("ready");setInterval(()=>{},1000)'],{
   max:10, timeoutMs:1500, signal:controller.signal,
   onLine:()=>{controller.abort();return true;},
 });
 await assert.rejects(result,/abort|cancel/i);
});

// A literal '..notes' component is not a parent traversal.
test('root guard accepts dot-prefixed filenames that are not parent components',()=>{
 const {root}=fixture();
 writeFileSync(path.join(root,'..notes'),'kept');
 const guard=makeRootGuard([root]);
 assert.ok(guard(path.join(root,'..notes')).endsWith(path.sep+'..notes'));
});
