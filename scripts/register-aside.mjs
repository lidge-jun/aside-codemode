// Thin CLI: AGENTS-first register. Exit 2 only if AGENTS write failed.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRegister } from '../src/register.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const override = process.env.CODEMODE_REPO_ROOT;
const r = applyRegister({
  asideHome: process.env.ASIDE_HOME ?? path.join(os.homedir(), '.aside'),
  repoRoot: override && override.length ? override : repoRoot,
  execPath: process.execPath,
  homedir: os.homedir(),
  xdgConfigHome: process.env.XDG_CONFIG_HOME,
});
if (r.settingsError && !r.settingsOk) {
  console.error(`warning: MCP settings not updated (${r.settingsError})`);
}
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 2);
