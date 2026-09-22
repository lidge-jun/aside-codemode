// One-shot CLI: same execute_code semantics as the MCP tool, for hosts whose
// agent can only run shell commands (aside exec's bash tool).
// usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N]
//        node src/cli.js --code-file <path> [--config <file>] [--timeout-ms N]
//        node src/cli.js --code - < script.js
//        node src/cli.js --doctor [--config <file>]
//
// --code-file and stdin exist because `--code '<js>'` is a quoting trap. Guest code almost
// always contains quotes of its own, and a url like 'https://x' closes the agent's outer
// single quote early: bash then waits forever for the quote that never arrives and the tool
// call HANGS. (PowerShell does not hang; it mangles the argument into a parse error
// instead.) Both were observed from a real Aside agent on 2026-09-14. Anything with a quote
// in it should go through --code-file or stdin.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { makeRootGuard } from './paths.js';
import { resolveCwd } from './host/cwd.js';
import { createDetailedRgResolver, getAsideBundledRgPath } from './rg.js';
import { createHostGlobals } from './host/globals.js';
import { runCode } from './sandbox.js';
import { requireInteger } from './execution-output.js';
import { parseCliArgs, assertCliArgs } from './cli-args.js';
import { browseContextReport, mergeBrowseContext, normalizeAccount, normalizeHost } from './host/browse/context.js';

const argv = process.argv.slice(2);
let parsedArgv;
function flag(name) { return parsedArgv.value(name); }
function has(name) { return parsedArgv.has(name); }

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

// Declared up here because --install-mcp runs before the config is loaded, and it names the
// same server the doctor reports on. One spelling, one place.
const MCP_SERVER = 'aside-codemode';

// Startup failures used to escape as raw node stack traces (a Windows root in
// a committed config crashed the macOS CLI with a realpath ENOENT dump).
// Every exit path now emits the same {ok:false,error} envelope the guest uses,
// so a caller parses one shape no matter where it broke.
function fail(error, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error, ...extra }) + '\n');
  process.exit(1);
}

try {
  parsedArgv = parseCliArgs(argv);
  assertCliArgs(parsedArgv);
}
catch (e) { fail(e.message, { code: 'EBADARGV' }); }

// Before the config is loaded, on purpose. The file this command exists to fix is one of the
// files loadConfig reads, so a broken one would block the only easy way to repair it.
if (has('--enable-browse')) {
  const { enableBrowse } = await import('./enable-browse.js');
  try {
    const result = enableBrowse({ env: process.env });
    if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.alreadyEnabled
        ? 'browsing was already on (' + result.path + ')'
        : 'browsing is on; wrote browseCaps.enabled to ' + result.path);
    }
    process.exit(0);
  } catch (e) {
    fail(e.message, { code: e.code ?? null });
  }
}

// Also before the config load, and for the same reason: this is the command that puts the
// MCP server in front of Aside, and a config it would go on to fix must not stop it.
//
// MCP is the first-class surface, so registration is one command with no editor and no
// settings window. AGENTS.md and the skill template are deliberately untouched here: the
// tool arrives as a tool, and a machine that only wants MCP installs only MCP.
if (has('--install-mcp')) {
  const { activateMcp, normalizedServerEntry, normalizeAccount, planActivation } = await import('./activate.js');
  const { listAccountRoots } = await import('./register.js');
  const { spawnSync } = await import('node:child_process');
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const asideHome = process.env.ASIDE_HOME ?? path.join(os.homedir(), '.aside');
  // An unusable --account used to be ignored, and listAccountRoots then fell back to the
  // current profile: "codemode --install-mcp --account nope" reported success against an
  // account the caller never named. A flag whose value is the next flag is the same trap.
  let requested = null;
  if (has('--account')) {
    requested = flag('--account');
    if (!requested || requested.startsWith('--')) fail('--account needs an account id, for example --account u1');
    if (!/^u?\d+$/.test(requested)) fail('--account must be an Aside profile id like u1, not ' + JSON.stringify(requested));
  }
  const { roots } = listAccountRoots({
    asideHome,
    only: requested ? [String(requested).replace(/^u/, '')] : undefined,
  });
  const target = roots[0];
  const entry = normalizedServerEntry({ execPath: process.execPath, repoRoot });
  const settingsPath = path.join(target.root, 'settings.json');
  // Aside writes settings.json for every profile it has opened, so its absence means this
  // is not a profile the daemon can activate. Naming one explicitly deserves that answer
  // rather than a daemon round trip that quietly configures a different account.
  if (requested && !existsSync(settingsPath)) {
    fail('account u' + target.id + ' has no settings.json at ' + settingsPath + '; open that profile in Aside once, or drop --account to use the current one');
  }

  const run = (cmd, args) => {
    const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return {
      code: res.status,
      stdout: res.stdout ?? '',
      // A spawn that never started has no stderr, and dropping res.error left the caller
      // with "aside repl failed" and no way to learn the CLI was not on PATH.
      stderr: res.error ? String(res.error.message) : (res.stderr ?? ''),
      cliMissing: Boolean(res.error && res.error.code === 'ENOENT'),
    };
  };
  // The proof of activation is the cached inventory Aside wrote, not our own report of
  // having asked for it.
  let backupPath = null;
  const readInventory = () => {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const inv = settings && settings.mcp && settings.mcp.inventories
        ? settings.mcp.inventories[MCP_SERVER] : null;
      return inv && Array.isArray(inv.tools) ? inv.tools.map((t) => t && t.name).filter(Boolean) : [];
    } catch { return []; }
  };
  // Aside finishes its migration after the session process is gone, so the restore has to wait
  // for the version key to come back before it can see what was switched off.
  const readState = () => {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const mcp = (settings && settings.mcp) || {};
      return {
        version: Object.prototype.hasOwnProperty.call(mcp, 'toolInventoryMigrationVersion') ? mcp.toolInventoryMigrationVersion : null,
        servers: Object.keys(mcp.servers || {}),
        inventories: Object.keys(mcp.inventories || {}),
        refreshedAt: mcp.inventories && mcp.inventories[MCP_SERVER] ? mcp.inventories[MCP_SERVER].refreshedAt || null : null,
      };
    } catch { return null; }
  };

  const result = await activateMcp({
    server: MCP_SERVER,
    entry,
    account: normalizeAccount(target.id),
    asideCli: process.env.CODEMODE_ASIDE_CLI || 'aside',
    force: has('--force'),
    discover: !has('--no-discovery'),
    run,
    readInventory,
    readState,
    onSnapshot: (snapshot) => {
      // The daemon just handed over the only copy of what this account looked like. It goes
      // next to the settings file, under the same .bak convention the file-path installer
      // already uses, so a crash between here and the restore still leaves a way back.
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      backupPath = settingsPath + '.codemode-bak-' + stamp;
      writeFileSync(backupPath, JSON.stringify({ mcp: snapshot }, null, 2) + String.fromCharCode(10));
    },
  });
  const report = { ...result, account: 'u' + target.id, settingsPath, backupPath, server: MCP_SERVER, entry };
  if (has('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log((report.ok ? 'ok' : 'failed') + ': ' + MCP_SERVER + ' on account u' + target.id);
    if (Array.isArray(report.tools)) console.log('cached tools: ' + (report.tools.join(', ') || '(none)'));
    if (report.restored && report.restored.length) console.log('switched back on: ' + report.restored.join(', '));
    if (report.lostInventories && report.lostInventories.length) {
      console.log('these servers lost their cached tools and will be rediscovered on their next session: ' + report.lostInventories.join(', '));
    }
    if (report.rolledBack) console.log('the account was rolled back to the state in ' + backupPath);
    if (report.error) console.error('error: ' + report.error + (report.detail ? ' - ' + report.detail : ''));
    if (report.blocked) {
      console.error('other MCP servers would be reset by this write: ' + [...new Set([...(report.atRisk || []), ...(report.cached || [])])].join(', '));
      console.error('re-run with --force to accept that, or register from Aside Settings > Plugins & MCPs > MCPs instead.');
      console.error('the two commands this would have run:');
      for (const step of planActivation({ account: normalizeAccount(target.id), server: MCP_SERVER, entry, force: true })) {
        console.error('  ' + step.cmd + ' ' + step.args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' '));
      }
    }
    if (report.next) console.log('next: ' + report.next);
  }
  process.exit(report.ok ? 0 : 1);
}

const executionMode = has('--code') || has('--code-file');

let config;
try {
  config = loadConfig(parsedArgv.argvFor(['--config']));
} catch (e) {
  fail(`config: ${e.message}`);
}

if (executionMode) {
  try {
    const override = {};
    if (has('--account')) override.account = normalizeAccount(flag('--account'), '--account');
    if (has('--host')) override.host = normalizeHost(flag('--host'), '--host');
    config.browseContext = mergeBrowseContext(config.browseContext, override);
    config._browseContextSources = Object.freeze({
      ...config._browseContextSources,
      ...(override.account ? { account: 'cli-override' } : {}),
      ...(override.host ? { host: 'cli-override' } : {}),
    });
  } catch (e) {
    fail(e.message, { code: e.code || 'EBADCONTEXT' });
  }
}

let workCwd;
try {
  workCwd = resolveCwd({ argv: parsedArgv.argvFor(['--cwd']) });
} catch (e) {
  fail(e.message);
}


let assertInside;
try {
  assertInside = makeRootGuard(config.roots, { cwd: workCwd });
} catch (e) {
  fail(e.message, { code: e.code ?? null });
}

const rgResolver = createDetailedRgResolver(config);
const globals = signal => createHostGlobals(config, assertInside, signal);

const MCP_ACCOUNT_LIMIT = 32;
// The one command comes first because it is the whole step. The settings window is the
// fallback for a machine with other MCP servers, where --install-mcp refuses on purpose.
const MCP_NEXT = 'Run: codemode --install-mcp. It registers the server through the Aside daemon and runs one session so the inventory is cached. If another MCP server is registered it refuses rather than resetting that server; then open Aside Settings > Plugins & MCPs > MCPs, select the aside-codemode server, use Refresh tools, and start a NEW Aside session.';
const MCP_FAILED_DISCOVERY_NEXT = 'Fix the aside-codemode command or config and re-run install. Aside has advanced the migration version, so discovery will not retry on its own.';

function sameResolvedPath(actual, expected) {
  return typeof actual === 'string' && actual.length > 0
    && path.resolve(actual) === path.resolve(expected);
}

function pointsToThisInstallation(entry) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.args)) return false;
  const expectedServer = fileURLToPath(new URL('./server.js', import.meta.url));
  if (!sameResolvedPath(entry.command, process.execPath)
      || !sameResolvedPath(entry.args[0], expectedServer)) return false;

  const configIndex = entry.args.indexOf('--config');
  if (configIndex === -1) return true;
  const expectedConfig = fileURLToPath(new URL('../codemode.config.json', import.meta.url));
  return sameResolvedPath(entry.args[configIndex + 1], expectedConfig);
}

function mcpAccountReport({ id, root }) {
  const base = {
    id,
    settingsReadable: true,
    settingsError: null,
    serverRegistered: false,
    pointsToThisInstallation: null,
    cachedToolCount: 0,
    cachedToolNames: [],
    state: 'not-registered',
  };
  let mcp;
  try {
    ({ mcp } = JSON.parse(readFileSync(path.join(root, 'settings.json'), 'utf8')));
  } catch (e) {
    return {
      ...base,
      settingsReadable: false,
      settingsError: e.message,
      serverRegistered: null,
      next: MCP_NEXT,
    };
  }

  const entry = mcp && typeof mcp === 'object'
    && mcp.servers && typeof mcp.servers === 'object'
    ? mcp.servers[MCP_SERVER]
    : null;
  if (!entry || typeof entry !== 'object') return { ...base, next: MCP_NEXT };

  const inventory = mcp.inventories && typeof mcp.inventories === 'object'
    ? mcp.inventories[MCP_SERVER]
    : null;
  const tools = inventory && typeof inventory === 'object' && Array.isArray(inventory.tools)
    ? inventory.tools
    : [];
  const cachedToolNames = tools
    .map((tool) => typeof tool === 'string' ? tool : tool && tool.name)
    .filter((name) => typeof name === 'string');
  const current = pointsToThisInstallation(entry);
  const disabledAfterFailedDiscovery = entry.enabled === false && !inventory;
  const state = disabledAfterFailedDiscovery
    ? 'disabled-after-failed-discovery'
    : !current
    ? 'stale-entry'
    : tools.length > 0 ? 'activated' : 'registered-not-activated';
  const result = {
    ...base,
    serverRegistered: true,
    pointsToThisInstallation: current,
    cachedToolCount: tools.length,
    cachedToolNames,
    state,
  };
  if (state !== 'activated') {
    result.next = disabledAfterFailedDiscovery ? MCP_FAILED_DISCOVERY_NEXT : MCP_NEXT;
  }
  return result;
}

function mcpDoctorReport(env = process.env) {
  const asideHome = env.ASIDE_HOME || path.join(os.homedir(), '.aside');
  let roots = [];
  let discoveryError = null;
  try {
    roots = readdirSync(path.join(asideHome, 'u'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => Number(a) - Number(b));
  } catch (e) {
    discoveryError = e.message;
  }
  const accountsTruncated = roots.length > MCP_ACCOUNT_LIMIT;
  if (accountsTruncated) roots = roots.slice(0, MCP_ACCOUNT_LIMIT);
  return {
    rgResolution: {
      configuredPath: config.rgPath,
      configuredPathKind: typeof config.rgPath !== 'string'
        ? 'unset' : path.isAbsolute(config.rgPath) ? 'absolute' : 'relative-to-package',
      asideBundledPath: getAsideBundledRgPath(),
      resolvedPath: null,
      resolvedSource: null,
      ok: null,
      warning: null,
    },
    discoveryError,
    accountsTruncated,
    accounts: roots.map((id) => mcpAccountReport({ id, root: path.join(asideHome, 'u', id) })),
  };
}


// `--doctor` answers "why is this not working" without making the caller
// reverse-engineer it from a failed search.
if (has('--doctor')) {
  const report = {
    ok: true,
    node: process.version,
    platform: process.platform,
    cwd: workCwd,
    roots: assertInside.roots,
    missingRoots: assertInside.missingRoots,
    configSources: config._sources,
    rgPath: config.rgPath,
    excludeGlobs: config.excludeGlobs,
    browseContext: browseContextReport(config),
    mcp: mcpDoctorReport(),
  };
  try {
    const resolved = await rgResolver();
    report.rgResolved = resolved.path;
    report.mcp.rgResolution.resolvedPath = resolved.path;
    report.mcp.rgResolution.resolvedSource = resolved.source;
    report.mcp.rgResolution.ok = true;
  } catch (e) {
    report.ok = false;
    report.rgResolved = null;
    report.rgError = e.message;
    report.mcp.rgResolution.ok = false;
    report.mcp.rgResolution.warning = typeof config.rgPath === 'string'
      ? 'The configured rgPath could not be resolved to an executable ripgrep binary.'
      : 'rgPath is unset and no executable ripgrep binary was discoverable in the daemon environment.';
    if (e.candidates) report.rgCandidates = e.candidates;
  }
  // `--doctor --browse` answers "what will Aside actually do" from measurements rather
  // than from its documentation, so a refused option is explainable before it is debugged.
  if (has('--browse')) {
    const { doctorPayload } = await import('./host/browse/probe.js');
    const { createAsideResolver, verifyAside } = await import('./host/browse/resolve.js');
    const resolveAside = createAsideResolver(config, process.env, { verify: (bin) => verifyAside(bin) });
    let resolved = null;
    let asideError = null;
    try {
      resolved = await resolveAside();
    } catch (e) {
      // Not fatal: the matrix is still worth printing, and the candidate list is the
      // actionable part for someone whose install put the CLI somewhere else.
      asideError = { code: e.code, message: e.message, candidates: e.candidates || [] };
    }
    report.browse = doctorPayload(config, resolved, asideError);
    // Issue #20 asks for a navigate/snapshot/screenshot bottleneck report. A static matrix
    // is not that, and printing zeros would read as a fast page — so the measurement is
    // real or it is explicitly absent. Gated because CI must never launch a browser.
    if (process.env.CODEMODE_ASIDE_LIVE === '1' && resolved) {
      const probeUrl = process.env.CODEMODE_ASIDE_LIVE_URL || 'https://example.com';
      try {
        const { createBrowse } = await import('./host/browse/browse.js');
        const live = createBrowse({
          config: { ...config, browseCaps: { ...config.browseCaps, enabled: true } },
        });
        const res = await live.exec({ urls: [probeUrl], snapshot: true, screenshot: {}, timeoutMs: 20000 });
        report.browse.liveProbe = {
          url: probeUrl,
          ok: res.ok,
          byStep: res.timings.byStep,
          slowest: res.timings.slowest,
          totalMs: res.timings.totalMs,
          replMs: res.timings.replMs,
          partial: res.partial,
          leakedUrls: res.leakedUrls,
        };
      } catch (e) {
        report.browse.liveProbe = { url: probeUrl, error: e.message, code: e.code };
      }
    } else {
      report.browse.liveProbe = 'skipped (set CODEMODE_ASIDE_LIVE=1)';
    }
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}

// Three ways in, on purpose. --code is convenient for a one-liner; --code-file and stdin
// are the ones that survive a shell, because guest code carries its own quotes.
let code = null;
const codeFile = flag('--code-file');
if (codeFile) {
  try {
    code = readFileSync(codeFile, 'utf8');
  } catch (e) {
    fail(`--code-file could not be read: ${e.message}`);
  }
} else {
  const inline = flag('--code');
  // `--code -` reads the script from stdin, so nothing has to survive quoting at all.
  code = inline === '-' ? readStdin() : inline;
}
if (!code || !code.trim()) {
  // The name the caller typed. A globally installed bin that tells you to run
  // "node src/cli.js" is telling you about a directory you do not have.
  const self = /(^|[\\/])cli\.js$/.test(process.argv[1] || '') ? 'node src/cli.js' : 'codemode';
  console.error('usage: ' + self + ' --install-mcp [--account u1] [--json]  # MCP: register and activate in one command');
  console.error('       ' + self + " --code '<js>' [--config <file>] [--timeout-ms N] [--cwd <dir>] [--account u1] [--host <host>]");
  console.error('       ' + self + ' --code-file <path>   # safest: no shell quoting');
  console.error('       ' + self + ' --code - < script.js  # same, via stdin');
  console.error('       ' + self + ' --doctor [--browse] [--config <file>] [--cwd <dir>]');
  console.error('       ' + self + ' --enable-browse      # turns browse on in your user config');
  process.exit(2);
}

let timeoutMs;
try {
  const requested = has('--timeout-ms') ? requireInteger('--timeout-ms', Number(flag('--timeout-ms'))) : 30000;
  timeoutMs = Math.min(requested, config.maxTimeoutMs);
} catch (e) { fail(e.message); }
const out = await runCode(code, {
  timeoutMs,
  globals,
  maxResultBytes: config.maxResultBytes,
  resultMeta: { browseContext: browseContextReport(config) },
});
process.stdout.write(JSON.stringify(out) + '\n');
process.exitCode = out.ok ? 0 : 1;
