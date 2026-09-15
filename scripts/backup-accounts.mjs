#!/usr/bin/env node
// Copy what this install owns, out of the checkout, before anything writes to a live account.
//
//   node scripts/backup-accounts.mjs [--aside-home <path>] [--out <dir>] [--json]
//
// Scope is deliberate and narrow: the managed AGENTS.md, codemode/ and the user skill. An
// account's settings, credentials, sessions, memory and database are not ours and are not
// copied - this is a backup of our own footprint, not of an account. Say so wherever it is
// referenced, because "backup" invites the other reading.
//
// The destination defaults outside the repository. evidence/ is tracked, and account
// documents are not ours to commit.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listAccountRoots } from '../src/register.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const asideHome = arg('--aside-home', path.join(os.homedir(), '.aside'));
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '').slice(2);
const outDir = path.resolve(arg('--out', path.join(os.homedir(), 'aside-codemode-backup-' + stamp)));
const asJson = process.argv.includes('--json');

const OWNED = ['AGENTS.md', 'codemode', path.join('skills', 'user', 'aside-codemode')];

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base));
    else out.push(abs);
  }
  return out;
}

const { roots } = listAccountRoots({ asideHome });
const copied = [];
for (const { id, root } of roots) {
  const dest = path.join(outDir, 'account-' + id);
  for (const rel of OWNED) {
    const from = path.join(root, rel);
    if (!existsSync(from)) continue;
    const to = path.join(dest, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  if (existsSync(dest)) {
    for (const file of walk(dest)) {
      copied.push({
        account: id,
        path: path.relative(outDir, file),
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
      });
    }
  }
}

// The layout mirrors the live one, so restoring is a copy back rather than a translation.
const report = {
  at: new Date().toISOString(), host: os.hostname(), asideHome, outDir,
  scope: 'files this install owns: AGENTS.md (whole file), codemode/, skills/user/aside-codemode/',
  notIncluded: ['settings.json', 'credentials.json', 'sessions/', 'memory/', 'state.db', 'other skills'],
  files: copied,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'BACKUP.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(asJson ? JSON.stringify(report, null, 2)
  : copied.length + ' files from ' + roots.length + ' account roots -> ' + outDir);
