import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const note = readFileSync(path.join(root, 'evidence', 'aside-mcp-attach-260918.md'), 'utf8');

test('the MCP attachment note carries the measured protocol and inventory facts', () => {
  for (const measured of [
    /6,775/,
    /2025-11-25/,
    /execute_code/,
    /ERG404/,
    /0 tools cached/,
    /1 tool cached/,
  ]) {
    assert.match(note, measured);
  }
});

test('the MCP attachment note keeps unmeasured activation behavior out of its claims', () => {
  assert.match(note, /No automatic activation/i);
  assert.match(note, /Hot-attach behavior for an already running session is unverified/i);
  assert.doesNotMatch(note, /(?:supports?|provides?|has) automatic activation/i);
  assert.doesNotMatch(note, /already running sessions? (?:can|will|does) hot-attach/i);
});
