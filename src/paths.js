// Root allowlist enforcement (A-D2/A-D5). realpath first, then prefix check.
import { realpathSync } from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';

function real(p) {
  return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
}

export class RootEscapeError extends Error {
  constructor(p) {
    super(`path escapes configured roots: ${p}`);
    this.name = 'RootEscapeError';
    this.code = 'EROOT';
  }
}

export function makeRootGuard(roots) {
  const cmp = (p) => (isWindows ? p.toLowerCase() : p);
  const realRoots = roots.map((r) => cmp(real(r)));
  return function assertInside(p) {
    if (realRoots.length === 0) throw new RootEscapeError(p);
    const resolved = real(p);
    const target = cmp(resolved);
    for (const root of realRoots) {
      if (target === root || target.startsWith(root + path.sep)) return resolved;
    }
    throw new RootEscapeError(p);
  };
}
