// One-shot CLI: same execute_code semantics as the MCP tool, for hosts whose
// agent can only run shell commands (aside exec's bash tool).
// usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N]
//        node src/cli.js --doctor [--config <file>]
import { loadConfig } from './config.js';
import { makeRootGuard } from './paths.js';
import { resolveCwd } from './host/cwd.js';
import { createRgResolver } from './rg.js';
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

// Startup failures used to escape as raw node stack traces (a Windows root in
// a committed config crashed the macOS CLI with a realpath ENOENT dump).
// Every exit path now emits the same {ok:false,error} envelope the guest uses,
// so a caller parses one shape no matter where it broke.
function fail(error, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error, ...extra }) + '\n');
  process.exit(1);
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

const rgResolver = createRgResolver(config);
const globals = signal => createHostGlobals(config, assertInside, signal);

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
  };
  try {
    report.rgResolved = await rgResolver();
  } catch (e) {
    report.ok = false;
    report.rgResolved = null;
    report.rgError = e.message;
    if (e.candidates) report.rgCandidates = e.candidates;
  }
  // `--doctor --browse` answers "what will Aside actually do" from measurements rather
  // than from its documentation, so a refused option is explainable before it is debugged.
  if (has('--browse')) {
    const { doctorPayload } = await import('./host/browse/probe.js');
    const { createAsideResolver } = await import('./host/browse/resolve.js');
    const resolveAside = createAsideResolver(config, process.env);
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
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}

const code = flag('--code');
if (!code) {
  console.error("usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N] [--cwd <dir>]");
  console.error('       node src/cli.js --doctor [--config <file>] [--cwd <dir>]');
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
