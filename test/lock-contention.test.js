// Regression: Windows reports a delete-pending lock file as EPERM, not EEXIST.
// Observed on windows-latest CI as an EPERM thrown out of acquireFileLock at
// Promise.all index 7. The predicate is unit-tested directly with an explicit
// platform argument so the check is deterministic on every CI runner instead of
// depending on a race being lost (this repo does not use timing as an oracle).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isContendedLockError } from '../src/host/file-lock.js';

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

test('the default platform argument is the running platform', () => {
  assert.equal(isContendedLockError('EPERM'), process.platform === 'win32');
});
