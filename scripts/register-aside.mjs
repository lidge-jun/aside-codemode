// Thin CLI: AGENTS-first register. Exit 2 only if the primary AGENTS write failed.
//
// Registers into every Aside account profile on this machine, current account
// first, because the CLI runs as whichever id accounts.json calls current and
// that is not always u/0.
//
//   node scripts/register-aside.mjs                 register the AGENTS block
//   node scripts/register-aside.mjs --launcher      also write ~/.local/bin/codemode
//   node scripts/register-aside.mjs --browse        opt this machine into browsing
//   ASIDE_ACCOUNT=1,3 node scripts/register-aside.mjs   narrow to those ids
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRegister } from '../src/register.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const override = process.env.CODEMODE_REPO_ROOT;
const argv = process.argv.slice(2);
const accountEnv = process.env.ASIDE_ACCOUNT;

const r = applyRegister({
  asideHome: process.env.ASIDE_HOME ?? path.join(os.homedir(), '.aside'),
  repoRoot: override && override.length ? override : repoRoot,
  execPath: process.execPath,
  homedir: os.homedir(),
  xdgConfigHome: process.env.XDG_CONFIG_HOME,
  asideAccounts: accountEnv ? accountEnv.split(',') : undefined,
  launcher: argv.includes('--launcher'),
  enableBrowse: argv.includes('--browse'),
});

// The per-account summary goes to stderr so stdout stays parseable JSON.
for (const a of r.accounts ?? []) {
  const marks = [a.current ? 'CURRENT' : 'other  '];
  marks.push(a.agentsOk ? 'agents=' + a.agentsBytes + 'B' : 'agents=FAILED(' + a.agentsError + ')');
  if (a.settingsOk) marks.push('mcp=written');
  else if (a.settingsSkipped) marks.push('mcp=skipped');
  else marks.push('mcp=no(' + a.settingsError + ')');
  console.error('account u/' + a.id + '  ' + marks.join('  '));
}
if (r.accountsTruncated) {
  console.error('warning: more than 32 account roots resolved; only the first 32 were written');
}
if (r.launcher) {
  const l = r.launcher;
  console.error('launcher ' + (l.ok ? 'ok' : 'FAILED') + ' ' + l.path
    + (l.backedUp ? ' (previous file backed up to ' + l.backedUp + ')' : '')
    + (l.error ? ' ' + l.error : ''));
}
if (r.settingsError && !r.settingsOk) {
  console.error('warning: MCP settings not updated (' + r.settingsError + ')');
}
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 2);
