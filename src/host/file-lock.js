// Cross-process exclusive file lock (slice 030 / plan D4).
//
// Why a real lock file and not an in-memory mutex: the observed defect is a
// lost update, and the cooperating writers are separate OS processes (one
// `codemode --code` invocation per agent round trip). A module-level Map is
// invisible to the other process, so it would make the same-process test green
// while the actual field symptom survived untouched.
//
// Policy, in order of importance:
//   * O_EXCL create is the primitive. It is atomic on POSIX and on Windows.
//   * The key is the CANONICAL RESOLVED target path, so two different spellings
//     of the same file serialize against each other.
//   * A lock we do not own is NEVER deleted, however old it looks. A stale-lock
//     heuristic that guesses wrong silently reintroduces the lost update this
//     module exists to prevent. We fail closed and print what a human needs to
//     clean up by hand.
//   * Waiting is bounded. An unbounded wait turns one crashed process into a
//     permanently wedged agent.
//   * Lock files live under the OS temp dir, not beside the target, so they
//     never appear in a search of the user's source tree and never get
//     committed.
import { open, readFile, unlink } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const isWindows = process.platform === 'win32';

export const LOCK_DIR = path.join(os.tmpdir(), 'codemode-locks');
export const DEFAULT_LOCK_TIMEOUT_MS = 10000;

let lockDirReady = false;
function ensureLockDir() {
  if (lockDirReady) return;
  mkdirSync(LOCK_DIR, { recursive: true });
  lockDirReady = true;
}

export class LockTimeoutError extends Error {
  constructor(message, { target, lockPath, holder, waitedMs }) {
    super(message);
    this.name = 'LockTimeoutError';
    this.code = 'ELOCKED';
    this.target = target;
    this.lockPath = lockPath;
    this.holder = holder;
    this.waitedMs = waitedMs;
  }
}

export class LockAbortError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AbortError';
    this.code = 'ABORT_ERR';
  }
}

// Canonical key: the resolved absolute path, case-folded only where the
// filesystem itself is case-insensitive. assertInside already realpath'd the
// nearest existing ancestor, so this receives a canonical path.
export function lockPathFor(target) {
  const key = isWindows ? path.resolve(target).toLowerCase() : path.resolve(target);
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 40);
  return path.join(LOCK_DIR, `${digest}.lock`);
}

async function readHolder(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function describeHolder(holder, lockPath, target, waitedMs) {
  const pid = holder?.pid ?? 'unknown';
  const since = holder?.acquiredAt ? new Date(holder.acquiredAt).toISOString() : 'unknown time';
  return (
    `file is locked by another codemode writer: ${target}\n` +
    `  holder pid: ${pid} (lock taken at ${since})\n` +
    `  lock file: ${lockPath}\n` +
    `  waited ${waitedMs}ms and gave up; the lock was NOT stolen.\n` +
    '  If you are certain that pid is dead (the process crashed), recover by hand: ' +
    `verify with \`ps -p ${pid}\` and then delete ${lockPath}. ` +
    'codemode never removes a lock it does not own, because guessing wrong silently loses a write.'
  );
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new LockAbortError('operation aborted before the file lock was acquired');
}

/**
 * Acquire the exclusive lock for `target`.
 * Resolves to a release function that is safe to call once, in a `finally`.
 */
export async function acquireFileLock(target, { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS, signal } = {}) {
  throwIfAborted(signal);
  ensureLockDir();
  const lockPath = lockPathFor(target);
  const token = randomUUID();
  const startedAt = Date.now();
  let backoff = 2;

  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const waited = Date.now() - startedAt;
      if (waited >= timeoutMs) {
        const holder = await readHolder(lockPath);
        throw new LockTimeoutError(describeHolder(holder, lockPath, target, waited), {
          target,
          lockPath,
          holder,
          waitedMs: waited,
        });
      }
      await waitABit(Math.min(backoff, 25), signal);
      backoff *= 2;
      continue;
    }

    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, token, target, acquiredAt: Date.now() }),
      );
    } finally {
      await handle.close();
    }

    let released = false;
    return async function release() {
      if (released) return;
      released = true;
      // Only remove the lock if it is still OURS. If a human deleted it and a
      // second writer took it, unlinking here would hand a third writer a lock
      // that someone else is holding. An unreadable/unparseable lock file is
      // treated as someone else's too: we cannot prove we own it, and the
      // fail-closed choice is to leave it for manual recovery rather than
      // delete a lock that may be protecting another writer.
      const holder = await readHolder(lockPath);
      if (!holder || holder.token !== token) return;
      try {
        await unlink(lockPath);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    };
  }
}

function waitABit(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LockAbortError('operation aborted while waiting for the file lock'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new LockAbortError('operation aborted while waiting for the file lock'));
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Run `fn` while holding the exclusive lock for `target`.
 * The lock is always released, including on error and on abort — a failed write
 * must never leave a lock behind, or one bad edit wedges the file forever.
 */
export async function withFileLock(target, { timeoutMs, signal } = {}, fn) {
  const release = await acquireFileLock(target, { timeoutMs, signal });
  try {
    throwIfAborted(signal);
    return await fn();
  } finally {
    await release();
  }
}
