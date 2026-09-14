// Guest CPU and serialization run off the host event loop. This is accident
// containment for trusted agents, NOT a hostile-code security boundary.
import { Worker, MessageChannel } from 'node:worker_threads';
import { errorFields, fitEnvelope, requireInteger, MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES } from './execution-output.js';

const HOST_DRAIN_MS = 1000;
const ROOTS = ['search', 'fs', 'actions', 'browse', 'report', 'read_file', 'write_file', 'edit_file', 'apply_patch'];

function hostMethods(globals) {
  const methods = new Map();
  for (const root of ROOTS) {
    const value = globals[root];
    if (typeof value === 'function') methods.set(root, value.bind(globals));
    else if (value && typeof value === 'object') {
      for (const [name, fn] of Object.entries(value)) {
        if (typeof fn === 'function') methods.set(`${root}.${name}`, fn.bind(value));
      }
    }
  }
  return methods;
}

export async function runCode(code, { timeoutMs = 30000, globals = {}, maxResultBytes = 65536, signal } = {}) {
  const started = Date.now();
  try {
    requireInteger('timeoutMs', timeoutMs);
    requireInteger('maxResultBytes', maxResultBytes, MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
    if (typeof code !== 'string' || !code.trim()) throw new Error('code (non-empty string) is required');
  } catch (e) {
    return { ok: false, error: e.message, logs: [], elapsedMs: Date.now() - started };
  }
  const controller = new AbortController();
  let host;
  try { host = typeof globals === 'function' ? globals(controller.signal) : globals; }
  catch (e) { return fitEnvelope({ ok: false, ...errorFields(e), elapsedMs: Date.now() - started }, maxResultBytes); }
  const methods = hostMethods(host);
  const manifest = [...methods.keys()];
  const { port1, port2 } = new MessageChannel();
  const syncState = new Int32Array(new SharedArrayBuffer(4));
  const logs = [];
  const active = new Set();

  return new Promise((resolve) => {
    let worker, timer, settled = false;
    const abort = () => { void finish({ ok: false, error: 'execution cancelled', code: 'ECANCELLED' }); };
    async function finish(out) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.abort(new Error(out.ok ? 'execution complete' : 'execution stopped'));
      if (worker) await worker.terminate().catch(() => {});
      port1.close();
      port2.close();
      if (active.size) {
        let drainTimer;
        await Promise.race([
          Promise.allSettled([...active]),
          new Promise(r => { drainTimer = setTimeout(r, HOST_DRAIN_MS); }),
        ]);
        clearTimeout(drainTimer);
      }
      const pending = active.size ? { pendingHostCalls: active.size, sideEffectsMayContinue: true } : {};
      resolve(fitEnvelope({ ...out, logs: out.logs ?? logs, ...pending, elapsedMs: Date.now() - started }, maxResultBytes));
    }
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      worker = new Worker(new URL('./execution-worker.js', import.meta.url), {
        workerData: { code, timeoutMs, maxResultBytes, manifest, syncPort: port2, syncBuffer: syncState.buffer },
        transferList: [port2],
        execArgv: [], stdout: true, stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      worker.stdout.resume();
      worker.stderr.resume();
    } catch (e) { void finish({ ok: false, ...errorFields(e) }); return; }
    timer = setTimeout(() => { void finish({ ok: false, error: `deadline exceeded (${timeoutMs}ms)`, code: 'ETIMEOUT' }); }, timeoutMs);
    worker.on('error', e => { void finish({ ok: false, ...errorFields(e) }); });
    worker.on('exit', code => {
      if (!settled) void finish({ ok: false, error: `guest worker exited before a result (${code})` });
    });
    worker.on('message', msg => {
      if (settled) return;
      if (msg.type === 'log') { logs.push(msg.text); return; }
      if (msg.type === 'done') { void finish(msg.out); return; }
      if (msg.type === 'syncCall') {
        let reply;
        try {
          const fn = methods.get(msg.name);
          if (!msg.name.startsWith('actions.') || !fn || !Array.isArray(msg.args)) throw new Error('unknown synchronous action');
          const value = fn(...msg.args);
          if (value?.then) throw new Error('actions must be synchronous');
          reply = { value };
        } catch (e) { reply = { error: errorFields(e) }; }
        try { port1.postMessage(reply); }
        catch (e) { port1.postMessage({ error: errorFields(e) }); }
        Atomics.store(syncState, 0, 1);
        Atomics.notify(syncState, 0);
        return;
      }
      if (msg.type !== 'call') return;
      const task = (async () => {
        try {
          const fn = methods.get(msg.name);
          if (!fn || !Array.isArray(msg.args)) throw new Error(`unknown host action: ${msg.name}`);
          const value = await fn(...msg.args);
          if (settled) return;
          // Array metadata is deliberately transferred, not lost to structuredClone.
          const search = typeof value?.toJSON === 'function'
            && (msg.name.startsWith('search.') || msg.name === 'fs.grepFile');
          worker.postMessage({ type: 'reply', id: msg.id, value: search ? value.toJSON() : value, search });
        } catch (e) {
          if (!settled) worker.postMessage({ type: 'reply', id: msg.id, error: errorFields(e) });
        }
      })();
      active.add(task);
      task.finally(() => active.delete(task)).catch(e => { void finish({ ok: false, ...errorFields(e) }); });
    });
  });
}
