// Snapshot cache shared across codemode processes.
//
// The key carries the Aside ACCOUNT ROOT because the browser runs a signed-in profile.
// Keying on url alone would let one account's rendering of a page be handed to a different
// context — that is a cross-account leak wearing the costume of a speed-up.
//
// This is a cooperating-process cache, not a security boundary, exactly like the file locks
// in src/host/file-lock.js. A hostile local process can write whatever it likes here.
//
// TTL is the ONLY invalidation. Nothing watches the page for change, so a hit means
// 'recent', never 'current'.
import { mkdirSync } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const CACHE_DIR = path.join(os.tmpdir(), 'codemode-browse-cache');
export const SCHEMA_VERSION = 1;
export const DEFAULT_TTL_MS = 15 * 60 * 1000;

export function cacheKey({ url, accountRoot = '', viewport = null, roles = null, waitSelector = null } = {}) {
  const parts = [
    'v' + SCHEMA_VERSION,
    String(url || ''),
    String(accountRoot || ''),
    viewport ? `${viewport.width}x${viewport.height}` : 'vp:default',
    Array.isArray(roles) && roles.length ? roles.slice().sort().join(',') : 'roles:all',
    waitSelector ? `wait:${waitSelector}` : 'wait:none',
  ];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

// Keep only the lines whose role is asked for. The measured tree is line-oriented text,
// so this is a line filter rather than a tree walk.
export function compactTree(tree, roles) {
  if (!Array.isArray(roles) || roles.length === 0) return String(tree || '');
  const wanted = roles.map((r) => String(r).toLowerCase());
  return String(tree || '')
    .split('\n')
    .filter((line) => {
      const m = /^\s*(?:\[[^\]]*\]\s*)?([a-z][a-z-]*)/i.exec(line);
      return m ? wanted.includes(m[1].toLowerCase()) : false;
    })
    .join('\n');
}

export function createSnapshotCache({ dir = CACHE_DIR, ttlMs = DEFAULT_TTL_MS, now = Date.now, deps = {} } = {}) {
  const readFileImpl = deps.readFileImpl || readFile;
  const writeFileImpl = deps.writeFileImpl || writeFile;
  const statImpl = deps.statImpl || stat;
  let ensured = false;

  function ensure() {
    if (ensured) return;
    try { (deps.mkdirSyncImpl || mkdirSync)(dir, { recursive: true }); } catch (_) {}
    ensured = true;
  }

  function fileFor(key) { return path.join(dir, key + '.json'); }

  async function get(keyParts) {
    ensure();
    const key = cacheKey(keyParts);
    const file = fileFor(key);
    try {
      const st = await statImpl(file);
      const ageMs = now() - st.mtimeMs;
      if (ageMs > ttlMs) return { hit: false, reason: 'expired', ageMs, key };
      const raw = await readFileImpl(file, 'utf8');
      const entry = JSON.parse(raw);
      return { hit: true, key, ageMs, tree: entry.tree, roles: entry.roles || null };
    } catch (_) {
      return { hit: false, reason: 'miss', key };
    }
  }

  async function put(keyParts, tree, roles = null) {
    ensure();
    const key = cacheKey(keyParts);
    try {
      await writeFileImpl(fileFor(key), JSON.stringify({ tree: String(tree || ''), roles, at: now() }), 'utf8');
      return { stored: true, key };
    } catch (e) {
      return { stored: false, key, error: String(e.message || e) };
    }
  }

  // A revisit returns only what changed, which is the token saving #14 is actually about.
  function diff(oldTree, newTree) {
    const a = String(oldTree || '').split('\n');
    const b = String(newTree || '').split('\n');
    const seen = new Set(a);
    const added = b.filter((l) => !seen.has(l));
    const kept = new Set(b);
    const removed = a.filter((l) => !kept.has(l));
    return { added, removed, changed: added.length + removed.length };
  }

  return Object.freeze({ get, put, diff, key: cacheKey, dir });
}
