// Find the Aside CLI on SOMEONE ELSE'S machine.
//
// This follows src/rg.js: an explicit path is authoritative, discovery is a candidate list,
// and a miss throws with everything that was tried instead of a bare ENOENT.
//
// The Windows case has a measured trap. The installer creates
// %LOCALAPPDATA%\\Aside\\CLI\\current as a junction whose print name is the NT form
// (\\??\\C:\\...), and right after install that directory reads as EMPTY: Test-Path on
// current\\aside.exe returns False while `dir /AL` shows the junction pointing at a real
// versions\\<v> folder. So `current` is tried first and the newest versions\\* directory is
// the fallback. Resolving only through `current` would fail on a fresh install.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// Existence is not identity. Prove a candidate answers --version like a CLI, because the
// macOS app bundle contains a binary with the same name that silently launches the GUI.
export function verifyAside(bin, { execFileImpl = execFile, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    try {
      execFileImpl(bin, ['--version'], { timeout: timeoutMs }, (err, stdout) => {
        const text = String(stdout || '').trim();
        resolve(!err && /^\d+\.\d+/.test(text) ? text : null);
      });
    } catch (_) { resolve(null); }
  });
}

export class AsideNotFoundError extends Error {
  constructor(message, candidates) {
    super(message);
    this.name = 'AsideNotFoundError';
    this.code = 'ENOASIDE';
    this.candidates = candidates;
  }
}

function newestVersionBin(root, exe) {
  const versions = path.join(root, 'versions');
  if (!existsSync(versions)) return [];
  let names;
  try { names = readdirSync(versions); } catch (_) { return []; }
  return names
    .map((n) => path.join(versions, n, exe))
    .filter((p) => { try { return statSync(p).isFile(); } catch (_) { return false; } })
    .sort()
    .reverse();
}

export function asideCandidates(config = {}, env = process.env, platform = process.platform) {
  const out = [];
  if (typeof config.asidePath === 'string' && config.asidePath) out.push(config.asidePath);
  if (env.CODEMODE_ASIDE) out.push(env.CODEMODE_ASIDE);

  // Join with the flavour of the TARGET platform, not the host's. `path` is win32-flavoured
  // on Windows, so path.join on a POSIX home produced \\Users\\x\\Applications\\... — a path
  // that exists on no machine. This only shows up when building candidates for another OS,
  // which is exactly the case a cross-platform resolver has to get right.
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const home = env.USERPROFILE || env.HOME || os.homedir();
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || (home && join(home, 'AppData', 'Local'));
    if (local) {
      const cliRoot = join(local, 'Aside', 'CLI');
      out.push(join(cliRoot, 'current', 'aside.exe'));
      out.push(...newestVersionBin(cliRoot, 'aside.exe'));
    }
  } else {
    // Order matters, and it was measured. On a real mac the CLI lives in ~/.local/bin.
    //
    // /Applications/Aside.app/Contents/MacOS/aside is deliberately NOT a candidate: that
    // binary is the GUI launcher, not the CLI. Resolving to it on macmini printed
    // "기존 브라우저 세션에서 여는 중입니다." and exited without ever emitting a marker, so
    // every browse call failed with ENOMARKER while the file plainly existed. An existence
    // check cannot tell those two binaries apart, which is why verifyAside below proves a
    // candidate with --version the way resolveRg proves ripgrep.
    if (home) out.push(join(home, '.local', 'bin', 'aside'));
    out.push('/opt/homebrew/bin/aside');
    out.push('/usr/local/bin/aside');
    if (home) out.push(join(home, '.aside', 'bin', 'aside'));
  }
  return [...new Set(out.filter(Boolean))];
}

export function createAsideResolver(config = {}, env = process.env, { platform = process.platform, exists = existsSync, verify = null } = {}) {
  let cached = null;
  return async function resolveAside() {
    if (cached) return cached;
    const candidates = asideCandidates(config, env, platform);

    // An explicitly configured path is authoritative: if the operator named it and it is
    // not there, silently walking to a different binary would hide their mistake.
    const explicit = (typeof config.asidePath === 'string' && config.asidePath) || env.CODEMODE_ASIDE;
    if (explicit) {
      if (exists(explicit)) { cached = explicit; return cached; }
      throw new AsideNotFoundError(`configured Aside path does not exist: ${explicit}`, candidates);
    }

    for (const c of candidates) {
      if (!exists(c)) continue;
      // When a verifier is supplied, a candidate must PROVE it is the CLI.
      if (verify) {
        const v = await verify(c);
        if (!v) continue;
      }
      cached = c;
      return cached;
    }
    throw new AsideNotFoundError(
      'could not find the Aside CLI. Set browse.asidePath in the codemode config or CODEMODE_ASIDE.',
      candidates,
    );
  };
}
