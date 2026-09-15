#!/usr/bin/env node
// The install lifecycle, rehearsed end to end on a throwaway account root.
//
//   node scripts/rehearse-install.mjs [--out <path>]
//
// Real accounts get doctor and upgrade only. Everything destructive - repair after a
// deletion, uninstall, rollback - happens here, on a copy, because the installer has no
// backup of its own: uninstall removes the manifest that holds the previous generation, and
// rollback rewrites files without asking whether the user touched them since.
//
// The account starts as an EARLIER release installed it, so the upgrade under test actually
// changes bytes. An upgrade that writes what is already there proves nothing about rollback.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInstaller, MANIFEST_RELPATH, sha256 } from '../scripts/install-codemode.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const outPath = arg('--out', null);

const OLD_HELPER = '// an older release wrote this\n';
const SKILL = 'skills/user/aside-codemode/SKILL.md';
const HELPER = 'codemode/cm.js';

const base = mkdtempSync(path.join(os.tmpdir(), 'acm-rehearsal-'));
const home = path.join(base, '.aside');
const root = path.join(home, 'u', '0');
mkdirSync(root, { recursive: true });

const read = (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : null);
const manifest = () => (existsSync(path.join(root, MANIFEST_RELPATH)) ? JSON.parse(readFileSync(path.join(root, MANIFEST_RELPATH), 'utf8')) : null);
const run = (verb) => runInstaller({ verb, asideHome: home, account: '0' });
const blocks = () => (read('AGENTS.md') || '').split('<!-- aside-codemode:start -->').length - 1;

const steps = [];
const failures = [];
// A transcript nobody checks is a log, not a rehearsal. Every step states what must hold.
const step = (name, fact, musts) => {
  const bad = Object.entries(musts || {}).filter(([, v]) => v !== true).map(([k]) => k);
  if (bad.length) failures.push(name + ': ' + bad.join(', '));
  steps.push({ name, ...fact, held: bad.length === 0, broke: bad });
};

// 1. a clean install, then age it into the previous release
run('install');
writeFileSync(path.join(root, HELPER), OLD_HELPER, 'utf8');
const m0 = manifest();
m0.version = '0.9.0';
m0.files = m0.files.map((f) => (f.path === HELPER ? { ...f, sha256: sha256(OLD_HELPER) } : f));
writeFileSync(path.join(root, MANIFEST_RELPATH), JSON.stringify(m0, null, 2) + '\n', 'utf8');
step('1 installed, then aged to the previous release',
  { helperIsOld: read(HELPER) === OLD_HELPER, blocks: blocks() },
  { helperIsOld: read(HELPER) === OLD_HELPER, oneBlock: blocks() === 1 });

// 2. doctor has to notice
const d1 = run('doctor');
step('2 doctor on a machine a release left behind', {
  installedVersion: d1.installedVersion, upToDate: d1.upToDate,
  reasons: d1.files.map((f) => f.path + '=' + f.reason),
}, {
  saysStale: d1.files.some((f) => f.path === HELPER && f.reason === 'stale'),
  notUpToDate: d1.upToDate === false,
});

// 3. the user edits the skill
const edited = read(SKILL) + '\n<!-- a line the user added -->\n';
writeFileSync(path.join(root, SKILL), edited, 'utf8');

// 4. upgrade: keep the edit, replace the rest, remember the outgoing bytes
const up = run('upgrade');
const previous = (manifest() || {}).previous;
step('4 upgrade', {
  preserved: up.preserved, written: up.written,
  userEditKept: read(SKILL) === edited,
  helperReplaced: read(HELPER) !== OLD_HELPER,
  previousHoldsOldHelper: Boolean(previous) && previous.files.some((f) => f.path === HELPER && f.content === OLD_HELPER),
  blocks: blocks(),
}, {
  userEditKept: read(SKILL) === edited,
  helperReplaced: read(HELPER) !== OLD_HELPER,
  previousHoldsOldHelper: Boolean(previous) && previous.files.some((f) => f.path === HELPER && f.content === OLD_HELPER),
  oneBlock: blocks() === 1,
});

// 5. rollback before repair: repair rewrites the manifest and would drop this generation
const beforeRollbackEdit = read(SKILL);
run('rollback');
step('5 rollback', {
  helperBackToOld: read(HELPER) === OLD_HELPER,
  userEditSurvived: read(SKILL) === beforeRollbackEdit,
  note: 'rollback writes the snapshot without inspecting the disk; a file the user changed after the upgrade is overwritten',
}, {
  helperBackToOld: read(HELPER) === OLD_HELPER,
  userEditSurvived: read(SKILL) === beforeRollbackEdit,
});

// 6. a deletion, then repair
unlinkSync(path.join(root, SKILL));
const rep = run('repair');
step('6 repair after a deletion', {
  written: rep.written, skipped: rep.skipped,
  skillIsBack: read(SKILL) !== null,
  manifestKeepsDiskHashForSkipped: manifest().files.find((f) => f.path === HELPER).sha256 === sha256(read(HELPER)),
}, {
  skillIsBack: read(SKILL) !== null,
  onlyMissingWasWritten: rep.written.length === 1 && rep.written[0] === SKILL,
  recordedHashStillMatchesDisk: manifest().files.find((f) => f.path === HELPER).sha256 === sha256(read(HELPER)),
});

// 7. upgrade still delivers after a repair
const up2 = run('upgrade');
step('7 upgrade after repair', { helperIsCurrent: read(HELPER) !== OLD_HELPER, preserved: up2.preserved },
  { helperIsCurrent: read(HELPER) !== OLD_HELPER });

// 7b. A file the user edited, still edited when uninstall runs. Without this the uninstall
// step only ever sees files it owns outright, and 'preserved' is empty by construction.
const mine = read(SKILL) + '\n<!-- kept by the user -->\n';
writeFileSync(path.join(root, SKILL), mine, 'utf8');
const d3 = run('doctor');
step('7b a user edit, before uninstall', { reason: d3.files.find((f) => f.path === SKILL).reason },
  { readAsAnEdit: d3.files.find((f) => f.path === SKILL).reason === 'modified' });

// 8. uninstall, then install again
const unin = run('uninstall');
step('8 uninstall', {
  removed: unin.removed, preserved: unin.preserved, agentsBlock: unin.agentsBlock,
  manifestGone: manifest() === null, blocks: blocks(),
  editSurvived: read(SKILL) === mine,
}, {
  keptTheUserEdit: unin.preserved.includes(SKILL) && read(SKILL) === mine,
  removedWhatItOwned: unin.removed.includes(HELPER),
  blockRemoved: blocks() === 0,
  manifestGone: manifest() === null,
});
const back = run('install');
const d2 = run('doctor');
step('9 install again', {
  written: back.written, preserved: back.preserved,
  upToDate: d2.upToDate, blocks: blocks(), agentsBlock: d2.agentsBlock,
}, {
  // The edited skill is still the user's; install does not take a file it did not write.
  leavesTheUserFileAlone: read(SKILL) === mine,
  oneBlock: blocks() === 1,
});

const report = {
  at: new Date().toISOString(), platform: process.platform, accountRoot: root,
  held: failures.length === 0, failures, steps,
};
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
for (const s of steps) console.log(JSON.stringify(s));
rmSync(base, { recursive: true, force: true });
if (failures.length) {
  for (const f of failures) console.error('BROKE ' + f);
  process.exit(1);
}
console.log('rehearsal: every step held');
