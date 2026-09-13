import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function server(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-mcp-hardening-'));
  const config = path.join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({roots:[dir],maxResultBytes:1024}));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url)), '--config', config], {
    stdio: ['pipe','pipe','pipe'], env: {...process.env,CODEMODE_ROOTS:dir,CODEMODE_OUTPUT_BYTES:'1024'},
  });
  const messages = new Map(), waiters = new Map();
  let buffer = '';
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    let i;
    while ((i=buffer.indexOf('\n'))!==-1) {
      const row=buffer.slice(0,i);buffer=buffer.slice(i+1);
      if (!row.trim()) continue;
      const message=JSON.parse(row);messages.set(message.id,message);
      waiters.get(message.id)?.(message);
    }
  });
  t.after(async () => {
    child.kill('SIGKILL');
    await exited;
    rmSync(dir,{recursive:true,force:true});
  });
  const send = message => child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
  const read = id => messages.has(id) ? Promise.resolve(messages.get(id)) : new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error(`missing MCP response ${id}`)),2500);
    timer.unref();
    waiters.set(id,message=>{clearTimeout(timer);waiters.delete(id);resolve(message);});
  });
  return {child,send,read,exited};
}

test('MCP serves ping while an async guest loops, then returns its deadline error', {timeout:5000}, async t => {
  const {send,read}=server(t);
  send({id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}});
  await read(1);
  send({id:2,method:'tools/call',params:{name:'execute_code',arguments:{code:'await Promise.resolve(); for (;;) {}',timeoutMs:150}}});
  send({id:3,method:'ping'});
  assert.deepEqual((await read(3)).result,{});
  const message=await read(2);
  assert.equal(message.result.isError,true);
  const out=JSON.parse(message.result.content[0].text);
  assert.equal(out.ok,false);
  assert.match(out.error,/deadline|timed out/i);
});

test('MCP cancellation and stdin closure release a long-running worker', {timeout:5000}, async t => {
  const {child,send,read,exited}=server(t);
  send({id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}});
  await read(1);
  send({id:2,method:'tools/call',params:{name:'execute_code',arguments:{code:'await Promise.resolve(); for (;;) {}',timeoutMs:60000}}});
  send({method:'notifications/cancelled',params:{requestId:2}});
  send({id:3,method:'ping'});
  assert.deepEqual((await read(3)).result,{});
  child.stdin.end();
  assert.equal(await exited,0);
});
