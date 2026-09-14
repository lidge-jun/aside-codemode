import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function npmCliJs() {
  const execDir = path.dirname(process.execPath);
  const candidates = [
    path.join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('npm-cli.js not found next to node; cannot pack');
}

test('LICENSE is SPDX MIT with the locked copyright holder', () => {
  const body = readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
  assert.match(body, /MIT License/);
  assert.match(body, /Copyright \(c\) 2026 lidge-jun/);
});

test('npm pack dry-run includes LICENSE', () => {
  const pack = spawnSync(process.execPath, [npmCliJs(), 'pack', '--dry-run'], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  assert.equal(pack.status, 0, pack.stderr);
  assert.match(`${pack.stdout}\n${pack.stderr}`, /LICENSE/);
});

test('workflow matrix covers Node 18/20/22 and installs rg', () => {
  const yml = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(yml, /node: '18'/);
  assert.match(yml, /node: '20'/);
  assert.match(yml, /node: '22'/);
  assert.match(yml, /ubuntu-latest/);
  assert.match(yml, /macos-latest/);
  assert.match(yml, /windows-latest/);
  assert.match(yml, /ripgrep/);
  assert.match(yml, /npm test/);
  assert.equal(/npm ci/.test(yml), false);
});
