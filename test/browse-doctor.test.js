// `--doctor --browse` and the config surface. Spawns the real CLI the way
// test/cwd.test.js:68 does, so this observes the shipped wiring rather than a unit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'codemode.mjs');
// Point the spawned CLI at a config directory that does not exist, and tell it to ignore the
// repository config too. Without either, the test reads files that describe the developer's
// machine - ~/.config/codemode/config.json and the gitignored codemode.config.json that
// register-aside.mjs writes - so "browse defaults to off" went red locally while CI stayed
// green. A test whose verdict depends on the machine it runs on is worse than no test.
const hermetic = {
  encoding: 'utf8',
  env: {
    ...process.env,
    XDG_CONFIG_HOME: path.join(root, 'test', 'fixtures', 'no-such-config'),
    CODEMODE_IGNORE_REPO_CONFIG: '1',
  },
};
const doctor = (args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], hermetic));

test('plain --doctor does not carry a browse section', () => {
  assert.equal(doctor(['--doctor']).browse, undefined);
});

test('--doctor --browse reports the measured capability matrix', () => {
  const b = doctor(['--doctor', '--browse']).browse;
  assert.equal(typeof b, 'object');
  assert.equal(b.enabled, false, 'browse is opt-in and must default to off');
  assert.ok(b.capabilities.page.absent.includes('route'), 'route must be reported absent');
  assert.ok(b.capabilities.page.present.includes('screenshot'));
  for (const k of ['route', 'maxWidth', 'format', 'fileUrl', 'networkidle']) {
    assert.equal(typeof b.capabilities.refused[k], 'string', k + ' needs a stated reason');
  }
  assert.ok(b.caps.timeoutMs <= 25000, 'the inner cap must stay under the measured ~30s screenshot timeout');
});

test('the live timing probe is explicitly skipped rather than reported as zeros', () => {
  // Printing zeroed step timings would read as a very fast page. CI must also never
  // launch a browser, so the absence has to be stated rather than faked.
  const b = doctor(['--doctor', '--browse']).browse;
  assert.equal(b.liveProbe, 'skipped (set CODEMODE_ASIDE_LIVE=1)');
});

test('browse config defaults are opt-in and merge field-wise like searchCaps', () => {
  const cfg = loadConfig([], {
    XDG_CONFIG_HOME: path.join(root, 'test', 'fixtures', 'no-such-config'),
    CODEMODE_IGNORE_REPO_CONFIG: '1',
  });
  assert.equal(cfg.browseCaps.enabled, false);
  assert.equal(cfg.browseCaps.timeoutMs, 25000);
  assert.equal(cfg.browseCaps.concurrency, 4);
  assert.equal(cfg.asidePath, null);
});

// The switch itself, pinned on any machine. Both halves are checked against a file this test
// writes, so a CI runner with no repository config proves the same thing a developer laptop
// does: read when present, skipped when asked. Asserting only on _sources would pass while
// the file was still being applied.
test('the repo config is read normally, and skipped when a test says to skip it', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'acm-repo-cfg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'codemode.config.json');
  writeFileSync(file, JSON.stringify({ browseCaps: { enabled: true, maxTabs: 3 } }), 'utf8');

  const env = {
    XDG_CONFIG_HOME: path.join(root, 'test', 'fixtures', 'no-such-config'),
    CODEMODE_REPO_CONFIG: file,
  };

  const read = loadConfig([], env);
  assert.equal(read.browseCaps.enabled, true, 'the repo config stopped being read');
  assert.equal(read.browseCaps.maxTabs, 3);
  assert.ok(read._sources.includes(file));

  const skipped = loadConfig([], { ...env, CODEMODE_IGNORE_REPO_CONFIG: '1' });
  assert.equal(skipped.browseCaps.enabled, false, 'the file was applied despite the switch');
  assert.equal(skipped.browseCaps.maxTabs, 8, 'built-in default, not the file');
  assert.equal(skipped._sources.includes(file), false);
  assert.ok(skipped._sources.includes('repo config ignored (CODEMODE_IGNORE_REPO_CONFIG=1)'));
});

test('the guest sees a frozen browse namespace and a placeholder report namespace', () => {
  const code = "return { browse: typeof browse.probe, exec: typeof browse.exec, report: typeof report };";
  const out = JSON.parse(execFileSync(process.execPath, [cli, '--code', code], { encoding: 'utf8' }));
  assert.equal(out.ok, true);
  assert.equal(out.result.browse, 'function');
  assert.equal(out.result.exec, 'function');
  assert.equal(out.result.report, 'object');
});

test('browse.exec refuses while it is disabled instead of half-working', () => {
  const code = "try { await browse.exec({ urls: ['https://a.test'] }); return 'NO THROW'; } catch (e) { return e.code; }";
  const out = JSON.parse(execFileSync(process.execPath, [cli, '--code', code], hermetic));
  assert.equal(out.result, 'EDISABLED');
});
