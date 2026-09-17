// The command that removes the last manual step from the MCP install.
//
// Nothing here talks to a daemon: run() is injected, because a test that needed Aside
// installed would be skipped on CI and would therefore never guard anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderActivationScript, planActivation, activateMcp,
  normalizedServerEntry, normalizeAccount, DISCOVERY_PROMPT,
} from '../src/activate.js';

const entry = normalizedServerEntry({ execPath: '/opt/node/bin/node', repoRoot: '/Users/someone/aside-codemode' });

function replOk(extra = {}) {
  return JSON.stringify({ ok: true, wrote: 'aside-codemode', servers: ['aside-codemode'], version: 0, inventories: [], ...extra });
}

test('the entry names this installation, not a guess about where it lives', () => {
  assert.equal(entry.transport, 'stdio');
  assert.equal(entry.enabled, true);
  assert.equal(entry.command, '/opt/node/bin/node');
  assert.match(entry.args[0], /server\.js$/);
  assert.equal(entry.args[1], '--config');
});

test('the script sets the mcp key and omits exactly the two keys that reset discovery', () => {
  const script = renderActivationScript({ server: 'aside-codemode', entry });
  assert.match(script, /aside\.settings\.set\("mcp", \{ servers \}\)/);
  // The value handed to set() is { servers } and nothing else. Naming either key here -
  // even as 0 - was measured NOT to queue discovery; only absence does.
  const setCall = script.slice(script.indexOf('servers[NAME] = ENTRY'));
  assert.ok(!setCall.includes('toolInventoryMigrationVersion = '), setCall);
  assert.ok(!/set\("mcp", \{ servers, /.test(script));
  assert.ok(script.includes(JSON.stringify(entry)));
});

test('the script decides about other servers inside the daemon, where settings are current', () => {
  const script = renderActivationScript({ server: 'aside-codemode', entry });
  assert.match(script, /const FORCE = false;/);
  assert.match(script, /atRisk/);
  assert.match(script, /at-risk-servers/);
  assert.match(renderActivationScript({ server: 'aside-codemode', entry, force: true }), /const FORCE = true;/);
});

test('the plan is the repl write and then one session, in that order', () => {
  const plan = planActivation({ account: 'u1', server: 'aside-codemode', entry });
  assert.deepEqual(plan.map((s) => s.step), ['settings-set', 'discovery-session']);
  assert.deepEqual(plan[0].args.slice(0, 3), ['--account', 'u1', 'repl']);
  assert.deepEqual(plan[1].args, ['--account', 'u1', 'exec', DISCOVERY_PROMPT]);
  const noAccount = planActivation({ server: 'aside-codemode', entry });
  assert.equal(noAccount[0].args[0], 'repl');
});

test('activation is reported from the cached inventory, not from having asked', async () => {
  const calls = [];
  const r = await activateMcp({
    entry,
    account: 'u1',
    run: async (cmd, args) => { calls.push([cmd, args.at(-1)]); return { code: 0, stdout: replOk(), stderr: '' }; },
    readInventory: () => ['execute_code'],
  });
  assert.equal(r.ok, true);
  assert.equal(r.registered, true);
  assert.equal(r.activated, true);
  assert.equal(r.discoveryRan, true);
  assert.deepEqual(r.tools, ['execute_code']);
  assert.deepEqual(calls.map((c) => c[1]).slice(1), [DISCOVERY_PROMPT]);
});

test('a discovery run that cached nothing is not reported as activated', async () => {
  const r = await activateMcp({
    entry,
    run: async () => ({ code: 0, stdout: replOk(), stderr: '' }),
    readInventory: () => [],
  });
  assert.equal(r.activated, false);
  assert.equal(r.ok, false);
  assert.match(r.next, /cached no tools/);
});

test("another enabled server stops the write and the session never runs", async () => {
  let runs = 0;
  const r = await activateMcp({
    entry,
    run: async () => {
      runs += 1;
      return { code: 0, stdout: JSON.stringify({ ok: false, reason: 'at-risk-servers', atRisk: ['other'], cached: ['other'] }), stderr: '' };
    },
    readInventory: () => ['execute_code'],
  });
  assert.equal(runs, 1);
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.atRisk, ['other']);
  assert.equal(r.activated, false);
});

test('a missing aside CLI is reported as that, not as a failed activation', async () => {
  const r = await activateMcp({
    entry,
    run: async () => ({ code: null, stdout: '', stderr: '', cliMissing: true }),
    readInventory: () => [],
  });
  assert.equal(r.ok, false);
  assert.equal(r.cliMissing, true);
  assert.match(r.error, /aside repl failed/);
});

test("aside's own timing line does not hide the result it printed", async () => {
  const r = await activateMcp({
    entry,
    run: async () => ({ code: 0, stdout: replOk() + '\n\u001b[2m[ok | 20ms]\u001b[0m\n', stderr: '' }),
    readInventory: () => ['execute_code'],
  });
  assert.equal(r.ok, true);
  assert.equal(r.steps[0].parsed.wrote, 'aside-codemode');
});

test('--no-discovery registers and says so instead of claiming an inventory', async () => {
  let runs = 0;
  const r = await activateMcp({
    entry,
    discover: false,
    run: async () => { runs += 1; return { code: 0, stdout: replOk(), stderr: '' }; },
    readInventory: () => { throw new Error('must not be read'); },
  });
  assert.equal(runs, 1);
  assert.equal(r.registered, true);
  assert.equal(r.activated, false);
  assert.equal(r.discoveryRan, false);
  assert.match(r.next, /Start any Aside session/);
});

test('an account id is accepted in either spelling the user has', () => {
  assert.equal(normalizeAccount('1'), 'u1');
  assert.equal(normalizeAccount('u2'), 'u2');
  assert.equal(normalizeAccount(3), 'u3');
});
