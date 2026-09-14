// One TTL cache for every browse feature that repeats work.
//
// The key carries more than the url on purpose:
//   namespace  — a readText entry must never answer an extract question
//   engine     — YouTube and DuckDuckGo are different indexes; same query, different answer
//   accountRoot— the browser runs a signed-in profile, so this is a cross-account boundary
//   locale     — the same url returns different content per language
// Cooperating processes, TTL-only invalidation, NOT a security boundary. Same standing as
// the file locks in src/host/file-lock.js.
import { mkdirSync } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const CACHE_DIR = path.join(os.tmpdir(), 'codemode-browse-cache');
export const SCHEMA_VERSION = 2;
export const DEFAULT_TTL_MS = 15 * 60 * 1000;

export function cacheKey({ namespace = 'default', subject = '', engine = null, accountRoot = '', locale = null, viewport = null, roles = null, waitSelector = null } = {}) {
  const parts = [
    'v' + SCHEMA_VERSION,
    'ns:' + String(namespace),
    'sub:' + String(subject || ''),
    'eng:' + String(engine || 'none'),
    'acct:' + String(accountRoot || ''),
    'loc:' + String(locale || 'default'),
    viewport ? `vp:${viewport.width}x${viewport.height}` : 'vp:default',
    Array.isArray(roles) && roles.length ? 'roles:' + roles.slice().sort().join(',') : 'roles:all',
    waitSelector ? 'wait:' + waitSelector : 'wait:none',
  ];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export function createCache({ dir = CACHE_DIR, ttlMs = DEFAULT_TTL_MS, now = Date.now, deps = {} } = {}) {
  const readFileImpl = deps.readFileImpl || readFile;
  const writeFileImpl = deps.writeFileImpl || writeFile;
  const statImpl = deps.statImpl || stat;
  let ensured = false;
  const ensure = () => { if (!ensured) { try { (deps.mkdirSyncImpl || mkdirSync)(dir, { recursive: true }); } catch (_) {} ensured = true; } };
  const fileFor = (key) => path.join(dir, key + '.json');

  async function get(keyParts) {
    ensure();
    const key = cacheKey(keyParts);
    try {
      const st = await statImpl(fileFor(key));
      const ageMs = now() - st.mtimeMs;
      if (ageMs > ttlMs) return { hit: false, reason: 'expired', ageMs, key };
      const entry = JSON.parse(await readFileImpl(fileFor(key), 'utf8'));
      return { hit: true, key, ageMs, value: entry.value };
    } catch (_) {
      return { hit: false, reason: 'miss', key };
    }
  }

  async function put(keyParts, value) {
    ensure();
    const key = cacheKey(keyParts);
    try {
      await writeFileImpl(fileFor(key), JSON.stringify({ value, at: now() }), 'utf8');
      return { stored: true, key };
    } catch (e) {
      return { stored: false, key, error: String(e.message || e) };
    }
  }

  return Object.freeze({ get, put, key: cacheKey, dir, ttlMs });
}

export function textHash(s) {
  return createHash('sha256').update(String(s || '')).digest('hex').slice(0, 32);
}

export function lineDiff(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');
  const seen = new Set(a);
  const kept = new Set(b);
  const added = b.filter((l) => !seen.has(l));
  const removed = a.filter((l) => !kept.has(l));
  return { added, removed, changed: added.length + removed.length };
}
