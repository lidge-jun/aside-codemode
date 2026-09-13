// MCP JSON-RPC pure helpers (A-D3). No I/O here.

export const PROTOCOL_VERSION = '2024-11-05';

export function parseMessage(line) {
  const msg = JSON.parse(line);
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    throw new Error('not a JSON-RPC object');
  }
  return msg;
}

export function result(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

export function error(id, code, message, data) {
  const e = { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  if (data !== undefined) e.error.data = data;
  return e;
}

export const ERR_METHOD_NOT_FOUND = -32601;
export const ERR_INVALID_PARAMS = -32602;
