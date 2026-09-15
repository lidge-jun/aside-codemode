// What an installer owes a user is not "the new files landed". It is that the old ones can
// come back, that it says so when a machine is behind, and that no verb leaves the account
// in a state where the next verb refuses to fix it.
//
// The fixture below is an account installed by an EARLIER release: the files on disk are the
// old bytes and the manifest agrees with them. That is the state every machine is in the
// moment a release changes cm.js, and it is the state the three defects here needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, existsSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInstaller, MANIFEST_RELPATH, sha256 } from '../scripts/install-codemode.mjs';

const OLD = '// an older release wrote this\n';

function installedByAnOlderRelease() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'acm-life-'));
  const home = path.join(base, '.aside');
  const root = path.join(home, 'u', '0');
  mkdirSync(root, { recursive: true });
  runInstaller({ verb: 'install', asideHome: home, account: '0' });

  const manifestPath = path.join(root, MANIFEST_RELPATH);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Roll the helper back to the older release's bytes, and let the manifest agree with them.
  writeFileSync(path.join(root, 'codemode/cm.js'), OLD, 'utf8');
  manifest.version = '0.9.0';
  manifest.files = manifest.files.map((f) => (f.path === 'codemode/cm.js' ? { ...f, sha256: sha256(OLD) } : f));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { base, home, root, manifestPath };
}

const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8');
const manifestOf = (f) => JSON.parse(readFileSync(f.manifestPath, 'utf8'));

test('an upgrade that changes bytes can still be rolled back to the old ones', (t) => {
  const f = installedByAnOlderRelease();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));

  runInstaller({ verb: 'upgrade', asideHome: f.home, account: '0' });
  assert.notEqual(read(f.root, 'codemode/cm.js'), OLD, 'the upgrade did not take');

  const previous = manifestOf(f).previous;
  const kept = previous.files.find((x) => x.path === 'codemode/cm.js');
  assert.equal(kept.content, OLD, 'previous holds the bytes the upgrade wrote, so rollback cannot go back');

  runInstaller({ verb: 'rollback', asideHome: f.home, account: '0' });
  assert.equal(read(f.root, 'codemode/cm.js'), OLD, 'rollback did not restore the older release');
});

test('doctor says a machine left behind by a release is stale, not healthy', (t) => {
  const f = installedByAnOlderRelease();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));

  const out = runInstaller({ verb: 'doctor', asideHome: f.home, account: '0' });
  const helper = out.files.find((x) => x.path === 'codemode/cm.js');
  assert.equal(helper.ok, false, 'doctor called an out-of-date helper healthy');
  assert.equal(helper.reason, 'stale');
  assert.equal(out.upToDate, false);
});

test('repair does not record bytes that are not on disk', (t) => {
  const f = installedByAnOlderRelease();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));

  runInstaller({ verb: 'repair', asideHome: f.home, account: '0' });
  const recorded = manifestOf(f).files.find((x) => x.path === 'codemode/cm.js');
  assert.equal(recorded.sha256, sha256(OLD),
    'repair skipped the file but wrote the planned hash, so the next upgrade will read it as a user edit');

  // And the trap itself: after a repair, an upgrade must still be able to deliver.
  runInstaller({ verb: 'upgrade', asideHome: f.home, account: '0' });
  assert.notEqual(read(f.root, 'codemode/cm.js'), OLD, 'repair then upgrade left the old helper in place for good');
});

test('repair still restores a file that is actually missing', (t) => {
  const f = installedByAnOlderRelease();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));

  unlinkSync(path.join(f.root, 'skills/user/aside-codemode/SKILL.md'));
  const out = runInstaller({ verb: 'repair', asideHome: f.home, account: '0' });
  assert.deepEqual(out.written, ['skills/user/aside-codemode/SKILL.md']);
  assert.equal(existsSync(path.join(f.root, 'skills/user/aside-codemode/SKILL.md')), true);
});

// The other half of the same rule. Recording what is on disk would make a file the user
// really edited start agreeing with the manifest, and the next upgrade would take their work
// away while reporting nothing.
test('a repair does not turn a user edit into something upgrade may overwrite', (t) => {
  const f = installedByAnOlderRelease();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));

  const skill = 'skills/user/aside-codemode/SKILL.md';
  const mine = read(f.root, skill) + '\n<!-- mine -->\n';
  writeFileSync(path.join(f.root, skill), mine, 'utf8');

  const rep = runInstaller({ verb: 'repair', asideHome: f.home, account: '0' });
  assert.ok(rep.skipped.includes(skill));

  const up = runInstaller({ verb: 'upgrade', asideHome: f.home, account: '0' });
  assert.ok(up.preserved.includes(skill), 'the edit stopped looking like an edit after a repair');
  assert.equal(read(f.root, skill), mine, 'the upgrade overwrote a file the user had edited');
});

// 030 asked for this to be pinned rather than described: rollback writes the snapshot back
// without asking what happened since. An edit made AFTER the upgrade is not in that snapshot
// and does not survive. That is why the live accounts do not get this verb.
test('rollback overwrites an edit made after the upgrade, and the test says so', (t) => {
  const f = installedByAnOlderRelease();
  t.after(() => rmSync(f.base, { recursive: true, force: true }));

  const skill = 'skills/user/aside-codemode/SKILL.md';
  runInstaller({ verb: 'upgrade', asideHome: f.home, account: '0' });
  const afterUpgrade = read(f.root, skill);
  writeFileSync(path.join(f.root, skill), afterUpgrade + '\n<!-- written after the upgrade -->\n', 'utf8');

  runInstaller({ verb: 'rollback', asideHome: f.home, account: '0' });
  assert.equal(read(f.root, skill).includes('written after the upgrade'), false,
    'rollback is documented as restoring the snapshot whole; if it now preserves later edits, the note in 090 and operating-notes must change');
});
