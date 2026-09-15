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

// A tarball is a redistribution. ripgrep's MIT text and PCRE2's notice have to travel with
// the binary we vendored, and the repository LICENSE does not cover someone else's work.
test('the vendored ripgrep ships its own notices', () => {
  const notices = readFileSync(path.join(repoRoot, 'bin', 'THIRD-PARTY-NOTICES.md'), 'utf8');
  assert.match(notices, /The MIT License \(MIT\)/);
  assert.match(notices, /Copyright \(c\) 2015 Andrew Gallant/);
  assert.match(notices, /PCRE2/);
  assert.match(notices, /Philip Hazel/);
  assert.match(notices, /THE SOFTWARE IS PROVIDED "AS IS"/);
});

// files[] used to take scripts/ whole, which shipped probes that default to a live
// ~/.aside account and a release-records script that reads evidence/ from a git checkout.
// None of them are imported by src/ or bin/, so a consumer got tooling they cannot use.
test('the tarball carries the notices and none of the maintainer-only scripts', () => {
  const pack = spawnSync(process.execPath, [npmCliJs(), 'pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  assert.equal(pack.status, 0, pack.stderr);
  const listed = JSON.parse(pack.stdout)[0].files.map((f) => f.path);

  assert.ok(listed.includes('bin/THIRD-PARTY-NOTICES.md'), 'the notices did not travel with the binary');
  assert.ok(listed.includes('bin/rg.exe'));
  assert.ok(listed.includes('scripts/install-codemode.mjs'));
  assert.ok(listed.includes('templates/skill/references/call-shapes.md'));

  for (const maintainerOnly of [
    'scripts/probe-g3.mjs', 'scripts/probe-native-helper.mjs', 'scripts/rehearse-install.mjs',
    'scripts/release-records.mjs', 'scripts/backup-accounts.mjs', 'scripts/verify-loader.mjs',
  ]) {
    assert.equal(listed.includes(maintainerOnly), false, maintainerOnly + ' does not belong in a published package');
  }
});

test('the package says where it came from and who to tell', () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.repository.url, /github\.com\/lidge-jun\/aside-codemode/);
  assert.match(pkg.bugs.url, /\/issues$/);
  assert.ok(pkg.keywords.length >= 3);
  assert.equal(pkg.bin.codemode, 'bin/codemode.mjs');
  // scripts.test has to point at something the package actually contains.
  assert.ok(pkg.files.includes('scripts/run-tests.mjs'));
});
