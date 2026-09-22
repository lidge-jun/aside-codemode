// aside-codemode MCP server entry (A-D1/A-D3).
// stdio NDJSON: one JSON-RPC message per line. stdout carries MCP only; logs go to stderr.
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { makeRootGuard } from './paths.js';
import { RgNotFoundError } from './rg.js';
import { createHostGlobals } from './host/globals.js';
import { createToolHandler, TOOL_DEF, TOOL_NAME } from './tools.js';
import { parseMessage, result, error, PROTOCOL_VERSION, ERR_METHOD_NOT_FOUND, ERR_INVALID_PARAMS } from './mcp.js';

const SERVER_NAME = 'aside-codemode';
// Read the package rather than restate it. This string was still 0.1.0 two releases in,
// which told every MCP client a version that had not existed for months.
const SERVER_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

// SEP-973 added serverInfo.icons in protocol 2025-11-25, so a client that negotiated an
// older version must not receive it. Aside parses the field and does not render it today —
// its stdio rows draw a fixed glyph — but a server that only advertises what one client
// happens to display is a server that never gets displayed anywhere else.
const ICON_PROTOCOL = '2025-11-25';
let cachedIcons;
function serverIcons(protocolVersion) {
  if (protocolVersion !== ICON_PROTOCOL) return null;
  if (cachedIcons === undefined) {
    try {
      const png = readFileSync(new URL('../assets/logo.png', import.meta.url));
      cachedIcons = [{ src: `data:image/png;base64,${png.toString('base64')}`, mimeType: 'image/png', sizes: ['448x336'] }];
    } catch {
      // A missing asset is cosmetic. Never let it take down initialize.
      cachedIcons = null;
    }
  }
  return cachedIcons;
}

function log(...args) {
  console.error('[aside-codemode]', ...args);
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    log(`FATAL config: ${e.message}`);
    process.exit(2);
  }
  if (process.env.CODEMODE_DEBUG_LOG) {
    try {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.CODEMODE_DEBUG_LOG, JSON.stringify({ t: Date.now(), pid: process.pid, argv: process.argv, cwd: process.cwd() }) + '\n');
    } catch {}
  }
  // A bad config must not kill the server with a raw stack trace on stdout —
  // stdout is the MCP channel. Report on stderr and exit deliberately.
  let assertInside;
  try {
    assertInside = makeRootGuard(config.roots);
  } catch (e) {
    log(`FATAL ${e.code ?? 'ECONFIG'}: ${e.message}`);
    process.exit(2);
  }
  const globals = (signal, execContext) => createHostGlobals(config, assertInside, signal, execContext);
  const handleToolCall = createToolHandler({ config, globals });

  const inFlight = new Map();
  let closing = false;

  function send(msg) {
    if (!closing) process.stdout.write(JSON.stringify(msg) + '\n');
  }

  async function handle(msg) {
    if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') {
      if (msg.method === 'notifications/cancelled' && msg.params && msg.params.requestId !== undefined) {
        inFlight.get(msg.params.requestId)?.controller.abort();
      }
      return;
    }
    if (msg.id === undefined) return; // unknown notification: ignore
    const id = msg.id;
    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params && typeof msg.params.protocolVersion === 'string' ? msg.params.protocolVersion : null;
        const protocolVersion = requested ?? PROTOCOL_VERSION;
        const serverInfo = { name: SERVER_NAME, version: SERVER_VERSION };
        const icons = serverIcons(protocolVersion);
        if (icons) serverInfo.icons = icons;
        send(result(id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo,
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
        if (inFlight.size >= 8 || inFlight.has(id)) {
          send(error(id, ERR_INVALID_PARAMS, 'too many active calls or duplicate request id'));
          return;
        }
        const controller = new AbortController();
        inFlight.set(id, { controller });
        const run = (async () => {
          try {
            const out = await handleToolCall((msg.params && msg.params.arguments) ?? {}, { signal: controller.signal });
            if (!controller.signal.aborted) send(result(id, out));
          } catch (e) {
            if (controller.signal.aborted) return;
            if (e && e.invalidParams) send(error(id, ERR_INVALID_PARAMS, e.message));
            else if (e instanceof RgNotFoundError) {
              send(result(id, { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message, hint: e.hint }) }], isError: true }));
            } else {
              send(result(id, { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }) }], isError: true }));
            }
          } finally {
            inFlight.delete(id);
          }
        })();
        inFlight.get(id).run = run;
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
    closing = true;
    for (const { controller } of inFlight.values()) controller.abort();
    log('stdin closed; cancelling active work');
    process.exitCode = 0;
  });
  log(`${SERVER_NAME} ${SERVER_VERSION} ready (roots: ${config.roots.length})`);
}

main().catch((e) => {
  console.error('[aside-codemode] fatal:', e);
  process.exit(1);
});
