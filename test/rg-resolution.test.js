import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  createDetailedRgResolver,
  createRgResolver,
  getAsideBundledRgPath,
  RgNotFoundError,
} from '../src/rg.js';

const darwinHome = '/Users/someone';
const windowsHome = 'C:\\Users\\someone';

function resolverOptions({ platform = 'darwin', valid = [], calls = [], where = async () => null } = {}) {
  return {
    platform,
    homedir: () => platform === 'win32' ? windowsHome : darwinHome,
    packageRoot: platform === 'win32' ? 'C:\\package' : '/package',
    where,
    verify: async (candidate) => {
      calls.push(candidate);
      if (!valid.includes(candidate)) throw Object.assign(new Error('not executable'), { code: 'ENOENT' });
    },
  };
}

test('Aside bundled rg resolves with an empty PATH and reports provenance', async () => {
  const bundled = getAsideBundledRgPath({ platform: 'darwin', homedir: () => darwinHome });
  const resolve = createDetailedRgResolver({}, { PATH: '' }, resolverOptions({ valid: [bundled] }));

  assert.deepEqual(await resolve(), { path: bundled, source: 'aside-bundled' });
});

test('a missing Aside bundle falls through to the next valid candidate', async () => {
  const systemRg = '/system/bin/rg';
  const resolve = createDetailedRgResolver({}, { PATH: '/system/bin' }, resolverOptions({ valid: [systemRg] }));

  assert.deepEqual(await resolve(), { path: systemRg, source: 'path' });
});

test('no candidate throws structured ERG404 with failed probes', async () => {
  const resolve = createDetailedRgResolver({}, { PATH: '' }, resolverOptions());

  await assert.rejects(resolve(), (error) => {
    assert.ok(error instanceof RgNotFoundError);
    assert.equal(error.code, 'ERG404');
    assert.ok(error.candidates.length > 0);
    return true;
  });
});

test('an explicit bad path throws without probing the Aside bundle', async () => {
  const calls = [];
  const explicit = '/configured/rg';
  const bundled = getAsideBundledRgPath({ platform: 'darwin', homedir: () => darwinHome });
  const resolve = createRgResolver({ rgPath: explicit }, {}, resolverOptions({ calls, valid: [bundled] }));

  await assert.rejects(resolve(), RgNotFoundError);
  assert.deepEqual(calls, [explicit]);
});

test('simulated win32 falls through to package-vendored rg last', async () => {
  const calls = [];
  const vendored = path.win32.join('C:\\package', 'bin', 'rg.exe');
  const resolve = createDetailedRgResolver({}, { PATH: '' }, resolverOptions({
    platform: 'win32',
    calls,
    valid: [vendored],
    where: async () => 'C:\\system\\rg.exe',
  }));

  assert.deepEqual(await resolve(), { path: vendored, source: 'package-vendored' });
  assert.equal(calls.at(-1), vendored);
});

test('candidate ordering is bundle, PATH, then fixed locations with duplicates removed', async () => {
  const calls = [];
  const bundled = getAsideBundledRgPath({ platform: 'darwin', homedir: () => darwinHome });
  const resolve = createDetailedRgResolver({}, { PATH: '/path/bin:/opt/homebrew/bin' }, resolverOptions({
    calls,
    valid: ['/usr/local/bin/rg'],
  }));

  assert.deepEqual(await resolve(), { path: '/usr/local/bin/rg', source: 'well-known' });
  assert.deepEqual(calls, [
    bundled,
    '/path/bin/rg',
    '/opt/homebrew/bin/rg',
    '/usr/local/bin/rg',
  ]);
});

test('Aside bundled path construction is platform-specific', () => {
  assert.equal(
    getAsideBundledRgPath({ platform: 'darwin', homedir: () => darwinHome }),
    '/Users/someone/.aside/runtime/native/bin/rg',
  );
  assert.equal(
    getAsideBundledRgPath({ platform: 'win32', homedir: () => windowsHome }),
    'C:\\Users\\someone\\.aside\\runtime\\native\\bin\\rg.exe',
  );
  assert.equal(getAsideBundledRgPath({ platform: 'linux', homedir: () => '/home/someone' }), null);
});
