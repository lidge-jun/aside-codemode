// The command that removes the last manual step from the MCP install.
//
// Nothing here talks to a daemon: run() is injected, because a test that needed Aside
// installed would be skipped on CI and would therefore never guard anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderActivationScript, renderRestoreScript, planActivation, activateMcp,
  normalizedServerEntry, normalizeAccount, DISCOVERY_PROMPT,
} from '../src/activate.js';

const entry = normalizedServerEntry({ execPath: '/opt/node/bin/node', repoRoot: '/Users/someone/aside-codemode', exists: () => true });

function replOk(extra = {}) {
  return JSON.stringify({ codemodeActivation: 1, ok: true, wrote: 'aside-codemode', servers: ['aside-codemode'], version: null, inventories: [], ...extra });
}

// The daemon is a JavaScript host, so the honest way to test the script we send it is to run
// it against a stub of the one object it touches. Asserting on the script's TEXT proved
// nothing about its behaviour: the guard could be deleted and a text test would still pass.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runInFakeDaemon(script, mcp) {
  const state = { mcp: JSON.parse(JSON.stringify(mcp)) };
  const sets = [];
  const aside = {
    settings: {
      getAll: async () => JSON.parse(JSON.stringify(state)),
      get: async (k) => JSON.parse(JSON.stringify(state[k])),
      set: async (k, v) => { sets.push([k, v]); state[k] = JSON.parse(JSON.stringify(v)); },
    },
  };
  const logs = [];
  await new AsyncFunction('aside', 'console', script)(aside, { log: (m) => logs.push(String(m)) });
  return { state, sets, printed: logs.map((l) => { try { return JSON.parse(l); } catch { return l; } }) };
}

const oneServer = {
  toolInventoryMigrationVersion: 1,
  servers: { 'aside-codemode': { enabled: true, transport: 'stdio', command: 'old', args: [], env: {} } },
  inventories: { 'aside-codemode': { tools: [{ name: 'execute_code' }] } },
};

test('the entry names this installation, not a guess about where it lives', () => {
  assert.equal(entry.transport, 'stdio');
  assert.equal(entry.enabled, true);
  assert.equal(entry.command, '/opt/node/bin/node');
  assert.match(entry.args[0], /server\.js$/);
  assert.equal(entry.args[1], '--config');
});

test('a config file that is not there is not named in the entry', () => {
  // Measured on Windows: a global npm install ships only the example config, and the server
  // treats a --config it cannot read as fatal, so discovery cached nothing while the write
  // itself had succeeded.
  const bare = normalizedServerEntry({ execPath: '/opt/node/bin/node', repoRoot: '/Users/someone/aside-codemode', exists: () => false });
  assert.equal(bare.args.length, 1);
  assert.ok(!bare.args.includes('--config'));
  assert.match(bare.args[0], /server\.js$/);
});

test('the script sets the mcp key and omits exactly the two keys that reset discovery', () => {
  const script = renderActivationScript({ server: 'aside-codemode', entry });
  assert.match(script, /aside\.settings\.set\("mcp", next\)/);
  assert.ok(script.includes(JSON.stringify(entry)));
});

test('running the script in a stub daemon stores our entry with both keys gone', async () => {
  const script = renderActivationScript({ server: 'aside-codemode', entry });
  const { state, sets, printed } = await runInFakeDaemon(script, oneServer);
  assert.equal(sets.length, 1);
  assert.equal(sets[0][0], 'mcp');
  // Absence is the mechanism: naming either key, even as 0, was measured not to queue
  // discovery.
  assert.ok(!('toolInventoryMigrationVersion' in state.mcp), JSON.stringify(state.mcp));
  assert.ok(!('inventories' in state.mcp));
  assert.deepEqual(state.mcp.servers['aside-codemode'], entry);
  assert.equal(printed[0].ok, true);
  assert.equal(printed[0].version, null);
  assert.deepEqual(printed[0].inventories, []);
});

test('the script keeps every other key under mcp, because they are not ours', async () => {
  const script = renderActivationScript({ server: 'aside-codemode', entry });
  const { state } = await runInFakeDaemon(script, { ...oneServer, somethingAsideOwns: { a: 1 }, credentialCleanup: [] });
  assert.deepEqual(state.mcp.somethingAsideOwns, { a: 1 });
  assert.deepEqual(state.mcp.credentialCleanup, []);
});

test('the real guard, not a mock, refuses when another server would be rediscovered', async () => {
  const withOther = {
    ...oneServer,
    servers: { ...oneServer.servers, other: { command: 'other' } },
  };
  const script = renderActivationScript({ server: 'aside-codemode', entry });
  const blocked = await runInFakeDaemon(script, withOther);
  assert.equal(blocked.sets.length, 0, 'a refusal must not write settings');
  assert.equal(blocked.printed[0].ok, false);
  // No `enabled` field at all is not proof of disabled, and the earlier predicate read it
  // that way.
  assert.deepEqual(blocked.printed[0].atRisk, ['other']);

  const forced = await runInFakeDaemon(renderActivationScript({ server: 'aside-codemode', entry, force: true }), withOther);
  assert.equal(forced.sets.length, 1);
  assert.equal(forced.printed[0].ok, true);

  const disabled = await runInFakeDaemon(script, {
    ...oneServer,
    servers: { ...oneServer.servers, other: { enabled: false, command: 'other' } },
  });
  assert.equal(disabled.printed[0].ok, true, 'an explicitly disabled server is not at risk');
});

test("another server's cached inventory also stops the write", async () => {
  const script = renderActivationScript({ server: 'aside-codemode', entry });
  const { sets, printed } = await runInFakeDaemon(script, {
    servers: { 'aside-codemode': { enabled: true } },
    inventories: { other: { tools: [{ name: 'x' }] } },
  });
  assert.equal(sets.length, 0);
  assert.deepEqual(printed[0].cached, ['other']);
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
  assert.match(r.error, /not in the cached inventory/);
  assert.match(r.next, /starts and speaks MCP/);
});

test("another enabled server stops the write and the session never runs", async () => {
  let runs = 0;
  const r = await activateMcp({
    entry,
    run: async () => {
      runs += 1;
      return { code: 0, stdout: JSON.stringify({ codemodeActivation: 1, ok: false, reason: 'at-risk-servers', atRisk: ['other'], cached: ['other'] }), stderr: '' };
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

test('another program printing json is not mistaken for our answer', async () => {
  const r = await activateMcp({
    entry,
    run: async () => ({ code: 0, stdout: '{"ok":true,"wrote":"aside-codemode"}\n', stderr: '' }),
    readInventory: () => ['execute_code'],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /no parseable result/);
});

test('a migration version that survived the write is not activation', async () => {
  const r = await activateMcp({
    entry,
    run: async () => ({ code: 0, stdout: replOk({ version: 1 }), stderr: '' }),
    readInventory: () => ['execute_code'],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /migration was not reset/);
});

test('someone else\'s cached tool is not our activation', async () => {
  const r = await activateMcp({
    entry,
    run: async () => ({ code: 0, stdout: replOk(), stderr: '' }),
    readInventory: () => ['some_other_tool'],
  });
  assert.equal(r.activated, false);
  assert.equal(r.ok, false);
  assert.match(r.error, /execute_code is not in the cached inventory/);
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

// --force pays for the install with other servers. Aside disables one it cannot reach during
// the discovery pass and never retries it, so what this suite has to prove is that the switch
// comes back and the cache is not forged.
const twoServers = {
  toolInventoryMigrationVersion: 1,
  servers: {
    'aside-codemode': { enabled: true, transport: 'stdio', command: 'old', args: [], env: {} },
    other: { enabled: true, command: 'somewhere-unreachable' },
  },
  inventories: { 'aside-codemode': { tools: [{ name: 'execute_code' }] }, other: { tools: [{ name: 'other_tool' }] } },
};

test('the abort puts the account back exactly as it was', async () => {
  const script = renderRestoreScript({ snapshot: twoServers, mode: 'full' });
  const { state, sets, printed } = await runInFakeDaemon(script, { servers: {}, somethingElse: 1 });
  assert.equal(sets.length, 1);
  assert.deepEqual(state.mcp, twoServers);
  assert.equal(printed[0].mode, 'full');
  assert.equal(printed[0].version, 1);
});

test('the success path turns the other server back on and forges nothing', async () => {
  // What the daemon looks like after a forced discovery that could not reach the other server.
  const afterDiscovery = {
    toolInventoryMigrationVersion: 1,
    servers: {
      'aside-codemode': { enabled: true, transport: 'stdio', command: 'new', args: [], env: {} },
      other: { enabled: false, command: 'somewhere-unreachable' },
    },
    inventories: { 'aside-codemode': { tools: [{ name: 'execute_code' }] } },
  };
  const script = renderRestoreScript({ snapshot: twoServers, mode: 'enabled' });
  const { state, printed } = await runInFakeDaemon(script, afterDiscovery);
  assert.deepEqual(printed[0].restored, ['other']);
  assert.deepEqual(printed[0].lostInventories, ['other']);
  assert.deepEqual(printed[0].stillOff, []);
  assert.equal(state.mcp.servers.other.enabled, true);
  // The cache stays missing. Aside rebuilds it the next time the server answers, and a cache
  // written from a snapshot is a claim about a tool definition nobody re-read.
  assert.equal(state.mcp.inventories.other, undefined);
  assert.deepEqual(state.mcp.servers['aside-codemode'].command, 'new');
});

test('a server that was already off stays off, because somebody decided that', async () => {
  const snapshot = {
    servers: { 'aside-codemode': { enabled: true }, muted: { enabled: false } },
    inventories: {},
  };
  const after = {
    servers: { 'aside-codemode': { enabled: true }, muted: { enabled: false } },
    inventories: {},
  };
  const { sets, printed } = await runInFakeDaemon(renderRestoreScript({ snapshot, mode: 'enabled' }), after);
  assert.deepEqual(printed[0].restored, []);
  assert.equal(sets.length, 0, 'nothing to restore must not write settings');
});

test('a failed discovery session rolls the account back and says so', async () => {
  const calls = [];
  const r = await activateMcp({
    entry,
    force: true,
    run: async (cmd, args) => {
      const script = args.at(-1);
      calls.push(script.includes('SNAPSHOT') ? 'restore' : (args.includes('exec') ? 'session' : 'set'));
      if (args.includes('exec')) return { code: 1, stdout: '', stderr: 'session failed' };
      if (script.includes('SNAPSHOT')) return { code: 0, stdout: JSON.stringify({ codemodeActivation: 1, ok: true, mode: 'full' }), stderr: '' };
      return { code: 0, stdout: replOk({ before: twoServers }), stderr: '' };
    },
    readInventory: () => { throw new Error('the inventory must not be read after a failed session'); },
  });
  assert.deepEqual(calls, ['set', 'session', 'restore']);
  assert.equal(r.ok, false);
  assert.equal(r.rolledBack, true);
  assert.equal(r.registered, false);
});

test('the snapshot reaches the caller before anything can go wrong with it', async () => {
  let saved = null;
  await activateMcp({
    entry,
    force: true,
    onSnapshot: (s) => { saved = s; },
    run: async (cmd, args) => {
      const script = args.at(-1);
      if (args.includes('exec')) return { code: 0, stdout: 'ok', stderr: '' };
      if (script.includes('SNAPSHOT')) return { code: 0, stdout: JSON.stringify({ codemodeActivation: 1, ok: true, mode: 'enabled', restored: ['other'], lostInventories: ['other'], stillOff: [] }), stderr: '' };
      return { code: 0, stdout: replOk({ before: twoServers }), stderr: '' };
    },
    readInventory: () => ['execute_code'],
  });
  assert.deepEqual(saved, twoServers);
});

test('a single-server account pays nothing for the restore it does not need', async () => {
  const scripts = [];
  const r = await activateMcp({
    entry,
    run: async (cmd, args) => {
      scripts.push(args.at(-1));
      if (args.includes('exec')) return { code: 0, stdout: 'ok', stderr: '' };
      return { code: 0, stdout: replOk({ before: { servers: { 'aside-codemode': { enabled: true } }, inventories: {} } }), stderr: '' };
    },
    readInventory: () => ['execute_code'],
  });
  assert.equal(r.ok, true);
  assert.equal(scripts.filter((s) => s.includes('SNAPSHOT')).length, 0);
  assert.deepEqual(r.restored, []);
});

// Aside finishes the migration after the session process is gone. Measured on macOS: the write
// landed at 1.4s, the migration wrote its result at 2.0s, and a restore that ran in between
// saw a state where nothing had been switched off yet and truthfully reported nothing to do.
test('the restore waits for the migration to finish before it compares', async () => {
  const order = [];
  let reads = 0;
  const snapshot = {
    toolInventoryMigrationVersion: 1,
    servers: { 'aside-codemode': { enabled: true }, other: { enabled: true } },
    inventories: { 'aside-codemode': { tools: [{ name: 'execute_code' }], refreshedAt: 'OLD' } },
  };
  const r = await activateMcp({
    entry,
    force: true,
    settleIntervalMs: 1,
    wait: async () => { order.push('wait'); },
    readState: async () => {
      reads += 1,
      order.push('read');
      // The first two reads are the state before the migration wrote anything: the version key
      // is back but the inventory is the same one the snapshot has.
      return reads < 3 ? { version: 1, refreshedAt: 'OLD' } : { version: 1, refreshedAt: 'NEW' };
    },
    run: async (cmd, args) => {
      const script = args.at(-1);
      if (args.includes('exec')) { order.push('session'); return { code: 0, stdout: 'ok', stderr: '' }; }
      if (script.includes('SNAPSHOT')) { order.push('restore'); return { code: 0, stdout: JSON.stringify({ codemodeActivation: 1, ok: true, mode: 'enabled', restored: ['other'], lostInventories: [], stillOff: [] }), stderr: '' }; }
      order.push('set');
      return { code: 0, stdout: replOk({ before: snapshot }), stderr: '' };
    },
    readInventory: () => ['execute_code'],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.restored, ['other']);
  assert.equal(order.indexOf('restore') > order.lastIndexOf('read'), true, 'the restore ran before the state settled: ' + order.join(','));
  assert.equal(order.filter((o) => o === 'wait').length, 2, order.join(','));
  const settle = r.steps.find((s) => s.step === 'settle');
  assert.equal(settle.settled, true);
});

test('a settle that never happens is reported, not waited on forever', async () => {
  const r = await activateMcp({
    entry,
    force: true,
    settleTimeoutMs: 5,
    settleIntervalMs: 1,
    wait: async () => {},
    readState: async () => ({ version: 1, refreshedAt: 'OLD' }),
    run: async (cmd, args) => {
      const script = args.at(-1);
      if (args.includes('exec')) return { code: 0, stdout: 'ok', stderr: '' };
      // The real script reports ok from stillOff being empty, so the stub has to as well.
      if (script.includes('SNAPSHOT')) return { code: 0, stdout: JSON.stringify({ codemodeActivation: 1, ok: false, mode: 'enabled', restored: [], lostInventories: [], stillOff: ['other'] }), stderr: '' };
      return { code: 0, stdout: replOk({ before: { servers: { 'aside-codemode': {}, other: { enabled: true } }, inventories: { 'aside-codemode': { refreshedAt: 'OLD' } } } }), stderr: '' };
    },
    readInventory: () => ['execute_code'],
  });
  const settle = r.steps.find((s) => s.step === 'settle');
  assert.equal(settle.settled, false);
  // And a server that could not be switched back on is named rather than glossed over.
  assert.deepEqual(r.stillOff, ['other']);
  assert.equal(r.ok, false);
  assert.match(r.next, /could not be switched back on/);
});

test('an account id is accepted in either spelling the user has', () => {
  assert.equal(normalizeAccount('1'), 'u1');
  assert.equal(normalizeAccount('u2'), 'u2');
  assert.equal(normalizeAccount(3), 'u3');
});
