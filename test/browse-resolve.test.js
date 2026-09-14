// Finding Aside on a machine that is not this one.
// The candidate list is built for a TARGET platform, so these run identically on every
// CI runner: no real Aside is required and no host path is assumed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { asideCandidates, createAsideResolver, AsideNotFoundError } from '../src/host/browse/resolve.js';

test('macOS candidates use POSIX separators even when built from Windows', () => {
  const c = asideCandidates({}, { HOME: '/Users/someone' }, 'darwin');
  for (const p of c) {
    assert.ok(!p.includes('\\'), `candidate must not contain a backslash: ${p}`);
    assert.ok(p.startsWith('/'), `candidate must be absolute POSIX: ${p}`);
  }
  assert.ok(c.includes('/Users/someone/.aside/bin/aside'));
});

test('Windows candidates try the junction first and fall back to a version directory', () => {
  // Measured: a fresh install leaves CLI\\current reading as empty because the junction
  // print name is the NT form, so resolving only through `current` fails on a new machine.
  const c = asideCandidates({}, { LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local' }, 'win32');
  assert.equal(c[0], 'C:\\Users\\someone\\AppData\\Local\\Aside\\CLI\\current\\aside.exe');
  for (const p of c) assert.ok(!p.includes('/'), `windows candidate must not contain a forward slash: ${p}`);
});

test('no candidate leaks the machine this was developed on', () => {
  for (const platform of ['win32', 'darwin']) {
    for (const p of asideCandidates({}, { HOME: '/Users/someone', LOCALAPPDATA: 'C:\\x' }, platform)) {
      assert.ok(!/\\bsuper\\b/.test(p), `candidate must not hardcode a developer home: ${p}`);
    }
  }
});

test('an explicitly configured path is authoritative and fails loudly when absent', async () => {
  const resolve = createAsideResolver({ asidePath: '/nope/aside' }, {}, { platform: 'darwin', exists: () => false });
  await assert.rejects(resolve(), (e) => e instanceof AsideNotFoundError && e.code === 'ENOASIDE');
});

test('an explicit path is not silently replaced by a discovered one', async () => {
  const seen = [];
  const resolve = createAsideResolver({ asidePath: '/nope/aside' }, {}, {
    platform: 'darwin',
    exists: (p) => { seen.push(p); return p === '/usr/local/bin/aside'; },
  });
  await assert.rejects(resolve(), /configured Aside path does not exist/);
  assert.deepEqual(seen, ['/nope/aside'], 'discovery must not run once an explicit path was given');
});

test('discovery picks the first candidate that exists and caches it', async () => {
  let calls = 0;
  const resolve = createAsideResolver({}, { HOME: '/Users/someone' }, {
    platform: 'darwin',
    exists: (p) => { calls += 1; return p === '/opt/homebrew/bin/aside'; },
  });
  assert.equal(await resolve(), '/opt/homebrew/bin/aside');
  const first = calls;
  assert.equal(await resolve(), '/opt/homebrew/bin/aside');
  assert.equal(calls, first, 'a resolved path must be cached');
});

test('a total miss names every path it tried', async () => {
  const resolve = createAsideResolver({}, { HOME: '/Users/someone' }, { platform: 'darwin', exists: () => false });
  const e = await resolve().catch((x) => x);
  assert.ok(Array.isArray(e.candidates) && e.candidates.length >= 4);
  assert.match(e.message, /CODEMODE_ASIDE/);
});
