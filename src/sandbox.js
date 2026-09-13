// execute_code sandbox (A-D2). node:vm is NOT a security boundary — see README trust model.
import vm from 'node:vm';
import util from 'node:util';

const LOG_CAP = 200;

function safeStringify(value, maxBytes) {
  const seen = new WeakSet();
  let text;
  try {
    text = JSON.stringify(value, (k, v) => {
      if (typeof v === 'function') return `[function ${v.name ?? 'anonymous'}]`;
      if (typeof v === 'bigint') return v.toString();
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    });
  } catch (e) {
    text = undefined;
  }
  if (text === undefined) text = util.inspect(value, { depth: 4 });
  const total = Buffer.byteLength(text);
  if (total > maxBytes) {
    // Head-only truncation destroys the end of a result, which is where a
    // summary or a final count usually lives. Keep both ends and say what was
    // dropped, so the model can narrow the query instead of guessing.
    // (Pattern follows the Codex tool-runtime note: head + marker + tail.)
    const marker = `\n...[truncated: ${total} bytes total — narrow the query, lower max, or return fewer fields]...\n`;
    // The cap must hold INCLUDING the marker, otherwise "capped at N" is a
    // lie and a downstream buffer sized to N still overflows.
    const budget = Math.max(0, maxBytes - Buffer.byteLength(marker));
    const head = Math.floor(budget * 0.7);
    const tail = budget - head;
    const kept = tail > 0
      ? text.slice(0, head) + marker + text.slice(text.length - tail)
      : text.slice(0, budget) + marker;
    return { text: kept, truncated: true, totalBytes: total };
  }
  return { text, truncated: false };
}

export async function runCode(code, { timeoutMs, globals, maxResultBytes }) {
  const started = Date.now();
  const logs = [];
  const pushLog = (level, args) => {
    if (logs.length < LOG_CAP) logs.push(`[${level}] ` + util.format(...args));
  };
  const consoleShim = {
    log: (...a) => pushLog('log', a),
    info: (...a) => pushLog('log', a),
    warn: (...a) => pushLog('warn', a),
    error: (...a) => pushLog('error', a),
  };

  const sandboxGlobal = {
    search: globals.search,
    fs: globals.fs,
    actions: globals.actions,
    console: consoleShim,
  };
  // NOTE: microtaskMode 'afterEvaluate' was specified in the plan but drops the
  // returned promise forever in this pattern (measured 2026-09-13, Node v24):
  // the async IIFE never resolves. Left out on purpose; the Promise.race
  // deadline below is the async bound.
  const context = vm.createContext(sandboxGlobal, {
    codeGeneration: { strings: false, wasm: false },
  });

  let result;
  try {
    const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: 'guest.js' });
    const promise = script.runInContext(context, { timeout: timeoutMs });
    result = await Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`deadline exceeded (${timeoutMs}ms)`)), timeoutMs)),
    ]);
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), logs, elapsedMs: Date.now() - started };
  }

  if (result === undefined) {
    return { ok: true, result: undefined, logs, elapsedMs: Date.now() - started };
  }
  const { text, truncated, totalBytes } = safeStringify(result, maxResultBytes);
  let parsed;
  try {
    parsed = truncated ? text : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return {
    ok: true,
    result: parsed,
    logs,
    elapsedMs: Date.now() - started,
    ...(truncated ? { truncated, totalBytes } : {}),
  };
}
