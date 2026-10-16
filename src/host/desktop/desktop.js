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

function abortError(name) {
  const e = new Error(`desktop.${name} was not sent: the execution was cancelled or timed out.`);
  e.code = 'EABORTED';
  return e;
}

// The executor (and with it the broker session) is shared by every execution that uses this
// namespace, so element indexes survive from one execute_code to the next. The abort signal is
// not shared: each execution gets a view bound to its own signal through _view(signal), so a
// timed-out execution stops issuing clicks without tearing down the session other executions use.
export function createDesktop({ config = {}, signal, env = process.env, loader = loadBroker, platform = process.platform } = {}) {
  const caps = config.desktop || {};
  let executorPromise = null;
  let broker = null;

  function requireEnabled(name) {
    if (caps.enabled !== true) {
      const e = new Error(`desktop.${name} needs desktop control, which is off. ${ENABLE_DESKTOP_HINT}`);
      e.code = 'EDISABLED';
      throw e;
    }
    if (platform !== 'darwin') {
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

  // Concurrent first calls (Promise.all in the guest) share one in-flight start, so only one
  // broker session is ever opened. A failed start is forgotten so the next call can retry.
  function getExecutor() {
    if (!executorPromise) {
      executorPromise = (async () => {
        const launcher = caps.disclaimLauncher || env.CU_DISCLAIM_LAUNCHER;
        if (launcher) process.env.CU_DISCLAIM_LAUNCHER = launcher;
        broker = await loader(caps.packageDir);
        return new broker.DirectSessionExecutor({ idleTimeoutMs: caps.idleMs ?? 120000 });
      })();
      executorPromise.catch(() => { executorPromise = null; });
    }
    return executorPromise;
  }

  async function invoke(name, args, opts, sig) {
    requireEnabled(name);
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      const e = new Error(`desktop.${name}(args) takes one object, e.g. desktop.${name}({ app: "KakaoTalk" }).`);
      e.code = 'EBADVAL';
      throw e;
    }
    if (sig?.aborted) throw abortError(name);
    const ex = await getExecutor();
    if (sig?.aborted) throw abortError(name);
    const raw = await ex.execute(name, args, { signal: sig });
    return shapeResult(name, raw, { withImage: Boolean(opts && opts.image === true) });
  }

  // Many steps, one host round-trip, stop at the first failure. Each step is
  // { method, args, expect? } where expect is a substring the step's text must contain.
  // The guest cannot interrupt a host-side loop, so cancellation is checked before every step.
  async function runSteps(steps, opts, sig) {
    requireEnabled('run');
    if (!Array.isArray(steps) || !steps.length) {
      const e = new Error('desktop.run(steps) takes a non-empty array of { method, args, expect? }.');
      e.code = 'EBADVAL';
      throw e;
    }
    const o = opts && typeof opts === 'object' ? opts : {};
    const results = [];
    for (const [i, step] of steps.entries()) {
      if (sig?.aborted) {
        results.push({ step: i, ok: false, error: abortError('run').message });
        return { ok: false, complete: false, failedAt: i, results };
      }
      if (!step || !DESKTOP_METHODS.includes(step.method)) {
        results.push({ step: i, ok: false, error: `unknown method ${step && step.method}` });
        return { ok: false, complete: false, failedAt: i, results };
      }
      let r;
      try { r = await invoke(step.method, step.args || {}, { image: false }, sig); }
      catch (e) { r = { method: step.method, ok: false, error: e.message }; }
      if (r.ok && step.expect && !String(r.text).includes(step.expect)) {
        r = { ...r, ok: false, error: `expected text not found: ${step.expect}` };
      }
      results.push({ step: i, method: r.method, ok: r.ok, ...(r.error ? { error: r.error } : {}),
        text: o.keepText ? r.text : String(r.text || '').slice(0, o.textChars ?? 300) });
      if (!r.ok) return { ok: false, complete: false, failedAt: i, results };
    }
    return { ok: true, complete: true, results };
  }

  async function status() {
    if (caps.enabled !== true) return { enabled: false, hint: ENABLE_DESKTOP_HINT };
    requireEnabled('status');
    const b = broker || await loader(caps.packageDir);
    return { enabled: true, launcher: Boolean(caps.disclaimLauncher || env.CU_DISCLAIM_LAUNCHER), ...b.getDirectStatus() };
  }

  async function close() {
    const p = executorPromise;
    executorPromise = null;
    if (!p) return;
    const ex = await p.catch(() => null);
    await ex?.close().catch(() => {});
  }

  function view(sig) {
    const api = {};
    for (const m of DESKTOP_METHODS) api[m] = (args = {}, opts = {}) => invoke(m, args, opts, sig);
    api.run = (steps = [], opts = {}) => runSteps(steps, opts, sig);
    api.status = status;
    api._close = close;
    api._view = view;
    return Object.freeze(api);
  }

  return view(signal);
}
