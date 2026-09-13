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

// roots: account root + a developer root when one exists
const devCandidates = [path.join(os.homedir(), 'Developers'), path.join(os.homedir(), 'Developer'), path.join(os.homedir(), 'developer')];
const devRoot = devCandidates.find((d) => existsSync(d));
const roots = devRoot ? [accountRoot, devRoot] : [accountRoot];
const configPath = path.join(repoRoot, 'codemode.config.json');
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
config.roots = roots;
// The vendored bin/rg.exe only runs on Windows. On macOS clear rgPath so the
// resolver walks its normal ladder (PATH, Homebrew locations).
if (process.platform !== 'win32' && typeof config.rgPath === 'string' && config.rgPath.endsWith('.exe')) {
  config.rgPath = null;
}
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

console.log(JSON.stringify({ ok: true, backup: backupPath, server: settings.mcp.servers['aside-codemode'], roots }, null, 2));
