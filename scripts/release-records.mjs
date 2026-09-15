#!/usr/bin/env node
// The two records a release has to be able to prove, written from the machine rather than
// from memory.
//
//   node scripts/release-records.mjs [--out <dir>] [--probe <file>]...
//
// release-manifest.json  what shipped: commit, artifact digest, the two version axes, and
//                        the range of hosts it was built against.
// capability-receipt.json what each surface was actually seen to do, when, and - by name -
//                        what was not checked.
//
// Nothing here is typed in twice. The digest comes from helperSource(), the commit from git,
// the surface results from the probe files this loop wrote.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperSource, HELPER_VERSION, HELPER_INSTALL_RELPATH } from '../src/host/browse/helper-bundle.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const outDir = path.resolve(arg('--out', path.join(REPO, 'evidence', 'release-260915')));
const probeFiles = process.argv.reduce((acc, v, i) => (v === '--probe' && process.argv[i + 1] ? acc.concat(process.argv[i + 1]) : acc), []);
// Where the installs were read. Collected per machine rather than guessed from this one:
// two of the three hosts are only reachable over ssh, and a manifest that lists them from
// memory is the thing this file exists to replace.
const installsFile = arg('--installs', path.join(REPO, 'evidence', 'release-260915', 'installs.json'));
const asideCli = arg('--aside-cli', null);

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const bundle = helperSource();

const manifest = {
  schema: 'codemode-release/1',
  generatedAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  // Two axes on purpose. The package version moves with a release; the helper version moves
  // only when cm.js changes. One string cannot name both, and a receipt that names one is
  // unable to point at the artifact an account is actually running.
  packageVersion: pkg.version,
  helper: {
    version: HELPER_VERSION,
    installPath: HELPER_INSTALL_RELPATH,
    sha256: bundle.sha256,
    bytes: bundle.bytes,
  },
  supported: {
    node: pkg.engines && pkg.engines.node,
    os: ['macOS (arm64, measured)', 'Windows (x64, Git Bash, measured)'],
    notSupported: ['Linux - there is no Aside install path for it'],
    asideCliMeasured: asideCli,
  },
  installs: [],
};

if (existsSync(installsFile)) {
  manifest.installs = JSON.parse(readFileSync(installsFile, 'utf8'));
  const digests = [...new Set(manifest.installs.map((i) => i.helperSha256))];
  manifest.installsAgree = digests.length === 1 && digests[0] === bundle.sha256;
  if (!manifest.installsAgree) manifest.installsDisagreement = digests;
}

const receipt = {
  schema: 'codemode-capability-receipt/1',
  generatedAt: manifest.generatedAt,
  commit: manifest.commit,
  helperVersion: HELPER_VERSION,
  surfaces: {},
  notVerified: [
    'a downscaled image mapping coordinates back - no API produces the stimulus (screenshot.maxWidth is accepted and ignored, host resize is ENOTSUP, page.setViewportSize is absent)',
    'DPI 100/125/150/200%, zoom and clip - same reason',
    'that a model received an image handed to display() - display returns undefined and the model side is not observable from the REPL',
    'native mouse/keyboard equivalence on an explicitly chosen page - needs a separate native fixture; cua is not in the capability matrix',
    'the in-app agent REPL, automatically - only the user can drive that surface; their 2026-09-15 confirmation is the evidence we have',
    'G5 usability and path-selection - not run, and not counted as passed',
  ],
};

for (const file of probeFiles) {
  if (!existsSync(file)) { receipt.surfaces[path.basename(file)] = { error: 'probe file missing: ' + file }; continue; }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const cli = data.raw && data.raw.mixed ? data.raw.mixed.helperVersion : null;
  receipt.surfaces[data.label] = {
    surface: 'aside repl (CLI)',
    platform: data.platform,
    accountRoot: data.accountRoot,
    lastVerified: data.at,
    ran: data.ran,
    passed: data.passed,
    notRun: data.skipped,
    helperLoaded: cli,
    checks: (data.checks || []).map((c) => ({ name: c.name, pass: c.pass, detail: c.detail })),
  };
}

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
writeFileSync(path.join(outDir, 'capability-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
console.log('wrote ' + path.join(outDir, 'release-manifest.json'));
console.log('wrote ' + path.join(outDir, 'capability-receipt.json'));
console.log('helper ' + HELPER_VERSION + ' ' + bundle.sha256.slice(0, 16) + ' ' + bundle.bytes + 'B, package ' + pkg.version + ', commit ' + manifest.commit.slice(0, 7));
