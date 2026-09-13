// Register writes AGENTS.md first. MCP settings merge is leftover hygiene
// and must not gate success.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { userConfigPath } from './config.js';

const START = '<!-- aside-codemode:start -->';
const END = '<!-- aside-codemode:end -->';

const DEFAULT_EXCLUDES = [
  'Library', 'node_modules', '.Trash', '.cache', '.npm', '.gradle',
  'Caches', 'chrome-debug-profile*', 'Pictures', 'Movies', 'Music',
];

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function mergeMachineConfig({ existing, homedir, accountRoot, repoRoot }) {
  const roots = [homedir];
  if (accountRoot !== homedir && !accountRoot.startsWith(homedir + path.sep)) roots.push(accountRoot);
  const config = existing && typeof existing === 'object' ? { ...existing } : {};
  config.roots = roots;
  if (!Array.isArray(config.excludeGlobs)) config.excludeGlobs = DEFAULT_EXCLUDES.slice();
  if (process.platform !== 'win32' && typeof config.rgPath === 'string' && config.rgPath.toLowerCase().endsWith('.exe')) {
    config.rgPath = null;
  } else if (process.platform === 'win32' && !config.rgPath && existsSync(path.join(repoRoot, 'bin', 'rg.exe'))) {
    config.rgPath = 'bin/rg.exe';
  }
  return config;
}

export function upsertAgents(existing, block) {
  const wrapped = `${START}\n${block.trim()}\n${END}\n`;
  if (!existing) return wrapped;
  const start = existing.indexOf(START);
  if (start === -1) return existing.replace(/\s*$/, '\n\n') + wrapped;
  const end = existing.indexOf(END, start);
  if (end === -1) return existing.slice(0, start) + wrapped;
  return existing.slice(0, start) + wrapped + existing.slice(end + END.length).replace(/^\n/, '');
}

export function applyRegister({ asideHome, repoRoot, execPath, homedir, xdgConfigHome }) {
  const accountRoot = path.join(asideHome, 'u', '0');
  const settingsPath = path.join(accountRoot, 'settings.json');
  const agentsPath = path.join(accountRoot, 'AGENTS.md');
  const node = execPath;
  const cli = path.join(repoRoot, 'bin', 'codemode.mjs');
  const userPath = userConfigPath({ XDG_CONFIG_HOME: xdgConfigHome }, homedir);
  const templatePath = path.join(repoRoot, 'templates', 'AGENTS.codemode.md');

  let settingsOk = false;
  let settingsError = null;

  try {
    mkdirSync(path.dirname(userPath), { recursive: true });
    let existing = {};
    if (existsSync(userPath)) {
      try { existing = readJson(userPath); } catch { existing = {}; }
    }
    try {
      writeJson(userPath, mergeMachineConfig({ existing, homedir, accountRoot, repoRoot }));
    } catch { /* continue to AGENTS */ }

    const repoCfg = path.join(repoRoot, 'codemode.config.json');
    const example = path.join(repoRoot, 'codemode.config.example.json');
    let repoExisting = {};
    if (existsSync(repoCfg)) {
      try { repoExisting = readJson(repoCfg); } catch { repoExisting = {}; }
    } else if (existsSync(example)) {
      try { repoExisting = readJson(example); } catch { repoExisting = {}; }
    }
    try {
      writeJson(repoCfg, mergeMachineConfig({ existing: repoExisting, homedir, accountRoot, repoRoot }));
    } catch { /* EACCES or other — continue */ }
  } catch { /* continue to AGENTS */ }

  try {
    mkdirSync(accountRoot, { recursive: true });
    const body = readFileSync(templatePath, 'utf8')
      .replaceAll('{{NODE}}', node)
      .replaceAll('{{CLI}}', cli)
      .replaceAll('{{CWD_HINT}}', '--cwd <abs-project>');
    const prev = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
    writeFileSync(agentsPath, upsertAgents(prev, body));
  } catch (e) {
    return {
      ok: false,
      agentsPath,
      node,
      cli,
      settingsOk: false,
      settingsError,
      userConfigPath: userPath,
      error: String(e && e.message ? e.message : e),
    };
  }

  try {
    if (!existsSync(settingsPath)) {
      settingsError = `settings.json not found at ${settingsPath}`;
    } else {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      copyFileSync(settingsPath, `${settingsPath}.bak-${stamp}`);
      const settings = readJson(settingsPath);
      settings.mcp = settings.mcp && typeof settings.mcp === 'object' ? settings.mcp : {};
      settings.mcp.servers = settings.mcp.servers && typeof settings.mcp.servers === 'object' ? settings.mcp.servers : {};
      settings.mcp.servers['aside-codemode'] = {
        command: execPath,
        args: [path.join(repoRoot, 'src', 'server.js'), '--config', path.join(repoRoot, 'codemode.config.json')],
      };
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      settingsOk = true;
    }
  } catch (e) {
    settingsOk = false;
    settingsError = String(e && e.message ? e.message : e);
  }

  return { ok: true, agentsPath, node, cli, settingsOk, settingsError, userConfigPath: userPath };
}
