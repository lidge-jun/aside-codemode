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
import { readFileSync } from 'node:fs';
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

// One command instead of "find the config file, learn its shape, add a key". Browsing stays
// opt-in; this only shortens the distance between the refusal and a working call. It runs
// before the root guard on purpose: a machine whose configured roots have moved still needs
// to be able to turn browsing on.
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
