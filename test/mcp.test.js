// AC 1, 2, 4a, 4b, 10 — black-box NDJSON handshake against the real server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');

function fixtureConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-mcp-'));
  const cfg = path.join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ roots: [dir] }));
  return { dir, cfg };
}

function startServer(cfg) {
  const child = spawn(process.execPath, [SERVER, '--config', cfg], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = new Map();
  const rawBefore = { seen: '' };
  let firstLineSeen = false;
  child.stdout.on('data', (d) => {
    buf += d;
    if (!firstLineSeen) rawBefore.seen += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      firstLineSeen = true;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  let nextId = 1;
  const call = (method, params, ms = 15000) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    setTimeout(() => reject(new Error('timeout ' + method)), ms);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { child, call, notify, rawBefore };
}

test('AC1/AC10: initialize purity, tools/list, ping', async () => {
  const { cfg } = fixtureConfig();
  const { child, call, rawBefore } = startServer(cfg);
  const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'aside-codemode');
  const firstLine = rawBefore.seen.split('\n')[0];
  assert.equal(JSON.parse(firstLine).result.serverInfo.name, 'aside-codemode', 'stdout first line IS the initialize response — zero banner bytes');
  const list = await call('tools/list', {});
  assert.deepEqual(list.result.tools.map((t) => t.name), ['execute_code']);
  const ping = await call('ping', {});
  assert.deepEqual(ping.result, {});
  child.stdin.end();
});

test('AC2: execute_code returns 2 for 1+1', async () => {
  const { cfg } = fixtureConfig();
  const { child, call } = startServer(cfg);
  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  const r = await call('tools/call', { name: 'execute_code', arguments: { code: 'return 1 + 1;' } });
  const out = JSON.parse(r.result.content[0].text);
  assert.equal(out.ok, true);
  assert.equal(out.result, 2);
  child.stdin.end();
});

test('AC4a: notifications/cancelled leaves the server responsive', async () => {
  const { cfg } = fixtureConfig();
  const { child, call, notify } = startServer(cfg);
  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  const slow = call('tools/call', { name: 'execute_code', arguments: { code: 'return 7;' } }).catch(() => null);
  notify('notifications/cancelled', { requestId: 2, reason: 'test' });
  await slow;
  const list = await call('tools/list', {});
  assert.deepEqual(list.result.tools.map((t) => t.name), ['execute_code']);
  child.stdin.end();
});

test('AC4b: stdin close exits the server with code 0', async () => {
  const { cfg } = fixtureConfig();
  const { child } = startServer(cfg);
  const code = await new Promise((resolve) => {
    child.on('exit', resolve);
    child.stdin.end();
  });
  assert.equal(code, 0);
});
