// Register aside-codemode into Aside's account settings (020 D1).
// - backup first (failure = UNSAFE abort) - merge only mcp.servers['aside-codemode']
// - write codemode.config.json roots [accountRoot, devRoot(if exists)] - idempotent
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asideHome = process.env.ASIDE_HOME ?? path.join(os.homedir(), '.aside');
const accountRoot = path.join(asideHome, 'u', '0');
const settingsPath = path.join(accountRoot, 'settings.json');

if (!existsSync(settingsPath)) {
  console.error(`UNSAFE: settings.json not found at ${settingsPath}`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backupPath = `${settingsPath}.bak-${stamp}`;
try {
  copyFileSync(settingsPath, backupPath);
} catch (e) {
  console.error(`UNSAFE: backup failed: ${e.message}`);
  process.exit(2);
}

let settings;
try {
  settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
} catch (e) {
  console.error(`ABORT: settings.json does not parse, left untouched (${e.message})`);
  process.exit(1);
}

settings.mcp = settings.mcp && typeof settings.mcp === 'object' ? settings.mcp : {};
settings.mcp.servers = settings.mcp.servers && typeof settings.mcp.servers === 'object' ? settings.mcp.servers : {};
settings.mcp.servers['aside-codemode'] = {
  command: process.execPath,
  args: [path.join(repoRoot, 'src', 'server.js'), '--config', path.join(repoRoot, 'codemode.config.json')],
};
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

// roots: the home directory, so anything the user owns is reachable without
// editing config every time a new project dir appears. The cost of a wide root
// is paid by excludeGlobs (Library/caches are pruned), not by a narrow root:
// measured 336,206 files / 0.53s pruned vs 1,565,196 / 7.8s unpruned.
// The account root is added separately because it can live outside $HOME.
const home = os.homedir();
const roots = [home];
if (!accountRoot.startsWith(home + path.sep)) roots.push(accountRoot);
const configPath = path.join(repoRoot, 'codemode.config.json');
// codemode.config.json is machine-specific and gitignored. Seed it from the
// committed example on a fresh clone so registration works without a manual
// copy step (a clone used to inherit another OS's roots and crash on start).
const examplePath = path.join(repoRoot, 'codemode.config.example.json');
let config = {};
if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'));
else if (existsSync(examplePath)) config = JSON.parse(readFileSync(examplePath, 'utf8'));
config.roots = roots;
if (!Array.isArray(config.excludeGlobs)) {
  config.excludeGlobs = ['Library', 'node_modules', '.Trash', '.cache', '.npm', '.gradle', 'Caches', 'chrome-debug-profile*', 'Pictures', 'Movies', 'Music'];
}
// The vendored bin/rg.exe only runs on Windows. On macOS clear rgPath so the
// resolver walks its normal ladder (PATH, Homebrew locations).
if (process.platform !== 'win32' && typeof config.rgPath === 'string' && config.rgPath.toLowerCase().endsWith('.exe')) {
  config.rgPath = null;
} else if (process.platform === 'win32' && !config.rgPath && existsSync(path.join(repoRoot, 'bin', 'rg.exe'))) {
  config.rgPath = 'bin/rg.exe';
}
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

console.log(JSON.stringify({ ok: true, backup: backupPath, server: settings.mcp.servers['aside-codemode'], roots }, null, 2));
