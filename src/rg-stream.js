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
import { spawnRg } from './child-opts.js';

export const RG_TIMEOUT_MS = 30000;
export const RG_MAX_RECORD_BYTES = 256 * 1024; // 256 KiB
export const RG_MAX_STDOUT_BYTES = 4 * 1024 * 1024; // 4 MiB
export const RG_MAX_RETAINED_BYTES = 4 * 1024 * 1024; // 4 MiB

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
 * @param {(line:string, controls:{stop:(opts?:{warning?:string,truncated?:boolean})=>void})=>boolean|{stop:boolean,warning?:string,truncated?:boolean}} o.onLine returns true when the record counts
 *        toward `max` (the caller has committed it)
 * @param {()=>void} [o.onOverflow] called once when one row beyond `max` was
 *        accepted, so the caller can discard it
 * @param {number} [o.timeoutMs]
 * @param {string} [o.delimiter] record separator; '\0' for rg --null
 * @param {AbortSignal} [o.signal]
 * @param {number} [o.maxRecordBytes] cap on single record buffer before delimiter
 * @param {number} [o.maxStdoutBytes] cap on aggregate stdout bytes read
 * @param {(info: {type: string, bytes: number, limit: number})=>void} [o.onDiscardRecord]
 * @returns {Promise<{truncated:boolean, accepted:number, stderr:string,
 *                    exitCode:number|null, killedBySignal:string|null,
 *                    totalStdoutBytes:number, stdoutBudgetExceeded:boolean,
 *                    oversizedRecords:number, warnings:string[]}>}
 */
export function runStream(bin, args, {
  max = Infinity,
  onLine,
  onOverflow,
  timeoutMs = RG_TIMEOUT_MS,
  delimiter = '\n',
  signal: abortSignal,
  maxRecordBytes = RG_MAX_RECORD_BYTES,
  maxStdoutBytes = RG_MAX_STDOUT_BYTES,
  onDiscardRecord,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    if (abortSignal?.aborted) {
      reject(Object.assign(new RgFailedError('search cancelled before spawn'), { code: 'ECANCELLED' }));
      return;
    }
    try {
      child = spawnRg(bin, args);
    } catch (e) {
      reject(e.code === 'ECANCELLED' ? e : new RgFailedError(`cannot spawn rg: ${e.message}`));
      return;
    }
    let buf = '';
    let bufBytes = 0;
    let accepted = 0;
    let truncated = false;
    let settled = false;
    let selfKilled = false;
    let stderr = '';
    let totalStdoutBytes = 0;
    let stdoutBudgetExceeded = false;
    let oversizedRecords = 0;
    let discardingOversized = false;
    const warnings = [];

    function emitWarning(warning) {
      if (!warnings.includes(warning)) {
        warnings.push(warning);
      }
    }

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
        if (oversizedRecords > 0) {
          emitWarning(`record-budget-exceeded: ${oversizedRecords} record(s) exceeded limit of ${maxRecordBytes} bytes`);
        }
        if (stdoutBudgetExceeded) {
          emitWarning(`stdout-budget-exceeded: raw output exceeded limit of ${maxStdoutBytes} bytes`);
        }
        resolve({
          truncated,
          accepted,
          stderr: stderr.trim(),
          exitCode,
          killedBySignal: signal,
          totalStdoutBytes,
          stdoutBudgetExceeded,
          oversizedRecords,
          warnings: [...warnings],
        });
      }
    }

    function feed(line) {
      if (!line || truncated || settled || stdoutBudgetExceeded) return;
      const controls = {
        stop({ warning, truncated: stopTruncated = true } = {}) {
          if (settled) return;
          if (stopTruncated) truncated = true;
          if (warning) emitWarning(warning);
          selfKilled = true;
          try { child.kill('SIGTERM'); } catch {}
        },
      };
      const res = onLine(line, controls);
      if (res && typeof res === 'object' && res.stop) {
        controls.stop({ warning: res.warning, truncated: res.truncated ?? true });
        return;
      }
      if (res !== true || settled || stdoutBudgetExceeded || truncated) return;
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
      if (settled || truncated || stdoutBudgetExceeded) return;
      const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const chunkBytes = Buffer.byteLength(chunkStr, 'utf8');
      totalStdoutBytes += chunkBytes;

      if (totalStdoutBytes > maxStdoutBytes) {
        stdoutBudgetExceeded = true;
        truncated = true;
        selfKilled = true;
        try { child.kill('SIGTERM'); } catch {}
        emitWarning(`stdout-budget-exceeded: raw output exceeded limit of ${maxStdoutBytes} bytes`);
        buf = '';
        bufBytes = 0;
        return;
      }

      let remaining = chunkStr;
      while (remaining.length > 0 && !settled && !truncated && !stdoutBudgetExceeded) {
        if (discardingOversized) {
          const idx = remaining.indexOf(delimiter);
          if (idx === -1) {
            // Whole remaining chunk is still part of the oversized record
            break;
          }
          // Delimiter found: oversized record ends here
          discardingOversized = false;
          remaining = remaining.slice(idx + delimiter.length);
          continue;
        }

        const idx = remaining.indexOf(delimiter);
        if (idx !== -1) {
          const piece = remaining.slice(0, idx);
          remaining = remaining.slice(idx + delimiter.length);
          const pieceBytes = Buffer.byteLength(piece, 'utf8');
          if (bufBytes + pieceBytes > maxRecordBytes) {
            oversizedRecords += 1;
            emitWarning(`record-budget-exceeded: record exceeded limit of ${maxRecordBytes} bytes`);
            if (onDiscardRecord) {
              try { onDiscardRecord({ type: 'oversized', bytes: bufBytes + pieceBytes, limit: maxRecordBytes }); } catch {}
            }
            buf = '';
            bufBytes = 0;
          } else {
            const fullLine = buf + piece;
            buf = '';
            bufBytes = 0;
            const line = delimiter === '\n' ? fullLine.replace(/\r$/, '') : fullLine;
            feed(line);
          }
        } else {
          // No delimiter in remaining
          const pieceBytes = Buffer.byteLength(remaining, 'utf8');
          if (bufBytes + pieceBytes > maxRecordBytes) {
            oversizedRecords += 1;
            emitWarning(`record-budget-exceeded: record exceeded limit of ${maxRecordBytes} bytes`);
            if (onDiscardRecord) {
              try { onDiscardRecord({ type: 'oversized', bytes: bufBytes + pieceBytes, limit: maxRecordBytes }); } catch {}
            }
            buf = '';
            bufBytes = 0;
            discardingOversized = true;
            break;
          } else {
            buf += remaining;
            bufBytes += pieceBytes;
            break;
          }
        }
      }

      if (truncated || stdoutBudgetExceeded) {
        buf = '';
        bufBytes = 0;
      }
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
      if (!truncated && !stdoutBudgetExceeded && !discardingOversized && buf) {
        feed(delimiter === '\n' ? buf.replace(/\r$/, '') : buf);
      }
      buf = '';
      bufBytes = 0;

      // Our own max-cap kill: the result is complete-as-requested and truncated.
      if (truncated) return finish(null, { exitCode: code, signal: null });

      // Our own stdout budget kill: stopped early due to budget.
      if (stdoutBudgetExceeded) return finish(null, { exitCode: code, signal: null });

      // Killed by a signal we did not send (OOM killer, operator, supervisor).
      // Reporting those rows as a finished search is the dangerous case: the
      // caller cannot tell "no more matches" from "stopped early".
      if (signal && !selfKilled) {
        if (accepted > 0 || oversizedRecords > 0) return finish(null, { exitCode: code, signal });
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
      if (code === 2 && (accepted > 0 || oversizedRecords > 0)) return finish(null, { exitCode: code, signal: null });
      if (code === null) {
        // No exit code and no signal we know about: treat as an unexplained
        // termination rather than a clean finish.
        if (accepted > 0 || oversizedRecords > 0) return finish(null, { exitCode: null, signal: signal ?? 'UNKNOWN' });
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
