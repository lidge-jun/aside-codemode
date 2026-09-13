// One-shot CLI: same execute_code semantics as the MCP tool, for hosts whose
// agent can only run shell commands (aside exec's bash tool).
// usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N]
//        node src/cli.js --doctor [--config <file>]
import { loadConfig } from './config.js';
import { makeRootGuard } from './paths.js';
import { createRgResolver, createRgRunner } from './rg.js';
import { createSearch } from './host/search.js';
import { createFs } from './host/fs.js';
import { createActions } from './host/actions.js';
import { runCode } from './sandbox.js';

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

let assertInside;
try {
  assertInside = makeRootGuard(config.roots);
} catch (e) {
  fail(e.message, { code: e.code ?? null });
}

const rgResolver = createRgResolver(config);
const rgRunner = createRgRunner(rgResolver);
const globals = {
  search: createSearch({ rgRunner, assertInside, caps: config.searchCaps }),
  fs: createFs({ assertInside }),
  actions: createActions(),
};

// `--doctor` answers "why is this not working" without making the caller
// reverse-engineer it from a failed search.
if (has('--doctor')) {
  const report = {
    ok: true,
    node: process.version,
    platform: process.platform,
    roots: assertInside.roots,
    missingRoots: assertInside.missingRoots,
    configSources: config._sources,
    rgPath: config.rgPath,
  };
  try {
    report.rgResolved = await rgResolver();
  } catch (e) {
    report.ok = false;
    report.rgResolved = null;
    report.rgError = e.message;
    if (e.candidates) report.rgCandidates = e.candidates;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}

const code = flag('--code');
if (!code) {
  console.error("usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N]");
  console.error('       node src/cli.js --doctor [--config <file>]');
  process.exit(2);
}

const timeoutMs = Math.min(Number(flag('--timeout-ms')) || 30000, config.maxTimeoutMs);
const out = await runCode(code, { timeoutMs, globals, maxResultBytes: config.maxResultBytes });
process.stdout.write(JSON.stringify(out) + '\n');
process.exit(out.ok ? 0 : 1);
