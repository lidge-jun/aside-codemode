// aside-codemode MCP server entry (A-D1/A-D3).
// stdio NDJSON: one JSON-RPC message per line. stdout carries MCP only; logs go to stderr.
import { loadConfig } from './config.js';
import { makeRootGuard } from './paths.js';
import { createRgResolver, createRgRunner, RgNotFoundError } from './rg.js';
import { createSearch } from './host/search.js';
import { createFs } from './host/fs.js';
import { createActions } from './host/actions.js';
import { createToolHandler, TOOL_DEF, TOOL_NAME } from './tools.js';
import { parseMessage, result, error, PROTOCOL_VERSION, ERR_METHOD_NOT_FOUND, ERR_INVALID_PARAMS } from './mcp.js';

const SERVER_NAME = 'aside-codemode';
const SERVER_VERSION = '0.1.0';

function log(...args) {
  console.error('[aside-codemode]', ...args);
}

async function main() {
  const config = loadConfig();
  const assertInside = makeRootGuard(config.roots);
  const resolveRg = createRgResolver(config);
  const rgRunner = createRgRunner(resolveRg);
  const globals = {
    search: createSearch({ rgRunner, assertInside, caps: config.searchCaps }),
    fs: createFs({ assertInside }),
    actions: createActions(),
  };
  const handleToolCall = createToolHandler({ config, globals });

  const cancelled = new Set();
  const inFlight = new Map();

  function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  async function handle(msg) {
    if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') {
      if (msg.method === 'notifications/cancelled' && msg.params && msg.params.requestId !== undefined) {
        cancelled.add(msg.params.requestId);
      }
      return;
    }
    if (msg.id === undefined) return; // unknown notification: ignore
    const id = msg.id;
    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params && typeof msg.params.protocolVersion === 'string' ? msg.params.protocolVersion : null;
        send(result(id, {
          protocolVersion: requested ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        }));
        return;
      }
      case 'ping':
        send(result(id, {}));
        return;
      case 'tools/list':
        send(result(id, { tools: [TOOL_DEF] }));
        return;
      case 'tools/call': {
        const name = msg.params && msg.params.name;
        if (name !== TOOL_NAME) {
          send(error(id, ERR_INVALID_PARAMS, `unknown tool: ${name}`));
          return;
        }
        const run = (async () => {
          try {
            const out = await handleToolCall((msg.params && msg.params.arguments) ?? {});
            if (!cancelled.has(id)) send(result(id, out));
          } catch (e) {
            if (cancelled.has(id)) return;
            if (e && e.invalidParams) send(error(id, ERR_INVALID_PARAMS, e.message));
            else if (e instanceof RgNotFoundError) {
              send(result(id, { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message, hint: e.hint }) }], isError: true }));
            } else {
              send(result(id, { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }) }], isError: true }));
            }
          } finally {
            cancelled.delete(id);
            inFlight.delete(id);
          }
        })();
        inFlight.set(id, run);
        return;
      }
      default:
        send(error(id, ERR_METHOD_NOT_FOUND, `method not found: ${msg.method}`));
    }
  }

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = parseMessage(line);
      } catch (e) {
        send(error(null, -32700, `parse error: ${e.message}`));
        continue;
      }
      handle(msg);
    }
  });
  process.stdin.on('end', () => {
    log('stdin closed; exiting');
    process.exit(0);
  });
  log(`${SERVER_NAME} ${SERVER_VERSION} ready (roots: ${config.roots.length})`);
}

main().catch((e) => {
  console.error('[aside-codemode] fatal:', e);
  process.exit(1);
});
