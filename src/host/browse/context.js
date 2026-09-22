import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const FIELDS = new Set(['account', 'host']);

function contextError(message) {
  const error = new Error(message);
  error.code = 'EBADCONTEXT';
  return error;
}

export function normalizeAccount(value, label = 'browseContext.account') {
  if (typeof value !== 'string' || !/^u?\d+$/.test(value)) {
    throw contextError(`${label} must be an Aside profile id like u1`);
  }
  return 'u' + value.replace(/^u/, '');
}

export function normalizeHost(value, label = 'browseContext.host') {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()
      || value.startsWith('--') || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw contextError(`${label} must be a non-empty Aside host id or device name`);
  }
  return value;
}

export function normalizeBrowseContext(value = {}, label = 'browseContext') {
  if (value === undefined) value = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contextError(`${label} must be an object with optional account and host fields`);
  }
  const unknown = Object.keys(value).filter((key) => !FIELDS.has(key));
  if (unknown.length) {
    throw contextError(`${label} has unknown field(s): ${unknown.join(', ')}; valid fields: account, host`);
  }
  const out = {};
  if ('account' in value) out.account = normalizeAccount(value.account, `${label}.account`);
  if ('host' in value) out.host = normalizeHost(value.host, `${label}.host`);
  return Object.freeze(out);
}

export function mergeBrowseContext(base = {}, override = {}, label = 'browseContext') {
  return normalizeBrowseContext({ ...normalizeBrowseContext(base, label), ...normalizeBrowseContext(override, label) }, label);
}

export function replArgs(context, source) {
  const selected = normalizeBrowseContext(context);
  const args = [];
  if (selected.account) args.push('--account', selected.account);
  if (selected.host) args.push('--host', selected.host);
  args.push('repl', source);
  return args;
}

export function contextScope(context, inheritedAccountRoot = '') {
  const selected = normalizeBrowseContext(context);
  if (!selected.account && !selected.host) return String(inheritedAccountRoot || '');
  if (!selected.account || !selected.host) return null;
  return JSON.stringify({
    account: selected.account,
    host: selected.host,
  });
}

export function contextDirectory(base, context) {
  const selected = normalizeBrowseContext(context);
  if (!selected.account && !selected.host) return base;
  const scope = contextScope(selected);
  if (scope === null) return path.join(base, 'unresolved-' + randomUUID());
  const digest = createHash('sha256').update(scope).digest('hex').slice(0, 24);
  return path.join(base, 'context-' + digest);
}

export function isPartialBrowseContext(context) {
  const selected = normalizeBrowseContext(context);
  return Boolean(selected.account) !== Boolean(selected.host);
}

export function browseContextReport(config = {}) {
  const selected = normalizeBrowseContext(config.browseContext || {});
  const sources = config._browseContextSources || {};
  return Object.freeze({
    requested: selected,
    source: Object.freeze({
      account: selected.account ? (sources.account || 'configured') : 'aside-inherited',
      host: selected.host ? (sources.host || 'configured') : 'aside-inherited',
    }),
    actualIdentity: 'unverified',
  });
}

export function remoteArtifactsUnsupported(context) {
  const host = normalizeBrowseContext(context).host;
  return Boolean(host && host !== 'local');
}
