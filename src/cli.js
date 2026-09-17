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
import { readFileSync, readdirSync } from 'node:fs';
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

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}
function has(name) {
  return argv.includes(name);
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

// Startup failures used to escape as raw node stack traces (a Windows root in
// a committed config crashed the macOS CLI with a realpath ENOENT dump).
// Every exit path now emits the same {ok:false,error} envelope the guest uses,
// so a caller parses one shape no matter where it broke.
function fail(error, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error, ...extra }) + '\n');
  process.exit(1);
}

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

let config;
try {
  config = loadConfig(argv);
} catch (e) {
  fail(`config: ${e.message}`);
}

let workCwd;
try {
  workCwd = resolveCwd({ argv });
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

const MCP_SERVER = 'aside-codemode';
const MCP_ACCOUNT_LIMIT = 32;
const MCP_NEXT = 'Open Aside Settings > Plugins & MCPs > MCPs, select the aside-codemode server, use Refresh tools, then start a NEW Aside session.';
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
  console.error("usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N] [--cwd <dir>]");
  console.error('       node src/cli.js --code-file <path>   # safest: no shell quoting');
  console.error('       node src/cli.js --code - < script.js  # same, via stdin');
    console.error('       node src/cli.js --doctor [--browse] [--config <file>] [--cwd <dir>]');
  console.error('       node src/cli.js --enable-browse      # turns browse on in your user config');
  process.exit(2);
}

let timeoutMs;
try {
  const requested = has('--timeout-ms') ? requireInteger('--timeout-ms', Number(flag('--timeout-ms'))) : 30000;
  timeoutMs = Math.min(requested, config.maxTimeoutMs);
} catch (e) { fail(e.message); }
const out = await runCode(code, { timeoutMs, globals, maxResultBytes: config.maxResultBytes });
process.stdout.write(JSON.stringify(out) + '\n');
process.exitCode = out.ok ? 0 : 1;
