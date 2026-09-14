// Run one Aside REPL invocation under a host deadline.
//
// The deadline here is deliberately the LATER of the two: the compiled script races its own
// inner timer and exits cleanly, and this one only fires if that failed. That ordering is not
// a preference — a killed CLI leaks its tabs permanently and no later session can close them
// (001 E5), so reaching this timer already means something was lost.
import { spawnAsideChild } from '../../child-opts.js';

export class AsideSpawnError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AsideSpawnError';
    this.code = code;
  }
}

export function createAsideSpawner({ spawnImpl = spawnAsideChild, killTree } = {}) {
  return function spawnAside(bin, args, { hostMs = 30000, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new AsideSpawnError('browse cancelled before the child was spawned', 'ECANCELLED'));
        return;
      }
      let child;
      try {
        child = spawnImpl(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        reject(new AsideSpawnError(`could not start the Aside CLI: ${e.message}`, 'ESPAWN'));
        return;
      }

      let stdout = '';
      let stderr = '';
      let killed = false;
      let settled = false;

      if (child.stdout) child.stdout.on('data', (d) => { stdout += String(d); });
      if (child.stderr) child.stderr.on('data', (d) => { stderr += String(d); });

      const stop = () => {
        killed = true;
        try {
          if (typeof killTree === 'function') killTree(child.pid);
          else child.kill('SIGKILL');
        } catch (_) { /* the child may already be gone */ }
      };

      const timer = setTimeout(stop, hostMs);
      const onAbort = () => stop();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        fn(arg);
      };

      child.on('error', (e) => finish(reject, new AsideSpawnError(`Aside CLI failed to run: ${e.message}`, 'ESPAWN')));
      child.on('close', (exitCode) => {
        // exitCode is deliberately NOT a success signal: the CLI exits 0 on failure (001 E1).
        finish(resolve, { stdout, stderr, exitCode, killed });
      });
    });
  };
}
