#!/usr/bin/env node
// Does the line the installed skill actually prints work on the machine it was printed for?
//
//   node scripts/verify-loader.mjs [--account <id>] [--aside-home <path>] [--json]
//
// Not "does the template render", which a unit test already pins, and not "is the helper on
// disk", which doctor already says. This reads the loader line out of the installed SKILL.md,
// runs exactly that line inside a real 'aside repl' session, and asks the helper it loaded
// for its version.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HELPER_VERSION } from '../src/host/browse/helper-bundle.js';
import { listAccountRoots } from '../src/register.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const asideHome = arg('--aside-home', path.join(os.homedir(), '.aside'));
const account = arg('--account', null);
const asJson = process.argv.includes('--json');

const { roots } = listAccountRoots({ asideHome, only: account ? [account] : undefined });
const chosen = roots.find((r) => r.current) || roots[0];
// 'aside repl' runs as whichever account the CLI is signed in as, and its fs guard reaches
// that account's root and session directory only. Asking it to read another account's file
// is refused - correctly - so this check only means something for the current account. The
// other roots are verified by doctor, and by this same check run on the machine and account
// that owns them.
// Ask the whole list who is current: filtering to one account makes that one look current
// simply because it is the only one in the answer.
const currentOfMachine = listAccountRoots({ asideHome }).roots.find((r) => r.current);
const isCurrent = currentOfMachine ? currentOfMachine.id === chosen.id : true;
const skillPath = path.join(chosen.root, 'skills/user/aside-codemode/SKILL.md');
const skill = readFileSync(skillPath, 'utf8');
const loader = skill.split('\n').map((l) => l.trim()).find((l) => l.includes('fs.readFile('));
if (!loader) {
  console.error('the installed skill has no loader line: ' + skillPath);
  process.exit(1);
}

const PROGRAM = loader + '\nconsole.log("LOADER_JSON " + JSON.stringify({ version: cm && cm.version, hasRun: typeof (cm && cm.run) }));';

if (!isCurrent) {
  const skipped = {
    host: os.hostname(), account: chosen.id, accountRoot: chosen.root, loader,
    ok: null, skipped: 'not the current account: the CLI session is guarded to its own account root',
  };
  console.log(asJson ? JSON.stringify(skipped, null, 2)
    : os.hostname() + ' account ' + chosen.id + ': skipped, the CLI runs as the current account only');
  process.exit(0);
}

const out = await new Promise((resolve) => {
  const child = spawn('aside', ['repl', PROGRAM], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('error', (e) => resolve({ stdout, stderr: String(e.message) }));
  child.on('close', () => resolve({ stdout, stderr }));
});

const line = out.stdout.split('\n').find((l) => l.includes('LOADER_JSON '));
let data = null;
if (line) { try { data = JSON.parse(line.slice(line.indexOf('LOADER_JSON ') + 'LOADER_JSON '.length)); } catch { data = null; } }

const ok = Boolean(data) && data.version === HELPER_VERSION && data.hasRun === 'function';
const report = {
  host: os.hostname(), platform: process.platform, account: chosen.id, accountRoot: chosen.root,
  loader, loaded: data, expected: HELPER_VERSION, ok,
  error: ok ? null : (out.stderr || out.stdout).slice(-400),
};
console.log(asJson ? JSON.stringify(report, null, 2) : (ok
  ? report.host + ' account ' + chosen.id + ': the documented line loaded cm ' + data.version
  : report.host + ' account ' + chosen.id + ': FAILED - ' + report.error));
process.exit(ok ? 0 : 1);
