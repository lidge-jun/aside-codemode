// One-shot CLI: same execute_code semantics as the MCP tool, for hosts whose
// agent can only run shell commands (aside exec's bash tool).
// usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N]
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

const code = flag('--code');
if (!code) {
  console.error("usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N]");
  process.exit(2);
}

const config = loadConfig(argv);
const assertInside = makeRootGuard(config.roots);
const rgRunner = createRgRunner(createRgResolver(config));
const globals = {
  search: createSearch({ rgRunner, assertInside, caps: config.searchCaps }),
  fs: createFs({ assertInside }),
  actions: createActions(),
};
const timeoutMs = Math.min(Number(flag('--timeout-ms')) || 30000, config.maxTimeoutMs);
const out = await runCode(code, { timeoutMs, globals, maxResultBytes: config.maxResultBytes });
process.stdout.write(JSON.stringify(out) + '\n');
process.exit(out.ok ? 0 : 1);
