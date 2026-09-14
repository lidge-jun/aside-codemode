// Regression: Windows reports a delete-pending lock file as EPERM, not EEXIST.
// Observed on windows-latest CI as EPERM thrown out of acquireFileLock under
// Promise.all (test/write-hardening.test.js:123, eight same-process edits of one
// file, so one lock path: unlink then open('wx') during delete-pending).
//
// The predicate is unit-tested with an explicit platform argument, AND the retry
// is driven through acquireFileLock itself with an injected open(). The second
// half matters: a predicate-only test stays green if the guard in acquireFileLock
// is deleted, which would be false confidence about the exact CI race this fixes.
// No wall-clock oracle anywhere; the injected open counts calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireFileLock, isContendedLockError } from '../src/host/file-lock.js';

const CONTENDED_HERE = process.platform === 'win32' ? 'EPERM' : 'EEXIST';

function codeError(code) {
  const e = new Error('injected ' + code);
  e.code = code;
  return e;
}

function target() {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'codemode-lockc-')));
  return path.join(dir, 'subject.txt');
}

test('EEXIST is contention on every platform', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    assert.equal(isContendedLockError('EEXIST', platform), true, platform);
  }
});

test('Windows delete-pending codes count as contention, not a fault', () => {
  assert.equal(isContendedLockError('EPERM', 'win32'), true);
  assert.equal(isContendedLockError('EACCES', 'win32'), true);
});

test('a POSIX permission fault still fails fast instead of spinning', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.equal(isContendedLockError('EPERM', platform), false, platform);
    assert.equal(isContendedLockError('EACCES', platform), false, platform);
  }
});

test('unrelated errors are never swallowed as contention', () => {
  for (const platform of ['win32', 'linux']) {
    for (const code of ['ENOENT', 'ENOSPC', 'EROFS', undefined]) {
      assert.equal(isContendedLockError(code, platform), false, platform + ' ' + code);
    }
  }
});

test('acquireFileLock retries a contended create instead of throwing it', async () => {
  let calls = 0;
  const openImpl = async (p, flags) => {
    calls += 1;
    if (calls === 1) throw codeError(CONTENDED_HERE);
    return open(p, flags);
  };
  const release = await acquireFileLock(target(), { timeoutMs: 5000, openImpl });
  // Deleting the guard in acquireFileLock makes call 1 escape and this fails.
  assert.equal(calls, 2, 'the contended create must be retried, not surfaced');
  await release();
});

test('acquireFileLock still surfaces a non-contended create failure', async () => {
  let calls = 0;
  const openImpl = async () => {
    calls += 1;
    throw codeError('ENOSPC');
  };
  await assert.rejects(
    acquireFileLock(target(), { timeoutMs: 5000, openImpl }),
    (e) => e.code === 'ENOSPC',
  );
  assert.equal(calls, 1, 'a real fault must not be retried');
});
