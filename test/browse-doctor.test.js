// `--doctor --browse` and the config surface. Spawns the real CLI the way
// test/cwd.test.js:68 does, so this observes the shipped wiring rather than a unit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'codemode.mjs');
// Point the spawned CLI at a config directory that does not exist. Without this the test
// reads the developer's real ~/.config/codemode/config.json, so enabling browsing on your
// own machine (register-aside.mjs --browse) turned "browse defaults to off" red locally
// while CI stayed green. A test whose verdict depends on the machine it runs on is worse
// than no test.
const hermetic = {
  encoding: 'utf8',
  env: { ...process.env, XDG_CONFIG_HOME: path.join(root, 'test', 'fixtures', 'no-such-config') },
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
  const cfg = loadConfig([], { XDG_CONFIG_HOME: path.join(root, 'test', 'fixtures', 'no-such-config') });
  assert.equal(cfg.browseCaps.enabled, false);
  assert.equal(cfg.browseCaps.timeoutMs, 25000);
  assert.equal(cfg.browseCaps.concurrency, 4);
  assert.equal(cfg.asidePath, null);
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
