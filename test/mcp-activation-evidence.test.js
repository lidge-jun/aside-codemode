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
  assert.match(note, /omitted both `toolInventoryMigrationVersion` and `inventories`/i);
  assert.match(note, /aside\.settings\.set\('mcp', \{ servers \}\)/);
  assert.match(note, /another enabled MCP server or another cached inventory/i);
  assert.match(note, /`--force` is required/i);
  assert.match(note, /17 seconds/i);
  assert.match(note, /does not establish hot attachment/i);
});

test('the rendered script resets inventory state only by omitting both keys from the set value', () => {
  const script = renderActivationScript({ server: 'aside-codemode', entry });
  const setCall = script.match(/aside\.settings\.set\(([^\n]+)\)/);

  assert.ok(setCall, 'the rendered script must call aside.settings.set');
  assert.equal(setCall[1], '"mcp", { servers }');
  assert.doesNotMatch(setCall[1], /toolInventoryMigrationVersion|inventories/);
});

test('activation refuses another enabled server unless force is true', async () => {
  const seen = [];
  const run = async (cmd, args) => {
    seen.push({ cmd, args });
    const script = args.at(-1);
    return script.includes('const FORCE = true;')
      ? { code: 0, stdout: '{"ok":true,"wrote":"aside-codemode"}\n' }
      : { code: 0, stdout: '{"ok":false,"reason":"at-risk-servers","atRisk":["other"],"cached":[]}\n' };
  };

  const blocked = await activateMcp({ entry, discover: false, run });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, true);
  assert.deepEqual(blocked.atRisk, ['other']);

  const forced = await activateMcp({ entry, force: true, discover: false, run });
  assert.equal(forced.ok, true);
  assert.equal(forced.registered, true);
  assert.equal(forced.discoveryRan, false);
  assert.equal(seen.length, 2, 'a refused activation and forced activation each need one repl call');
});
