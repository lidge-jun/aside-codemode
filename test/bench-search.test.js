import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bench = path.join(root, 'eval', 'bench-search.mjs');

test('companion bench script exists', () => {
  assert.equal(existsSync(bench), true);
});

test('self-check reports equality and is not the operator 51x pair', () => {
  const r = spawnSync(process.execPath, [bench, '--self-check'], {
    encoding: 'utf8',
    cwd: root,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.equality, true);
  assert.equal(report.notOperator51x, true);
});
