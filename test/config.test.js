// AC 9 — config precedence and root normalization.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { makeRootGuard, RootEscapeError } from '../src/paths.js';

function writeCfg(dir, name, obj) {
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('argv --config beats CODEMODE_CONFIG beats repo file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cfg-'));
  const argvCfg = writeCfg(dir, 'argv.json', { roots: [path.join(dir, 'from-argv')] });
  const envCfg = writeCfg(dir, 'env.json', { roots: [path.join(dir, 'from-env')] });
  const viaArgv = loadConfig(['--config', argvCfg], { CODEMODE_CONFIG: envCfg });
  assert.deepEqual(viaArgv.roots, [path.resolve(path.join(dir, 'from-argv'))]);
  const viaEnv = loadConfig([], { CODEMODE_CONFIG: envCfg });
  assert.deepEqual(viaEnv.roots, [path.resolve(path.join(dir, 'from-env'))]);
});

test('individual env keys override files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cfg-'));
  const cfg = writeCfg(dir, 'c.json', { roots: [path.join(dir, 'from-file')], maxTimeoutMs: 1000 });
  const out = loadConfig(['--config', cfg], {
    CODEMODE_ROOTS: path.join(dir, 'from-envroots'),
    CODEMODE_TIMEOUT_MS: '9999',
  });
  assert.deepEqual(out.roots, [path.resolve(path.join(dir, 'from-envroots'))]);
  assert.equal(out.maxTimeoutMs, 9999);
});

test('empty roots deny every fs call', () => {
  const guard = makeRootGuard([]);
  assert.throws(() => guard(tmpdir()), RootEscapeError);
});
