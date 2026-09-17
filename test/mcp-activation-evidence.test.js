import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateMcp, renderActivationScript } from '../src/activate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const note = readFileSync(path.join(root, 'evidence', 'aside-mcp-activation-260918.md'), 'utf8');
const entry = { enabled: true, transport: 'stdio', command: 'node', args: ['server.js'], env: {} };

test('the activation note pins the omit-both-keys mechanism and refusal guard', () => {
  assert.match(note, /`toolInventoryMigrationVersion` and `inventories` deleted/i);
  assert.match(note, /omitting both of those keys/i);
  assert.match(note, /aside\.settings\.set\('mcp'/);
  assert.match(note, /another enabled MCP server or another cached inventory/i);
  assert.match(note, /`--force` is required/i);
  assert.match(note, /does not establish hot attachment/i);
});

// The note describes a behaviour, so the check has to be the behaviour. Running the script
// against a stub of the only object it touches is the cheapest honest way to do that: a
// version of this test that read the script as text passed with the guard deleted.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runInFakeDaemon(script, mcp) {
  const state = { mcp: JSON.parse(JSON.stringify(mcp)) };
  const sets = [];
  const aside = {
    settings: {
      getAll: async () => JSON.parse(JSON.stringify(state)),
      set: async (k, v) => { sets.push([k, v]); state[k] = JSON.parse(JSON.stringify(v)); },
    },
  };
  const printed = [];
  await new AsyncFunction('aside', 'console', script)(aside, { log: (m) => printed.push(JSON.parse(String(m))) });
  return { state, sets, printed };
}

test('what the note claims about the mechanism is what the script does', async () => {
  const script = renderActivationScript({ server: 'aside-codemode', entry });
  const { state, sets, printed } = await runInFakeDaemon(script, {
    toolInventoryMigrationVersion: 1,
    servers: { 'aside-codemode': { enabled: true, command: 'stale' } },
    inventories: { 'aside-codemode': { tools: [{ name: 'execute_code' }] } },
  });
  assert.equal(sets.length, 1);
  assert.equal(sets[0][0], 'mcp');
  assert.ok(!('toolInventoryMigrationVersion' in state.mcp));
  assert.ok(!('inventories' in state.mcp));
  assert.deepEqual(state.mcp.servers['aside-codemode'], entry);
  assert.equal(printed[0].ok, true);
});

test('the refusal the note describes comes from the script, and force is what lifts it', async () => {
  const withOther = {
    servers: { 'aside-codemode': { enabled: true }, other: { enabled: true } },
    inventories: {},
  };
  const blocked = await runInFakeDaemon(renderActivationScript({ server: 'aside-codemode', entry }), withOther);
  assert.equal(blocked.sets.length, 0);
  assert.equal(blocked.printed[0].ok, false);
  assert.deepEqual(blocked.printed[0].atRisk, ['other']);

  const forced = await runInFakeDaemon(renderActivationScript({ server: 'aside-codemode', entry, force: true }), withOther);
  assert.equal(forced.sets.length, 1);

  // And the host reports that refusal as a refusal rather than as a failed install.
  const reported = await activateMcp({
    entry,
    discover: false,
    run: async (cmd, args) => runInFakeDaemon(args.at(-1), withOther)
      .then(({ printed }) => ({ code: 0, stdout: JSON.stringify(printed[0]), stderr: '' })),
  });
  assert.equal(reported.blocked, true);
  assert.deepEqual(reported.atRisk, ['other']);
});
