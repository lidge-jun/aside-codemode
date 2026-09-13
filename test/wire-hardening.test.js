import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const server = fileURLToPath(new URL('../src/server.js', import.meta.url));
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-wire-'));
  writeFileSync(path.join(root, 'a.txt'), 'before\nNEEDLE\nafter\n');
  writeFileSync(path.join(root, 'b.txt'), 'NEEDLE\n');
  return root;
}
function call(root, code, bytes = 65536) {
  const r = spawnSync(process.execPath, [cli, '--cwd', root, '--timeout-ms', '3000', '--code', code], {
    encoding: 'utf8', timeout: 7000,
    env: { ...process.env, CODEMODE_ROOTS: root, CODEMODE_OUTPUT_BYTES: String(bytes) },
  });
  assert.equal(r.error, undefined, r.error?.message);
  return { ...r, out: JSON.parse(r.stdout) };
}

test('actual CLI preserves direct and nested search envelopes across worker RPC', () => {
  const r = call(fixture(), 'const hits = await search.content({path:".",query:"NEEDLE",max:1}); return {hits,count:await search.count({path:".",query:"NEEDLE"})};');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.result.hits.rows.length, 1);
  assert.equal(r.out.result.hits.truncated, true);
  assert.equal(r.out.result.hits.complete, false);
  assert.equal(r.out.result.count.matches, 2);
  assert.equal(r.out.result.count.complete, true);
});

test('CLI rejects unsupported follow before returning outside-root content', () => {
  const r = call(fixture(), 'return await search.content({path:".",query:"NEEDLE",followSymlinks:true});');
  assert.equal(r.status, 1);
  assert.equal(r.out.ok, false);
  assert.match(r.out.error, /follow|symlink|unsupported/i);
});

test('one CLI call reads and aggregates fifty synthetic files correctly', () => {
  const root = fixture();
  for (let i = 0; i < 50; i++) writeFileSync(path.join(root, `n${i}.dat`), String(i));
  const r = call(root, 'const files=await search.files({path:".",glob:"*.dat"}); const texts=await fs.readMany(files); return {files, count:texts.length, sum:texts.reduce((n,x)=>n+Number(x.text),0)};');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.result.count, 50);
  assert.equal(r.out.result.sum, 1225);
  assert.equal(r.out.result.files.complete, true);
});

test('actual stdout, including newline, obeys the configured total response cap', () => {
  const root = fixture();
  for (const code of ["return '한😀'.repeat(5000)", "console.log('x'.repeat(5000)); throw new Error('y'.repeat(5000))"]) {
    const r = call(root, code, 256);
    assert.ok(Buffer.byteLength(r.stdout) <= 256, String(Buffer.byteLength(r.stdout)));
  }
});

test('CLI patch failure retains prior application and reports its failed target', () => {
  const root = fixture();
  const patch = '*** Begin Patch\n*** Add File: first.txt\n+created\n*** Update File: missing.txt\n-no\n+yes\n*** End Patch';
  const r = call(root, `return await apply_patch(${JSON.stringify(patch)});`);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.out.applied.some(p => String(p).endsWith('first.txt')));
  assert.ok(String(r.out.failedFile).endsWith('missing.txt'));
  assert.match(readFileSync(path.join(root, 'first.txt'), 'utf8'), /^created\n?$/);
});

test('MCP cancels real guest work and remains responsive', async () => {
  const root = fixture();
  const child = spawn(process.execPath, [server], { env: { ...process.env, CODEMODE_ROOTS: root }, stdio: ['pipe','pipe','pipe'] });
  const messages = [];
  let buffer = '';
  const waiters = new Map();
  child.stderr.resume();
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line) continue;
      const msg = JSON.parse(line); messages.push(msg);
      const waiter = waiters.get(msg.id);
      if (waiter) { clearTimeout(waiter.timer); waiters.delete(msg.id); waiter.resolve(msg); }
    }
  });
  const send = msg => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const request = (id, method, params) => new Promise((resolve,reject) => {
    const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`MCP timeout ${method}`)); }, 4000);
    waiters.set(id,{resolve,reject,timer});send({id,method,params});
  });
  try {
    await request(1,'initialize',{ protocolVersion:'2024-11-05' });
    send({id:2,method:'tools/call',params:{name:'execute_code',arguments:{code:'await Promise.resolve(); for (;;) {}',timeoutMs:10000}}});
    await request(3,'ping',{});
    send({method:'notifications/cancelled',params:{requestId:2}});
    const result = await request(4,'tools/call',{name:'execute_code',arguments:{code:'return 42;'}});
    assert.equal(JSON.parse(result.result.content[0].text).result,42);
    assert.equal(messages.some(x=>x.id===2),false);
    const exit = new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('MCP did not exit after stdin closed')),4000);
      child.once('exit',code=>{clearTimeout(timer);resolve(code);});
    });
    child.stdin.end();
    assert.equal(await exit,0);
  } finally {
    for(const waiter of waiters.values()) clearTimeout(waiter.timer);
    child.kill();
  }
});
