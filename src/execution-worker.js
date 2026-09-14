import { parentPort, workerData, receiveMessageOnPort } from 'node:worker_threads';
import vm from 'node:vm';
import util from 'node:util';
import { errorFields, fitEnvelope, fitString, stringifyResult } from './execution-output.js';

const { code, timeoutMs, maxResultBytes, manifest, syncPort, syncBuffer } = workerData;
const MAX_PENDING = 256;
const pending = new Map();
let nextId = 0;
let hostCallFailures = 0;
let restoreSearch;
parentPort.on('message', async msg => {
  const call = pending.get(msg.id);
  if (msg.type !== 'reply' || !call) return;
  pending.delete(msg.id);
  if (msg.error) {
    hostCallFailures++;
    call.reject(Object.assign(new Error(msg.error.error), msg.error));
    return;
  }
  try {
    // Only known search RPC replies take this path; arbitrary guest objects
    // with a `rows` field are never reinterpreted as search envelopes.
    if (msg.search && !restoreSearch) ({ restoreSearchResult: restoreSearch } = await import('./search-result.js'));
    call.resolve(msg.search ? restoreSearch(msg.value) : msg.value);
  } catch (e) { call.reject(e); }
});
function rpc(name, args) {
  if (pending.size >= MAX_PENDING) throw new Error(`at most ${MAX_PENDING} host calls may be in flight`);
  const id = ++nextId;
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Avoid process-level unhandled rejection while guest code decides to await.
  promise.catch(() => {});
  pending.set(id, { resolve, reject, promise });
  try { parentPort.postMessage({ type: 'call', id, name, args }); }
  catch (e) { pending.delete(id); hostCallFailures++; reject(e); }
  return promise;
}

const syncState = new Int32Array(syncBuffer);
function syncRpc(name, args) {
  Atomics.store(syncState, 0, 0);
  parentPort.postMessage({ type: 'syncCall', name, args });
  while (Atomics.load(syncState, 0) === 0) Atomics.wait(syncState, 0, 0);
  const { message } = receiveMessageOnPort(syncPort);
  if (message.error) throw Object.assign(new Error(message.error.error), message.error);
  return message.value;
}
const injected = { search: {}, fs: {}, actions: {}, browse: {}, report: {}, api: {} };
for (const name of manifest) {
  const [root, method] = name.split('.');
  if (method) injected[root][method] = (...args) => root === 'actions' ? syncRpc(name, args) : rpc(name, args);
  else injected[root] = (...args) => rpc(name, args);
}
for (const key of ['search', 'fs', 'actions', 'browse', 'report', 'api']) Object.freeze(injected[key]);
const logs = [];
let logBytes = 2;
let logsTruncated = false;
const logBudget = Math.floor(maxResultBytes / 4);
function log(level, args) {
  if (logs.length >= 200 || logBytes + 3 >= logBudget) { logsTruncated = true; return; }
  const raw = `[${level}] ` + util.format(...args);
  const text = fitString(raw, logBudget - logBytes - 1);
  if (text !== raw) logsTruncated = true;
  logBytes += Buffer.byteLength(JSON.stringify(text)) + 1;
  logs.push(text);
  parentPort.postMessage({ type: 'log', text });
}
injected.console = Object.freeze({
  log: (...a) => log('log', a), info: (...a) => log('log', a),
  warn: (...a) => log('warn', a), error: (...a) => log('error', a),
});

const started = Date.now();
let out;
try {
  const context = vm.createContext(injected, { codeGeneration: { strings: false, wasm: false } });
  const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: 'guest.js' });
  const value = await script.runInContext(context, { timeout: timeoutMs });
  while (pending.size) await Promise.all([...pending.values()].map(x => x.promise));
  // Getters/toJSON/inspection can execute guest code; keep that work supervised.
  const text = stringifyResult(value);
  out = { ok: true, ...(text === undefined ? {} : { result: JSON.parse(text) }) };
} catch (e) {
  out = { ok: false, ...errorFields(e) };
}
out.logs = logs;
if (hostCallFailures) out.hostCallFailures = hostCallFailures;
if (logsTruncated) { out.logsTruncated = true; out.truncated = true; }
out.elapsedMs = Date.now() - started;
parentPort.postMessage({ type: 'done', out: fitEnvelope(out, maxResultBytes) });
