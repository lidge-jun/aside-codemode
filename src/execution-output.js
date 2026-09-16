// Budget the actual JSON response (including its NDJSON newline), not UTF-16 slices.
export const MIN_OUTPUT_BYTES = 96;
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function requireInteger(name, value, min = 1, max = MAX_TIMEOUT_MS) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

export function errorFields(error) {
  const out = { error: String(error?.message ?? error) };
  for (const key of ['code', 'applied', 'failedFile']) {
    if (error?.[key] !== undefined) out[key] = error[key];
  }
  return out;
}

// The guest runs as a script in a vm context with no module loader and no code generation
// from strings. Both refusals are correct and neither is going to change; what was wrong is
// that Node answered in its own vocabulary. ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING tells a
// caller nothing about what to do next, and an agent that hits it usually writes the same
// line again.
//
// This translates at the boundary rather than installing an import callback: that callback is
// ignored without --experimental-vm-modules, and the one loader constant that works without
// the flag hands back the real module namespace, which is the sandbox gone.

// Names reached for from somewhere else: the host's own tool catalog, Node, the browser. Each
// was written by an agent in a real run, and each has a guest equivalent worth naming.
const ELSEWHERE = {
  web_search: 'the guest searches the web with browse.searchMany([query]).',
  tools: 'there is no tool object here: the namespaces are globals, for example search.content({ path, query }).',
  require: 'there is no module loader; the injected globals are the surface.',
  process: 'no process here: run codemode --doctor for the environment it resolved.',
  fetch: 'no fetch here: browse.readText(url) reads a page, and api.batch(requests) covers the adapters it names.',
  XMLHttpRequest: 'no browser globals here: browse.readText(url) reads a page.',
  Buffer: 'no Buffer here: fs.read(path) returns a string.',
  setTimeout: 'no timers here: browse actions take a sleepMs step instead.',
};

export function translateGuestError(error, globals = []) {
  const names = globals.length ? globals.join(', ') : 'the injected globals';
  const message = String(error?.message ?? error);
  const code = error?.code;

  const alternative = 'The guest runs as a script in a vm context with no module loader. '
    + 'Use the injected globals instead: ' + names + '.';

  // Match on Node's error code, not on prose. A guest that throws its own Error mentioning a
  // dynamic import callback is reporting something else, and rewriting it would hide that.
  if (code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING'
    || code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG') {
    const e = new Error('dynamic import() is not available inside --code. ' + alternative);
    e.code = 'EGUESTIMPORT';
    return e;
  }

  // A static import never reaches the loader: it fails to compile, because the guest body is
  // wrapped in an async function rather than a module.
  if (error?.name === 'SyntaxError' && /import statement outside a module/i.test(message)) {
    const e = new SyntaxError(message + ' — ' + alternative);
    e.code = 'EGUESTIMPORT';
    return e;
  }

  // A name from somewhere else entirely: the host's tool catalog, Node, the browser. Node says
  // "x is not defined" and stops there, which leaves the author to guess whether the capability
  // is missing or merely named differently. For the handful that were actually reached for in
  // real runs, the answer is the guest's own name for the same thing.
  if (error?.name === 'ReferenceError') {
    const missing = /^(\w+) is not defined$/.exec(message)?.[1];
    const instead = missing && ELSEWHERE[missing];
    if (instead) {
      const e = new ReferenceError(`${message} — ${instead}`);
      e.code = 'EGUESTNAME';
      return e;
    }
  }

  // EvalError is the engine refusing; the same words inside some other error are not ours to
  // relabel. Wasm is refused by the same context option and gets the same treatment.
  if (error?.name === 'EvalError' && /code generation from strings/i.test(message)) {
    const e = new Error(message
      + ' — building code from a string is not available inside --code. ' + alternative);
    e.code = 'EGUESTCODEGEN';
    return e;
  }

  if (/wasm code generation disallowed/i.test(message)) {
    const e = new Error(message
      + ' — compiling WebAssembly is not available inside --code. ' + alternative);
    e.code = 'EGUESTCODEGEN';
    return e;
  }

  return error;
}

export function stringifyResult(value) {
  const ancestors = [];
  return JSON.stringify(value, function (key, v) {
    if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object') {
      while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop();
      if (ancestors.includes(v)) return '[circular]';
      ancestors.push(v);
    }
    return v;
  });
}

function ends(text, length) {
  let head = Math.floor(length * 0.7);
  let tail = length - head;
  // Avoid manufacturing an unpaired surrogate at either cut.
  if (head && /[\uD800-\uDBFF]/.test(text[head - 1])) head--;
  if (tail && /[\uDC00-\uDFFF]/.test(text[text.length - tail])) tail--;
  return text.slice(0, head) + '...[truncated]...' + (tail ? text.slice(-tail) : '');
}

export function fitString(text, jsonBytes) {
  if (Buffer.byteLength(JSON.stringify(text)) <= jsonBytes) return text;
  if (jsonBytes < 2) return '';
  let lo = 0, hi = text.length, best = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = ends(text, mid);
    if (Buffer.byteLength(JSON.stringify(candidate)) <= jsonBytes) {
      best = candidate;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

// Fields that survive any budget. Without status and the counts a caller cannot tell a
// completed run from a partial one, which is the whole point of the envelope.
const KEEP_KEYS = Object.freeze([
  'schema', 'status', 'runId', 'requested', 'completed', 'unreturned',
  'complete', 'truncated', 'ok', 'reconciledBy',
]);

// Shrink an object without changing what it is. Arrays lose entries from the end and say
// how many; long strings are cut but keep their key; anything that still does not fit is
// named in omittedKeys rather than silently dropped.
export function shrinkStructured(value, budget) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  for (const k of KEEP_KEYS) if (k in value) out[k] = value[k];
  const cost = (v) => Buffer.byteLength(JSON.stringify(v) ?? '');
  let room = budget - cost(out);
  for (const [k, v] of Object.entries(value)) {
    if (k in out) continue;
    if (Array.isArray(v)) {
      const kept = [];
      for (const el of v) {
        const c = cost(el) + 1;
        if (c > room) break;
        room -= c;
        kept.push(el);
      }
      out[k] = kept;
      if (kept.length < v.length) out.omittedItems = (out.omittedItems || 0) + (v.length - kept.length);
      continue;
    }
    const c = cost(v);
    if (c <= room) { out[k] = v; room -= c; continue; }
    if (typeof v === 'string' && room > 16) {
      out[k] = v.slice(0, room - 16) + '…';
      // A cut string keeps its key, so the loss has to be named somewhere else.
      out.truncatedKeys = (out.truncatedKeys || []).concat(k);
      room = 0;
      continue;
    }
    out.omittedKeys = (out.omittedKeys || []).concat(k);
  }
  return out;
}

export function fitEnvelope(input, limit) {
  // Call with plain data. Guest serialization runs in the supervised worker.
  const out = { ...input, logs: [...(input.logs ?? [])] };
  const size = () => Buffer.byteLength(JSON.stringify(out)) + 1;
  if (size() <= limit) return out;
  if (out.logs.length) {
    out.logs = [];
    out.logsTruncated = true;
    out.truncated = true;
  }
  if (size() <= limit) return out;
  const field = out.ok ? 'result' : 'error';
  // A structured result keeps its shape. Turning it into a truncated JSON string took the
  // caller's answer away: status, counts and the per-item ids all vanished into text that
  // could no longer be parsed.
  if (field === 'result' && out.result && typeof out.result === 'object') {
    const room = limit - size() + Buffer.byteLength(JSON.stringify(out.result));
    out.result = shrinkStructured(out.result, Math.max(0, room));
    out.truncated = true;
    if (size() <= limit) return out;
  }
  const raw = field === 'error' ? String(out.error) : JSON.stringify(out.result) ?? '';
  out[field] = '';
  out.truncated = true;
  out.totalBytes = out.totalBytes ?? Buffer.byteLength(raw);
  // Progress is kept in full when it fits; never silently turn partial progress
  // into an apparently complete list when the response budget is too small.
  if (size() > limit && ('applied' in out || 'failedFile' in out)) {
    delete out.applied;
    delete out.failedFile;
    out.detailsTruncated = true;
  }
  for (const key of ['totalBytes', 'logsTruncated', 'code']) {
    if (size() > limit) delete out[key];
  }
  if (size() > limit) {
    // At the smallest supported budget, preserve the outcome and loss marker.
    return { ok: out.ok, [field]: '', logs: [], truncated: true,
      ...(out.sideEffectsMayContinue ? { sideEffectsMayContinue: true } : { elapsedMs: out.elapsedMs }) };
  }
  out[field] = fitString(raw, limit - size() + 2);
  return out;
}
