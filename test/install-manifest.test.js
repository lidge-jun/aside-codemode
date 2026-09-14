// wp9. An install that overwrites a file the user edited, or deletes a file it never put
// there, is worse than no installer. These cases pin the manifest as the only authority for
// what belongs to us.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInstaller, MANIFEST_RELPATH, SKILL_DIR } from '../scripts/install-codemode.mjs';

const START = '<!-- aside-codemode:start -->';

function fixture() {
  const home = path.join(mkdtempSync(path.join(os.tmpdir(), 'acm-install-')), 'aside');
  const root = path.join(home, 'u', '0');
  mkdirSync(root, { recursive: true });
  return {
    home,
    root,
    run: (verb, opts = {}) => runInstaller({ verb, asideHome: home, account: '0', ...opts }),
    read: (rel) => readFileSync(path.join(root, rel), 'utf8'),
    manifest: () => JSON.parse(readFileSync(path.join(root, MANIFEST_RELPATH), 'utf8')),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

const SKILL = SKILL_DIR + '/SKILL.md';

test('a fresh install writes exactly what the manifest claims', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const out = f.run('install');
  assert.deepEqual(out.preserved, []);
  const m = f.manifest();
  assert.equal(m.schema, 'codemode-install/1');
  for (const file of m.files) assert.ok(existsSync(path.join(f.root, file.path)), file.path + ' is in the manifest but not on disk');
  assert.deepEqual(f.run('doctor').files.filter((x) => !x.ok), []);
});

test('reinstalling leaves exactly one managed block and the surrounding notes alone', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  writeFileSync(path.join(f.root, 'AGENTS.md'), '# my notes\n\nkeep this\n');
  f.run('install');
  f.run('install');
  f.run('upgrade');
  const agents = f.read('AGENTS.md');
  assert.equal(agents.split(START).length - 1, 1, 'the block was appended instead of replaced');
  assert.ok(agents.includes('keep this'), "the user's own notes were dropped");
});

test('a file the user edited is kept, and named', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.run('install');
  const mine = f.read(SKILL) + '\nMY OWN NOTE\n';
  writeFileSync(path.join(f.root, SKILL), mine);

  const out = f.run('install');
  assert.deepEqual(out.preserved, [SKILL]);
  assert.equal(f.read(SKILL), mine, 'the edit was overwritten');
  assert.ok(!out.written.includes(SKILL));

  const seen = f.run('doctor').files.find((x) => x.path === SKILL);
  assert.equal(seen.ok, false);
  assert.equal(seen.reason, 'modified');
});

test('a file already sitting in our path is not adopted', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  mkdirSync(path.join(f.root, SKILL_DIR), { recursive: true });
  writeFileSync(path.join(f.root, SKILL), 'someone else wrote this\n');
  const out = f.run('install');
  assert.deepEqual(out.preserved, [SKILL]);
  assert.equal(f.read(SKILL), 'someone else wrote this\n');
});

test('a file that is already byte-identical is adopted, not called an edit', (t) => {
  // The wp8 probe installs cm.js on its own. A first install finding exactly the bytes it
  // was about to write has nothing to preserve and everything to record: refusing to own it
  // leaves the manifest wrong about a file that is right, and repair then finds nothing to do.
  const f = fixture();
  t.after(f.cleanup);
  f.run('install');
  const cm = f.read('codemode/cm.js');
  rmSync(path.join(f.root, MANIFEST_RELPATH));

  const out = f.run('install');
  assert.deepEqual(out.preserved, []);
  assert.ok(out.adopted.includes('codemode/cm.js'));
  assert.equal(f.read('codemode/cm.js'), cm);
  assert.deepEqual(f.run('doctor').files.filter((x) => !x.ok), []);
});

test('repair restores only what is missing', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.run('install');
  const mine = f.read(SKILL) + '\nMY OWN NOTE\n';
  writeFileSync(path.join(f.root, SKILL), mine);
  unlinkSync(path.join(f.root, 'codemode/cm.js'));

  const out = f.run('repair');
  assert.deepEqual(out.written, ['codemode/cm.js']);
  assert.ok(out.skipped.includes(SKILL));
  assert.equal(f.read(SKILL), mine, 'repair rewrote a file that was not missing');
  assert.ok(existsSync(path.join(f.root, 'codemode/cm.js')));
});

test('uninstall removes what it owns and nothing else', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  writeFileSync(path.join(f.root, 'AGENTS.md'), '# my notes\n\nkeep this\n');
  f.run('install');
  writeFileSync(path.join(f.root, SKILL), f.read(SKILL) + '\nMY OWN NOTE\n');
  mkdirSync(path.join(f.root, 'skills', 'builtin'), { recursive: true });
  writeFileSync(path.join(f.root, 'skills', 'builtin', 'other.md'), 'not ours\n');

  const out = f.run('uninstall');
  assert.ok(out.removed.includes('codemode/cm.js'));
  assert.deepEqual(out.preserved, [SKILL], 'an edited file was deleted');
  assert.ok(existsSync(path.join(f.root, SKILL)));
  assert.ok(existsSync(path.join(f.root, 'skills', 'builtin', 'other.md')), 'a file outside the manifest was touched');
  assert.equal(existsSync(path.join(f.root, MANIFEST_RELPATH)), false);

  const agents = f.read('AGENTS.md');
  assert.ok(agents.includes('keep this'));
  assert.equal(agents.includes(START), false);
});

test('rollback restores the previous bundle whole', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.run('install');
  const before = f.read('codemode/cm.js');
  f.run('upgrade');
  writeFileSync(path.join(f.root, 'codemode/cm.js'), 'CLOBBERED\n');
  unlinkSync(path.join(f.root, SKILL));

  const out = f.run('rollback');
  assert.equal(out.ok, true);
  assert.equal(f.read('codemode/cm.js'), before);
  assert.ok(existsSync(path.join(f.root, SKILL)), 'rollback restored only part of the bundle');
  assert.equal(f.manifest().previous, null, 'a rollback that keeps its own previous can loop');
});

test('rollback refuses when there is nothing to go back to', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.run('install');
  const out = f.run('rollback');
  assert.equal(out.ok, false);
  assert.match(out.error, /no previous install/);
});

test('a dry run reports the same plan and writes nothing', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const out = f.run('install', { dryRun: true });
  assert.ok(out.written.length > 0);
  assert.equal(existsSync(path.join(f.root, MANIFEST_RELPATH)), false);
  assert.equal(existsSync(path.join(f.root, 'codemode/cm.js')), false);
});

test('doctor on an untouched account says so instead of guessing', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const out = f.run('doctor');
  assert.equal(out.installed, false);
  assert.equal(out.agentsBlock, 'absent');
  assert.deepEqual(out.files.map((x) => x.reason), out.files.map(() => 'new'));
});
