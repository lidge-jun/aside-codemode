// Streaming child-process reader for ripgrep (extracted from src/rg.js).
//
// Why streaming instead of execFile buffering (measured 2026-09-13, macOS):
//   search.files({ path: '~/Developer', max: 10 }) died with
//   "stdout maxBuffer length exceeded" even though only 10 rows were wanted —
//   execFile buffers the WHOLE rg output before JS ever sees a row, so `max`
//   was applied after the damage. We read stdout incrementally and kill rg once
//   the cap is exceeded, which makes `max` an actual bound on work.
//
// Two correctness rules this module owns:
//  1. `max` is an EXACT cap, not an off-by-one. Accepting the (max+1)-th row
//     before killing is what tells truncated (`more existed`) apart from a
//     complete answer that happens to be exactly `max` rows long. The extra row
//     is handed back to the caller through `onOverflow` to drop.
//  2. Termination by SIGNAL is not success. `close` used to treat code === null
//     (the killed case) the same as exit 0, so an externally killed rg returned
//     its partial rows as a clean, complete answer.
import { spawn } from 'node:child_process';
import { rgChildOpts } from './child-opts.js';

export const RG_TIMEOUT_MS = 30000;
const STDERR_CAP = 4096;

export function throwIfSearchCancelled(signal) {
  if (signal?.aborted) throw Object.assign(new Error('search cancelled'), { code: 'ECANCELLED' });
}

export class RgFailedError extends Error {
  constructor(message, { exitCode = null, stderr = '', signal = null } = {}) {
    super(message);
    this.name = 'RgFailedError';
    this.code = 'ERGFAIL';
    this.exitCode = exitCode;
    if (signal) this.signal = signal;
    if (stderr) this.stderr = stderr;
  }
}

/**
 * Spawn a process and feed its stdout to `onLine`, one record at a time.
 *
 * @param {string} bin executable path (argv-only, never a shell)
 * @param {string[]} args
 * @param {object} o
 * @param {number} [o.max] accepted-row cap; omit/Infinity for unbounded
 * @param {(line:string)=>boolean} o.onLine returns true when the record counts
 *        toward `max` (the caller has committed it)
 * @param {()=>void} [o.onOverflow] called once when one row beyond `max` was
 *        accepted, so the caller can discard it
 * @param {number} [o.timeoutMs]
 * @param {string} [o.delimiter] record separator; '\0' for rg --null
 * @returns {Promise<{truncated:boolean, accepted:number, stderr:string,
 *                    exitCode:number|null, killedBySignal:string|null}>}
 */
export function runStream(bin, args, {
  max = Infinity,
  onLine,
  onOverflow,
  timeoutMs = RG_TIMEOUT_MS,
  delimiter = '\n',
  signal: abortSignal,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    if (abortSignal?.aborted) {
      reject(Object.assign(new RgFailedError('search cancelled before spawn'), { code: 'ECANCELLED' }));
      return;
    }
    try {
      child = spawn(bin, args, rgChildOpts());
    } catch (e) {
      reject(e.code === 'ECANCELLED' ? e : new RgFailedError(`cannot spawn rg: ${e.message}`));
      return;
    }
    let buf = '';
    let accepted = 0;
    let truncated = false;
    let settled = false;
    let selfKilled = false;
    let stderr = '';

    const timer = setTimeout(() => {
      selfKilled = true;
      try { child.kill('SIGKILL'); } catch {}
      finish(new RgFailedError(`rg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const cancel = () => {
      selfKilled = true;
      try { child.kill('SIGKILL'); } catch {}
      finish(Object.assign(new RgFailedError('search cancelled'), { code: 'ECANCELLED' }));
    };
    abortSignal?.addEventListener('abort', cancel, { once: true });

    function finish(err, { exitCode = null, signal = null } = {}) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', cancel);
      if (err) reject(err);
      else {
        resolve({
          truncated,
          accepted,
          stderr: stderr.trim(),
          exitCode,
          killedBySignal: signal,
        });
      }
    }

    function feed(line) {
      if (!line || truncated || settled) return;
      if (!onLine(line) || settled) return;
      accepted += 1;
      // The row that pushes us PAST max proves more existed. Drop it and stop.
      if (accepted > max) {
        accepted -= 1;
        truncated = true;
        if (onOverflow) onOverflow();
        selfKilled = true;
        try { child.kill('SIGTERM'); } catch {}
      }
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (settled || truncated) return;
      buf += chunk;
      let idx;
      while (!settled && !truncated && (idx = buf.indexOf(delimiter)) !== -1) {
        const line = delimiter === '\n' ? buf.slice(0, idx).replace(/\r$/, '') : buf.slice(0, idx);
        buf = buf.slice(idx + delimiter.length);
        feed(line);
      }
      if (truncated) buf = '';
    });
    child.stdout.on('error', () => {}); // EPIPE after our own kill

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      if (stderr.length < STDERR_CAP) stderr += d;
    });
    child.stderr.on('error', () => {});

    child.on('error', (e) => {
      const error = new RgFailedError(`rg failed: ${e.message}`);
      if (abortSignal?.aborted) error.code = 'ECANCELLED';
      finish(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (!truncated && buf) feed(delimiter === '\n' ? buf.replace(/\r$/, '') : buf);
      // Our own max-cap kill: the result is complete-as-requested and truncated.
      if (truncated) return finish(null, { exitCode: code, signal: null });

      // Killed by a signal we did not send (OOM killer, operator, supervisor).
      // Reporting those rows as a finished search is the dangerous case: the
      // caller cannot tell "no more matches" from "stopped early".
      if (signal && !selfKilled) {
        if (accepted > 0) return finish(null, { exitCode: code, signal });
        const why = stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ').slice(0, 400);
        return finish(new RgFailedError(
          `rg terminated by signal ${signal} with no results${why ? `: ${why}` : ''}`,
          { exitCode: code, stderr: why, signal },
        ));
      }

      // rg exit codes: 0 = matches, 1 = no matches, 2 = error. Exit 2 covers
      // BOTH a fatal error (bad regex) and a soft one (a single unreadable
      // file), so failing the whole call on 2 threw away good results for an
      // unrelated permission problem. Rule: if rows were produced, return them
      // with a `partial` warning; only a 2 with nothing to show is an error.
      if (code === 0 || code === 1) return finish(null, { exitCode: code, signal: null });
      if (code === 2 && accepted > 0) return finish(null, { exitCode: code, signal: null });
      if (code === null) {
        // No exit code and no signal we know about: treat as an unexplained
        // termination rather than a clean finish.
        if (accepted > 0) return finish(null, { exitCode: null, signal: signal ?? 'UNKNOWN' });
        return finish(new RgFailedError('rg terminated by signal UNKNOWN with no results', { signal: 'UNKNOWN' }));
      }
      // Include rg's own diagnosis. "exited with code 2" is unactionable;
      // "regex parse error: unclosed character class" is self-correctable.
      const why = stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ').slice(0, 400);
      finish(new RgFailedError(
        `rg exited with code ${code}${why ? `: ${why}` : ''}`,
        { exitCode: code, stderr: why },
      ));
    });
  });
}
