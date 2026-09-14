// Register writes AGENTS.md first. MCP settings merge is leftover hygiene
// and must not gate success.
//
// One Aside install can hold several account profiles under <asideHome>/u/<id>,
// and the CLI runs as whichever id accounts.json calls current. Registering only
// into u/0 was a coin flip: right on a machine where the real account is id 0,
// silently wrong on a machine where it is id 1.
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync,
  readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { userConfigPath } from './config.js';

const START = '<!-- aside-codemode:start -->';
const END = '<!-- aside-codemode:end -->';

// A corrupt accounts.json listing hundreds of ids should report, not fan out.
export const MAX_ACCOUNT_ROOTS = 32;

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

function msg(e) {
  return String(e && e.message ? e.message : e);
}

function mergeMachineConfig({ existing, homedir, accountRoot, repoRoot, enableBrowse }) {
  const roots = [homedir];
  if (accountRoot !== homedir && !accountRoot.startsWith(homedir + path.sep)) roots.push(accountRoot);
  const config = existing && typeof existing === 'object' ? { ...existing } : {};
  config.roots = roots;
  if (!Array.isArray(config.excludeGlobs)) config.excludeGlobs = DEFAULT_EXCLUDES.slice();
  // Browsing stays opt-in per machine (browseCaps.enabled defaults to false), so a
  // fleet install has to say so out loud rather than flip the default in code.
  if (enableBrowse) {
    const caps = config.browseCaps && typeof config.browseCaps === 'object' ? { ...config.browseCaps } : {};
    caps.enabled = true;
    config.browseCaps = caps;
  }
  if (process.platform !== 'win32' && typeof config.rgPath === 'string' && config.rgPath.toLowerCase().endsWith('.exe')) {
    config.rgPath = null;
  } else if (process.platform === 'win32' && !config.rgPath && existsSync(path.join(repoRoot, 'bin', 'rg.exe'))) {
    config.rgPath = 'bin/rg.exe';
  }
  return config;
}

export function upsertAgents(existing, block) {
  const wrapped = START + '\n' + block.trim() + '\n' + END + '\n';
  if (!existing) return wrapped;
  const start = existing.indexOf(START);
  if (start === -1) return existing.replace(/\s*$/, '\n\n') + wrapped;
  const end = existing.indexOf(END, start);
  if (end === -1) return existing.slice(0, start) + wrapped;
  return existing.slice(0, start) + wrapped + existing.slice(end + END.length).replace(/^\n/, '');
}

/**
 * Every Aside account profile on this machine, current account first.
 *
 * Sources, unioned: accounts.json (currentAccountId plus every accounts[].id)
 * and a directory scan of <asideHome>/u for all-digit names. Either source may
 * be missing or malformed; that is not an error. An empty union falls back to
 * '0' so a fresh machine behaves exactly as before.
 */
export function listAccountRoots({ asideHome, only } = {}) {
  const ids = [];
  const push = (v) => {
    if (v === null || v === undefined) return;
    const s = String(v);
    if (!/^\d+$/.test(s)) return;
    if (!ids.includes(s)) ids.push(s);
  };

  let current = null;
  try {
    const raw = readJson(path.join(asideHome, 'accounts.json'));
    const cur = raw && raw.currentAccountId;
    if (cur !== null && cur !== undefined && /^\d+$/.test(String(cur))) current = String(cur);
    if (raw && Array.isArray(raw.accounts)) {
      for (const a of raw.accounts) push(a && a.id);
    }
  } catch { /* missing or malformed: the directory scan still stands */ }

  try {
    for (const entry of readdirSync(path.join(asideHome, 'u'), { withFileTypes: true })) {
      if (entry.isDirectory()) push(entry.name);
    }
  } catch { /* no u/ directory yet */ }

  push(current);

  let ordered = ids.slice().sort((a, b) => Number(a) - Number(b));
  if (ordered.length === 0) ordered = [current === null ? '0' : current];
  if (current !== null && ordered.includes(current)) {
    ordered = [current].concat(ordered.filter((x) => x !== current));
  }

  if (Array.isArray(only) && only.length) {
    const want = only.map(String).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
    if (want.length) {
      const narrowed = ordered.filter((x) => want.includes(x));
      // An explicit request for an id with no directory yet still wins: the
      // caller is telling us where Aside will look.
      ordered = narrowed.length ? narrowed : want;
    }
  }

  const truncated = ordered.length > MAX_ACCOUNT_ROOTS;
  if (truncated) ordered = ordered.slice(0, MAX_ACCOUNT_ROOTS);

  const primaryId = current !== null && ordered.includes(current) ? current : ordered[0];
  return {
    truncated,
    roots: ordered.map((id) => ({
      id,
      root: path.join(asideHome, 'u', id),
      current: id === primaryId,
    })),
  };
}

function hasCodemodeServer(settingsPath) {
  try {
    const s = readJson(settingsPath);
    return Boolean(s && s.mcp && s.mcp.servers && s.mcp.servers['aside-codemode']);
  } catch {
    return false;
  }
}

function mergeSettings({ settingsPath, execPath, repoRoot }) {
  if (!existsSync(settingsPath)) {
    return { settingsOk: false, settingsError: 'settings.json not found at ' + settingsPath };
  }
  try {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    copyFileSync(settingsPath, settingsPath + '.bak-' + stamp);
    const settings = readJson(settingsPath);
    settings.mcp = settings.mcp && typeof settings.mcp === 'object' ? settings.mcp : {};
    settings.mcp.servers = settings.mcp.servers && typeof settings.mcp.servers === 'object' ? settings.mcp.servers : {};
    settings.mcp.servers['aside-codemode'] = {
      command: execPath,
      args: [path.join(repoRoot, 'src', 'server.js'), '--config', path.join(repoRoot, 'codemode.config.json')],
    };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    return { settingsOk: true, settingsError: null };
  } catch (e) {
    return { settingsOk: false, settingsError: msg(e) };
  }
}

const LAUNCHER_MARK = 'aside-codemode launcher';

/** A codemode on PATH that does not depend on a global npm prefix existing. */
export function renderPosixLauncher({ node, cli }) {
  return [
    '#!/bin/sh',
    '# ' + LAUNCHER_MARK,
    '# Regenerate with: node scripts/register-aside.mjs --launcher',
    'exec "' + node + '" "' + cli + '" "$@"',
    '',
  ].join('\n');
}

export function renderWindowsLauncher({ node, cli }) {
  return [
    '@echo off',
    'rem ' + LAUNCHER_MARK,
    '"' + node + '" "' + cli + '" %*',
    '',
  ].join('\r\n');
}

/**
 * Write the launcher into <homedir>/.local/bin. That directory is already on
 * PATH wherever the Aside CLI itself lives there, and it needs no npm prefix.
 * An existing file that is not ours is backed up, never silently clobbered, and
 * a symlink is refused rather than followed.
 */
export function installLauncher({ homedir, node, cli, platform = process.platform }) {
  const dir = path.join(homedir, '.local', 'bin');
  const name = platform === 'win32' ? 'codemode.cmd' : 'codemode';
  const target = path.join(dir, name);
  const body = platform === 'win32'
    ? renderWindowsLauncher({ node, cli })
    : renderPosixLauncher({ node, cli });
  try {
    let backedUp = null;
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink()) {
        return { ok: false, path: target, error: 'refusing to overwrite a symlink' };
      }
      let prev = '';
      try { prev = readFileSync(target, 'utf8'); } catch { prev = ''; }
      if (!prev.includes(LAUNCHER_MARK)) {
        backedUp = target + '.bak-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        copyFileSync(target, backedUp);
      }
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, body);
    if (platform !== 'win32') chmodSync(target, 0o755);
    return { ok: true, path: target, backedUp };
  } catch (e) {
    return { ok: false, path: target, error: msg(e) };
  }
}

export function applyRegister({
  asideHome, repoRoot, execPath, homedir, xdgConfigHome,
  asideAccounts, launcher = false, enableBrowse = false, platform = process.platform,
}) {
  const { roots, truncated } = listAccountRoots({ asideHome, only: asideAccounts });
  const primaryRoot = (roots.find((r) => r.current) || roots[0]).root;
  const node = execPath;
  const cli = path.join(repoRoot, 'bin', 'codemode.mjs');
  const userPath = userConfigPath({ XDG_CONFIG_HOME: xdgConfigHome }, homedir);
  const templatePath = path.join(repoRoot, 'templates', 'AGENTS.codemode.md');

  try {
    mkdirSync(path.dirname(userPath), { recursive: true });
    let existing = {};
    if (existsSync(userPath)) {
      try { existing = readJson(userPath); } catch { existing = {}; }
    }
    try {
      writeJson(userPath, mergeMachineConfig({ existing, homedir, accountRoot: primaryRoot, repoRoot, enableBrowse }));
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
      writeJson(repoCfg, mergeMachineConfig({ existing: repoExisting, homedir, accountRoot: primaryRoot, repoRoot, enableBrowse }));
    } catch { /* EACCES or other - continue */ }
  } catch { /* continue to AGENTS */ }

  let body;
  try {
    body = readFileSync(templatePath, 'utf8')
      .replaceAll('{{NODE}}', node)
      .replaceAll('{{CLI}}', cli)
      .replaceAll('{{CWD_HINT}}', '--cwd <abs-project>');
  } catch (e) {
    return {
      ok: false,
      agentsPath: path.join(primaryRoot, 'AGENTS.md'),
      node,
      cli,
      settingsOk: false,
      settingsError: null,
      userConfigPath: userPath,
      accounts: [],
      accountsWritten: 0,
      accountsTruncated: truncated,
      launcher: null,
      error: msg(e),
    };
  }

  const accounts = roots.map(({ id, root, current }) => {
    const agentsPath = path.join(root, 'AGENTS.md');
    const rec = {
      id, root, agentsPath, current,
      agentsOk: false, agentsError: null, agentsBytes: 0,
      settingsOk: false, settingsError: null, settingsSkipped: false,
    };
    try {
      mkdirSync(root, { recursive: true });
      const prev = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
      const next = upsertAgents(prev, body);
      writeFileSync(agentsPath, next);
      rec.agentsOk = true;
      rec.agentsBytes = Buffer.byteLength(next);
    } catch (e) {
      rec.agentsError = msg(e);
      return rec;
    }

    // Blast radius: an MCP server entry is a real change to a profile we do not
    // own. Write it where Aside is actually running, and where a previous run
    // already left one. Everywhere else gets only the markered AGENTS block.
    const settingsPath = path.join(root, 'settings.json');
    if (!current && !hasCodemodeServer(settingsPath)) {
      rec.settingsSkipped = true;
      rec.settingsError = 'skipped: not the current account and no existing aside-codemode entry';
      return rec;
    }
    const merged = mergeSettings({ settingsPath, execPath, repoRoot });
    rec.settingsOk = merged.settingsOk;
    rec.settingsError = merged.settingsError;
    return rec;
  });

  const primary = accounts.find((a) => a.current) || accounts[0];
  const launcherResult = launcher ? installLauncher({ homedir, node, cli, platform }) : null;
  const accountsWritten = accounts.filter((a) => a.agentsOk).length;

  if (!primary || !primary.agentsOk) {
    return {
      ok: false,
      agentsPath: primary ? primary.agentsPath : path.join(primaryRoot, 'AGENTS.md'),
      node,
      cli,
      settingsOk: false,
      settingsError: primary ? primary.settingsError : null,
      userConfigPath: userPath,
      accounts,
      accountsWritten,
      accountsTruncated: truncated,
      launcher: launcherResult,
      error: primary ? primary.agentsError : 'no account root resolved',
    };
  }

  return {
    ok: true,
    agentsPath: primary.agentsPath,
    node,
    cli,
    settingsOk: primary.settingsOk,
    settingsError: primary.settingsError,
    userConfigPath: userPath,
    accounts,
    accountsWritten,
    accountsTruncated: truncated,
    launcher: launcherResult,
  };
}
