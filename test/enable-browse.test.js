// Browsing stays opt-in: opening a browser is not something an install should switch on by
// itself. What was wrong is the distance between "no" and "yes". The refusal named a config
// key and a caller had to find the file, learn its shape and edit it by hand, which is what
// the first user of 0.2.0 did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'codemode.mjs');

function isolated() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'acm-enable-'));
  return {
    home,
    cfg: path.join(home, 'codemode', 'config.json'),
    env: { ...process.env, XDG_CONFIG_HOME: home, CODEMODE_IGNORE_REPO_CONFIG: '1' },
  };
}

const run = (args, env) => {
  try {
    return { out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env }), code: 0 };
  } catch (e) {
    return { out: String(e.stdout || ''), err: String(e.stderr || ''), code: e.status };
  }
};

test('a refusal names a command that can actually be run', () => {
  const f = isolated();
  const res = run(['--code', "try { await browse.exec({ urls: ['https://a.test'] }); return 'no throw'; } catch (e) { return e.message; }"], f.env);
  rmSync(f.home, { recursive: true, force: true });
  const message = JSON.parse(res.out).result;
  assert.match(message, /--enable-browse/, 'the refusal still leaves the caller to find the file: ' + message);
});

test('--enable-browse turns it on and says where it wrote', () => {
  const f = isolated();
  const res = run(['--enable-browse', '--json'], f.env);
  assert.equal(res.code, 0, res.err || res.out);
  const out = JSON.parse(res.out);
  assert.equal(out.ok, true);
  assert.equal(out.enabled, true);
  assert.equal(out.path, f.cfg);
  const written = JSON.parse(readFileSync(f.cfg, 'utf8'));
  assert.equal(written.browseCaps.enabled, true);
  rmSync(f.home, { recursive: true, force: true });
});

test('it leaves every other setting where it found it', () => {
  const f = isolated();
  mkdirSync(path.dirname(f.cfg), { recursive: true });
  writeFileSync(f.cfg, JSON.stringify({ roots: ['/somewhere/else'], searchCaps: { files: 11 } }), 'utf8');
  run(['--enable-browse', '--json'], f.env);
  const written = JSON.parse(readFileSync(f.cfg, 'utf8'));
  assert.deepEqual(written.roots, ['/somewhere/else'], 'enabling browsing must not rewrite roots');
  assert.equal(written.searchCaps.files, 11);
  assert.equal(written.browseCaps.enabled, true);
  rmSync(f.home, { recursive: true, force: true });
});

test('asking twice is not an edit', () => {
  const f = isolated();
  run(['--enable-browse', '--json'], f.env);
  const before = readFileSync(f.cfg, 'utf8');
  const second = JSON.parse(run(['--enable-browse', '--json'], f.env).out);
  assert.equal(second.alreadyEnabled, true);
  assert.equal(readFileSync(f.cfg, 'utf8'), before, 'a no-op rewrote the file');
  rmSync(f.home, { recursive: true, force: true });
});

test('doctor agrees afterwards', () => {
  const f = isolated();
  const before = JSON.parse(run(['--doctor', '--browse'], f.env).out);
  assert.equal(before.browse.enabled, false);
  assert.match(JSON.stringify(before.browse), /--enable-browse/, 'doctor should say how to turn it on');
  run(['--enable-browse'], f.env);
  const after = JSON.parse(run(['--doctor', '--browse'], f.env).out);
  assert.equal(after.browse.enabled, true);
  rmSync(f.home, { recursive: true, force: true });
});
