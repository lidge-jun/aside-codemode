// Shared child_process options for rg (issue #5).
// Aside's Windows shell can die with 0xC0000142 when windowsHide is true.
// Default: omit the key. Opt-in only when CODEMODE_WINDOWS_HIDE === '1'.
// Never set shell. Extra is copied, not mutated.
import { spawn, execFile } from 'node:child_process';

export function rgChildOpts(extra = {}, env = process.env) {
  const opts = { ...extra };
  if (env.CODEMODE_WINDOWS_HIDE === '1') opts.windowsHide = true;
  return opts;
}

export function createRgProcessFns({ spawnImpl = spawn, execFileImpl = execFile } = {}) {
  return {
    spawnRg(bin, args, extra = {}, env = process.env) {
      return spawnImpl(bin, args, rgChildOpts(extra, env));
    },
    execFileRg(bin, args, extra = {}, env = process.env) {
      return new Promise((resolve, reject) => {
        execFileImpl(bin, args, rgChildOpts(extra, env), (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
    },
  };
}

export const { spawnRg, execFileRg } = createRgProcessFns();
