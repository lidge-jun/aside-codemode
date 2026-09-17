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
import { helperLoadPathFor } from './host/browse/helper-bundle.js';

export { helperLoadPathFor };

const START = '<!-- aside-codemode:start -->';
const END = '<!-- aside-codemode:end -->';

export const MCP_ACTIVATION_REQUIRED = 'Run codemode --install-mcp: it registers the server through the Aside daemon and runs one session so the inventory is cached. It refuses when another MCP server would be reset, and then the manual path is to open Aside Settings > Plugins & MCPs > MCPs, ensure the aside-codemode server is present, use Refresh tools so its inventory is cached, then start a new Aside session. Search actions resolve the ripgrep Aside ships with, so the minimal environment the daemon starts the server in is no longer a blocker; set an absolute rgPath or CODEMODE_RG only if that binary is absent.';
export const MCP_ACTIVATION_PENDING = 'Activation is pending. First make the Aside daemon re-read settings by restarting it when safe or by using Refresh tools in Aside Settings > Plugins & MCPs > MCPs. Then start a new Aside session; that session performs discovery and caches the aside-codemode inventory. The installer does not restart the daemon.';

// One filler for both writers. The installer and register both hand an account the same
// markered block, and 001 found them drifting: a rule fixed in one was still broken in the
// other. {{HELPER}} carries its own quotes because the block is pasted into code and an
// account root may contain an apostrophe, or start with a slash that would otherwise read
// as a regular expression literal.
export function fillTemplate(text, { node, cli, accountRoot }) {
  return text
    .replaceAll('{{NODE}}', node)
    .replaceAll('{{CLI}}', cli)
    .replaceAll('{{HELPER}}', JSON.stringify(helperLoadPathFor(accountRoot)))
    .replaceAll('{{CWD_HINT}}', '--cwd <abs-project>');
}

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
  // Browsing is on by default now, so this flag is a no-op on a fresh config. It stays
  // because a machine that deliberately turned browsing off should be switched back on by
  // an explicit fleet install rather than silently on the next write of this file.
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
    return { settingsOk: false, settingsError: 'settings.json not found at ' + settingsPath, serverEntry: 'absent' };
  }
  try {
    const settings = readJson(settingsPath);
    settings.mcp = settings.mcp && typeof settings.mcp === 'object' ? settings.mcp : {};
    settings.mcp.servers = settings.mcp.servers && typeof settings.mcp.servers === 'object' ? settings.mcp.servers : {};
    const previous = settings.mcp.servers['aside-codemode'];
    const next = {
      ...(previous && typeof previous === 'object' ? previous : {}),
      command: execPath,
      args: [path.join(repoRoot, 'src', 'server.js'), '--config', path.join(repoRoot, 'codemode.config.json')],
    };
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) {
      return { settingsOk: true, settingsError: null, serverEntry: 'unchanged' };
    }
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    copyFileSync(settingsPath, settingsPath + '.bak-' + stamp);
    settings.mcp.servers['aside-codemode'] = next;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    return { settingsOk: true, settingsError: null, serverEntry: 'written' };
  } catch (e) {
    return { settingsOk: false, settingsError: msg(e), serverEntry: 'absent' };
  }
}

/**
 * Register the normalized MCP server and queue Aside's measured legacy discovery path.
 * Discovery is not queued when doing so could disable another enabled, uncached server.
 */
export function configureMcpActivation({ settingsPath, execPath, repoRoot, dryRun = false }) {
  const absent = {
    settingsOk: false,
    settingsError: 'settings.json not found at ' + settingsPath,
    serverEntry: 'absent',
    mcpActivated: false,
    activationPending: false,
    activationPendingReason: null,
    discoveryQueued: false,
    atRiskServers: [],
    activationRequired: MCP_ACTIVATION_REQUIRED,
  };
  if (!existsSync(settingsPath)) return absent;

  try {
    const settings = readJson(settingsPath);
    const mcp = settings.mcp && typeof settings.mcp === 'object' ? settings.mcp : {};
    const servers = mcp.servers && typeof mcp.servers === 'object' ? mcp.servers : {};
    const inventories = mcp.inventories && typeof mcp.inventories === 'object'
      ? mcp.inventories : {};
    const previous = servers['aside-codemode'];
    const inventory = inventories['aside-codemode'];
    const activated = Boolean(inventory && typeof inventory === 'object'
      && Array.isArray(inventory.tools) && inventory.tools.length > 0);
    const atRiskServers = Object.entries(servers)
      .filter(([name, entry]) => name !== 'aside-codemode'
        && entry && typeof entry === 'object' && entry.enabled === true
        && !inventories[name])
      .map(([name]) => name)
      .sort();
    const unrelatedInventories = Object.keys(inventories)
      .filter((name) => name !== 'aside-codemode');
    const normalized = {
      enabled: true,
      transport: 'stdio',
      command: execPath,
      args: [path.join(repoRoot, 'src', 'server.js'), '--config', path.join(repoRoot, 'codemode.config.json')],
      env: {},
    };

    settings.mcp = mcp;
    mcp.servers = servers;
    servers['aside-codemode'] = normalized;

    // The proven migration requires both keys to be absent. Never delete another
    // server's cached inventory merely to reach that state; manual Refresh tools is
    // the safe path for an account that already owns such caches.
    const canQueue = !activated && atRiskServers.length === 0 && unrelatedInventories.length === 0;
    if (canQueue) {
      delete mcp.toolInventoryMigrationVersion;
      delete mcp.inventories;
    }

    const changed = JSON.stringify(settings) !== JSON.stringify(readJson(settingsPath));
    if (changed && !dryRun) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      copyFileSync(settingsPath, settingsPath + '.bak-' + stamp);
      writeJson(settingsPath, settings);
    }
    const serverEntry = previous && JSON.stringify(previous) === JSON.stringify(normalized)
      ? 'unchanged' : 'written';
    let activationRequired = null;
    if (canQueue) {
      activationRequired = MCP_ACTIVATION_PENDING;
    } else if (!activated) {
      const risk = atRiskServers.length
        ? ' Triggering automatic discovery could disable these enabled servers: ' + atRiskServers.join(', ') + '.'
        : ' Automatic discovery was not queued because existing MCP inventories must be preserved.';
      activationRequired = MCP_ACTIVATION_REQUIRED + risk;
    }
    return {
      settingsOk: true,
      settingsError: null,
      serverEntry,
      mcpActivated: activated,
      activationPending: canQueue,
      activationPendingReason: canQueue
        ? 'daemon-settings-reread-required'
        : !activated ? 'manual-refresh-required' : null,
      discoveryQueued: canQueue,
      atRiskServers,
      activationRequired,
    };
  } catch (e) {
    return { ...absent, settingsError: msg(e) };
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

  // Read once, fill per account. The helper path is the account root's own, so a template
  // filled once outside the loop would stamp one account's path onto every other account.
  let template;
  try {
    template = readFileSync(templatePath, 'utf8');
  } catch (e) {
    return {
      ok: false,
      agentsPath: path.join(primaryRoot, 'AGENTS.md'),
      node,
      cli,
      settingsOk: false,
      settingsError: null,
      serverEntry: 'absent',
      mcpActivated: false,
      activationRequired: MCP_ACTIVATION_REQUIRED,
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
      serverEntry: 'absent', mcpActivated: false,
      activationRequired: MCP_ACTIVATION_REQUIRED,
    };
    try {
      mkdirSync(root, { recursive: true });
      const body = fillTemplate(template, { node, cli, accountRoot: root });
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
    rec.serverEntry = merged.serverEntry;
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
      serverEntry: primary ? primary.serverEntry : 'absent',
      mcpActivated: false,
      activationRequired: MCP_ACTIVATION_REQUIRED,
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
    serverEntry: primary.serverEntry,
    mcpActivated: false,
    activationRequired: MCP_ACTIVATION_REQUIRED,
    userConfigPath: userPath,
    accounts,
    accountsWritten,
    accountsTruncated: truncated,
    launcher: launcherResult,
  };
}
