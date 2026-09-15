// Root allowlist enforcement (A-D2/A-D5). realpath first, then prefix check.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { normalizationVariants } from './unicode.js';

const isWindows = process.platform === 'win32';

function real(p) {
  return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
}

// A name typed in the other Unicode normalization form is simply MISSING on a
// byte-exact filesystem: measured on NTFS 2026-09-14, the NFC and NFD spellings
// of one Korean name are two separate entries and realpath of the unused form
// throws ENOENT. The caller then walked up to the parent, rejoined the name as an
// unresolvable tail, and reported EROOT — "escapes configured roots" for a file
// that was merely spelled the other way.
//
// So ask the OS about the other spelling, and adopt only what it actually
// resolves. The result is a real path, so the containment test stays byte-exact.
// Normalizing the comparison instead would have been a security regression: NFC
// is not injective (U+212B and U+00C5 both compose to U+00C5), and on NTFS/ext4
// two normalization forms are two different directories, so a folded comparison
// can accept a sibling that was never configured as a root.
function realVariant(p) {
  for (const candidate of normalizationVariants(p)) {
    try {
      return real(candidate);
    } catch {
      // Not this spelling either; fall through to the caller's walk-up.
    }
  }
  return null;
}

export class RootEscapeError extends Error {
  constructor(p, roots) {
    super(
      `path escapes configured roots: ${p}` +
      (roots && roots.length ? `. configured roots: ${roots.join(', ')}` : '. no roots are configured'),
    );
    this.name = 'RootEscapeError';
    this.code = 'EROOT';
    if (roots) this.roots = roots;
  }
}

export class RootConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RootConfigError';
    this.code = 'EROOTCFG';
  }
}

export function makeRootGuard(roots, { cwd } = {}) {
  // A configured root that does not exist on this machine used to throw a raw
  // ENOENT from realpath at startup, printing a node stack trace instead of a
  // usable message. That is exactly what a fresh clone hits when the committed
  // config carries another OS's paths (measured 2026-09-13: a Windows
  // "C:\\Users\\..." root crashed the macOS CLI before any code ran).
  const realRoots = [];
  const missing = [];
  for (const r of roots) {
    try {
      realRoots.push(real(r));
    } catch (e) {
      if (e.code === 'ENOENT') missing.push(r);
      else throw new RootConfigError(`configured root ${r} is unusable: ${e.message}`);
    }
  }
  if (missing.length && realRoots.length === 0) {
    throw new RootConfigError(
      `none of the configured roots exist on this machine: ${missing.join(', ')}. ` +
      'Fix "roots" in codemode.config.json (it is machine-specific and gitignored; ' +
      'copy codemode.config.example.json or run scripts/register-aside.mjs).',
    );
  }
  const cmp = (p) => (isWindows ? p.toLowerCase() : p);
  const cmpRoots = realRoots.map(cmp);

  // `target === root || target.startsWith(root + sep)` broke on a filesystem
  // root: for root '/' it compared against '//', so EVERY path was refused
  // (measured 2026-09-13; same class of bug for a Windows drive root 'C:\\').
  // path.relative answers containment directly and keeps the sibling-prefix
  // rejection that naive startsWith also got wrong ('/a/proj' vs '/a/proj-evil').
  const isInsideRoot = (target, root) => {
    if (target === root) return true;
    const rel = path.relative(root, target);
    if (rel === '') return true;
    if (rel === '..' || rel.startsWith('..' + path.sep)) return false;
    // An absolute rel means the two paths share no base at all (different
    // Windows drives), which is outside by definition.
    return !path.isAbsolute(rel);
  };

  const guard = function assertInside(p) {
    if (cmpRoots.length === 0) throw new RootEscapeError(p, realRoots);
    if (typeof p !== 'string' || !p) throw new Error('path (non-empty string) is required');
    // realpath the nearest EXISTING ancestor, then re-join the remaining
    // segments — otherwise writes to not-yet-created files fail with ENOENT.
    const base = cwd ? path.resolve(cwd) : process.cwd();
    let cur = path.resolve(base, p);
    const tail = [];
    let realBase;
    for (;;) {
      try {
        realBase = real(cur);
        break;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        const variant = realVariant(cur);
        if (variant) {
          realBase = variant;
          break;
        }
        tail.unshift(path.basename(cur));
        const parent = path.dirname(cur);
        if (parent === cur) throw e;
        cur = parent;
      }
    }
    const resolved = tail.length ? path.join(realBase, ...tail) : realBase;
    const target = cmp(resolved);
    for (const root of cmpRoots) {
      if (isInsideRoot(target, root)) return resolved;
    }
    throw new RootEscapeError(p, realRoots);
  };
  // Surfaced so the CLI/server can report a partially-usable configuration
  // instead of pretending every root resolved.
  guard.roots = realRoots;
  guard.missingRoots = missing;
  guard.cwd = cwd ? path.resolve(cwd) : undefined;
  return guard;
}
