// Root allowlist enforcement (A-D2/A-D5). realpath first, then prefix check.
import { realpathSync } from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';

function real(p) {
  return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
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

export function makeRootGuard(roots) {
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

  const guard = function assertInside(p) {
    if (cmpRoots.length === 0) throw new RootEscapeError(p, realRoots);
    if (typeof p !== 'string' || !p) throw new Error('path (non-empty string) is required');
    // realpath the nearest EXISTING ancestor, then re-join the remaining
    // segments — otherwise writes to not-yet-created files fail with ENOENT.
    let cur = path.resolve(p);
    const tail = [];
    let realBase;
    for (;;) {
      try {
        realBase = real(cur);
        break;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        tail.unshift(path.basename(cur));
        const parent = path.dirname(cur);
        if (parent === cur) throw e;
        cur = parent;
      }
    }
    const resolved = tail.length ? path.join(realBase, ...tail) : realBase;
    const target = cmp(resolved);
    for (const root of cmpRoots) {
      if (target === root || target.startsWith(root + path.sep)) return resolved;
    }
    throw new RootEscapeError(p, realRoots);
  };
  // Surfaced so the CLI/server can report a partially-usable configuration
  // instead of pretending every root resolved.
  guard.roots = realRoots;
  guard.missingRoots = missing;
  return guard;
}
