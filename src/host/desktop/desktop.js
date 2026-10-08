// Guest namespace `desktop`: Codex Computer Use (macOS native apps) inside code mode.
//
// Why here and not as a separate MCP: the agent's cost is turns and context, not the tool
// call. A plain MCP spends one model round-trip per click and pours every accessibility tree
// and screenshot into the context. Here the guest batches get_app_state -> filter -> click ->
// verify inside one execute_code and returns only what it chose to return.
//
// Transport: the host does NOT talk to SkyComputerUseClient directly. That client only answers
// a parent it trusts ("Sender process is not authenticated"), so the host borrows the
// signed-broker session from the `codex-computer-use-mcp` package, which runs the OpenAI-signed
// `codex app-server` with the client attached. Elements stay addressable across calls because
// that broker session lives as long as this namespace (idle-closed after config.desktop.idleMs).
//
// TCC: when Aside spawns the chain, macOS makes Aside the responsible process, and Aside lacks
// com.apple.security.automation.apple-events, so every call dies with bootstrapTimedOut. Set
// desktop.disclaimLauncher (or env CU_DISCLAIM_LAUNCHER) to a launcher that execs its argv with
// responsibility_spawnattrs_setdisclaim(1); the broker package must honour that env var.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ENABLE_DESKTOP_HINT } from './desktop-actions.js';

export const DESKTOP_METHODS = Object.freeze([
  'list_apps', 'get_app_state', 'click', 'perform_secondary_action', 'set_value',
  'select_text', 'scroll', 'drag', 'press_key', 'type_text',
]);

// get_app_state returns { content: [ {type:'text', text}, {type:'image', data, mimeType} ] }.
// The guest gets text in full and images as metadata only unless it asks; an image is the
// single biggest thing that can flood the context, so it must be opted into per call.
function shapeResult(method, raw, { withImage }) {
  const content = Array.isArray(raw?.content) ? raw.content : [];
  const text = content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
  const images = content.filter((c) => c && c.type === 'image');
  const out = { method, ok: raw?.isError !== true, text };
  if (images.length) {
    out.image = withImage
      ? { mimeType: images[0].mimeType, data: images[0].data }
      : { mimeType: images[0].mimeType, bytes: Math.round(String(images[0].data || '').length * 0.75), omitted: true };
  }
  if (!out.ok) out.error = text || 'official computer use error';
  return out;
}

async function loadBroker(packageDir) {
  const sessionUrl = pathToFileURL(path.join(packageDir, 'dist', 'session-executor.js')).href;
  const statusUrl = pathToFileURL(path.join(packageDir, 'dist', 'direct-service.js')).href;
  const [{ DirectSessionExecutor }, { getDirectStatus }] = await Promise.all([import(sessionUrl), import(statusUrl)]);
  return { DirectSessionExecutor, getDirectStatus };
}

export function createDesktop({ config = {}, signal, env = process.env, loader = loadBroker } = {}) {
  const caps = config.desktop || {};
  let executor = null;
  let broker = null;

  function requireEnabled(name) {
    if (caps.enabled !== true) {
      const e = new Error(`desktop.${name} needs desktop control, which is off. ${ENABLE_DESKTOP_HINT}`);
      e.code = 'EDISABLED';
      throw e;
    }
    if (process.platform !== 'darwin') {
      const e = new Error('desktop.* drives macOS apps through Codex Computer Use and is macOS-only.');
      e.code = 'ENOTSUP';
      throw e;
    }
    if (!caps.packageDir || !existsSync(path.join(caps.packageDir, 'dist', 'session-executor.js'))) {
      const e = new Error('desktop.packageDir must point at an installed codex-computer-use-mcp package (…/node_modules/codex-computer-use-mcp).');
      e.code = 'ENOTFOUND';
      throw e;
    }
  }

  async function getExecutor() {
    if (executor) return executor;
    const launcher = caps.disclaimLauncher || env.CU_DISCLAIM_LAUNCHER;
    if (launcher) process.env.CU_DISCLAIM_LAUNCHER = launcher;
    broker = await loader(caps.packageDir);
    executor = new broker.DirectSessionExecutor({ idleTimeoutMs: caps.idleMs ?? 120000 });
    signal?.addEventListener?.('abort', () => { void executor?.close().catch(() => {}); executor = null; }, { once: true });
    return executor;
  }

  function method(name) {
    return async (args = {}, opts = {}) => {
      requireEnabled(name);
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        const e = new Error(`desktop.${name}(args) takes one object, e.g. desktop.${name}({ app: "KakaoTalk" }).`);
        e.code = 'EBADVAL';
        throw e;
      }
      const ex = await getExecutor();
      const raw = await ex.execute(name, args, { signal });
      return shapeResult(name, raw, { withImage: opts && opts.image === true });
    };
  }

  const api = {};
  for (const m of DESKTOP_METHODS) api[m] = method(m);

  // Many steps, one host round-trip, stop at the first failure. Each step is
  // { method, args, expect? } where expect is a substring the step's text must contain.
  api.run = async (steps = [], opts = {}) => {
    requireEnabled('run');
    if (!Array.isArray(steps) || !steps.length) {
      const e = new Error('desktop.run(steps) takes a non-empty array of { method, args, expect? }.');
      e.code = 'EBADVAL';
      throw e;
    }
    const results = [];
    for (const [i, step] of steps.entries()) {
      if (!step || !DESKTOP_METHODS.includes(step.method)) {
        results.push({ step: i, ok: false, error: `unknown method ${step && step.method}` });
        return { ok: false, complete: false, failedAt: i, results };
      }
      let r;
      try { r = await api[step.method](step.args || {}, { image: false }); }
      catch (e) { r = { method: step.method, ok: false, error: e.message }; }
      if (r.ok && step.expect && !String(r.text).includes(step.expect)) {
        r = { ...r, ok: false, error: `expected text not found: ${step.expect}` };
      }
      results.push({ step: i, method: r.method, ok: r.ok, ...(r.error ? { error: r.error } : {}),
        text: opts.keepText ? r.text : String(r.text || '').slice(0, opts.textChars ?? 300) });
      if (!r.ok) return { ok: false, complete: false, failedAt: i, results };
    }
    return { ok: true, complete: true, results };
  };

  api.status = async () => {
    if (caps.enabled !== true) return { enabled: false, hint: ENABLE_DESKTOP_HINT };
    requireEnabled('status');
    const b = broker || await loader(caps.packageDir);
    return { enabled: true, launcher: Boolean(caps.disclaimLauncher || env.CU_DISCLAIM_LAUNCHER), ...b.getDirectStatus() };
  };

  api._close = async () => { await executor?.close().catch(() => {}); executor = null; };
  return Object.freeze(api);
}
