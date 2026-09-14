import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCwd } from '../src/host/cwd.js';
import { makeRootGuard, RootEscapeError } from '../src/paths.js';
import { createFs } from '../src/host/fs.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');

test('--cwd wins over CODEMODE_CWD and process cwd', () => {
  const out = resolveCwd({
    argv: ['--cwd', '/tmp/from-flag'],
    env: { CODEMODE_CWD: '/tmp/from-env' },
    processCwd: '/tmp/from-proc',
  });
  assert.equal(out, path.resolve('/tmp/from-flag'));
});

test('CODEMODE_CWD wins over process cwd', () => {
  const out = resolveCwd({
    argv: [],
    env: { CODEMODE_CWD: '/tmp/from-env' },
    processCwd: '/tmp/from-proc',
  });
  assert.equal(out, path.resolve('/tmp/from-env'));
});

test('relative path resolves against guard cwd', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-cwd-'));
  writeFileSync(path.join(root, 'a.txt'), 'ok');
  const guard = makeRootGuard([root], { cwd: root });
  assert.equal(guard('a.txt'), path.join(realpathSync.native(root), 'a.txt'));
  const fs = createFs({ assertInside: guard });
  assert.equal(await fs.read('a.txt'), 'ok');
});

test('relative path resolving outside roots throws', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'codemode-cwd-out-'));
  const root = path.join(base, 'root');
  mkdirSync(root);
  const guard = makeRootGuard([root], { cwd: root });
  assert.throws(() => guard('..'), RootEscapeError);
});

test('cwd outside roots does not throw at construction', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'codemode-cwd-out2-'));
  const root = path.join(base, 'root');
  const other = path.join(base, 'other');
  mkdirSync(root);
  mkdirSync(other);
  const guard = makeRootGuard([root], { cwd: other });
  assert.equal(guard.cwd, path.resolve(other));
  assert.throws(() => guard('a.txt'), RootEscapeError);
});

test('CLI --cwd without a directory is structured fail', () => {
  const r = spawnSync(process.execPath, [cli, '--cwd'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, false);
  assert.match(body.error, /requires a directory/);
});

test('CLI --doctor prints resolved --cwd', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cwd-doc-'));
  const r = spawnSync(process.execPath, [cli, '--doctor', '--cwd', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.cwd, path.resolve(dir));
});
