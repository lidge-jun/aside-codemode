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
