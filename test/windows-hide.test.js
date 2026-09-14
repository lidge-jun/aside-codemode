import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRgProcessFns, rgChildOpts } from '../src/child-opts.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('default env omits windowsHide', () => {
  const opts = rgChildOpts({}, {});
  assert.equal(Object.hasOwn(opts, 'windowsHide'), false);
});

test('CODEMODE_WINDOWS_HIDE=1 opts in', () => {
  const opts = rgChildOpts({}, { CODEMODE_WINDOWS_HIDE: '1' });
  assert.equal(opts.windowsHide, true);
});

test('extra timeout is kept and hide stays omitted', () => {
  const opts = rgChildOpts({ timeout: 5 }, {});
  assert.equal(opts.timeout, 5);
  assert.equal(Object.hasOwn(opts, 'windowsHide'), false);
});

test('env 1 overwrites extra windowsHide false', () => {
  const opts = rgChildOpts({ windowsHide: false }, { CODEMODE_WINDOWS_HIDE: '1' });
  assert.equal(opts.windowsHide, true);
});

test('spawnRg forwards rgChildOpts to the process impl', () => {
  const captured = [];
  const { spawnRg } = createRgProcessFns({
    spawnImpl(bin, args, opts) {
      captured.push({ bin, args, opts });
      return { pid: 0 };
    },
  });
  spawnRg('rg', ['--version'], { timeout: 5 }, {});
  assert.equal(Object.hasOwn(captured[0].opts, 'windowsHide'), false);
  assert.equal(captured[0].opts.timeout, 5);

  captured.length = 0;
  spawnRg('rg', ['--version'], {}, { CODEMODE_WINDOWS_HIDE: '1' });
  assert.equal(captured[0].opts.windowsHide, true);
});

test('execFileRg forwards rgChildOpts and does not use promisify', async () => {
  const captured = [];
  const { execFileRg } = createRgProcessFns({
    execFileImpl(bin, args, opts, cb) {
      captured.push({ bin, args, opts });
      cb(null, 'ok', '');
    },
  });
  const hidden = await execFileRg('rg', ['--version'], { timeout: 5 }, { CODEMODE_WINDOWS_HIDE: '1' });
  assert.equal(hidden.stdout, 'ok');
  assert.equal(captured[0].opts.windowsHide, true);
  assert.equal(captured[0].opts.timeout, 5);

  captured.length = 0;
  await execFileRg('rg', ['--version'], { timeout: 5 }, {});
  assert.equal(Object.hasOwn(captured[0].opts, 'windowsHide'), false);
});

test('rg call sites spawn only through child-opts helpers', () => {
  const stream = readFileSync(path.join(srcDir, 'rg-stream.js'), 'utf8');
  const rg = readFileSync(path.join(srcDir, 'rg.js'), 'utf8');
  assert.match(stream, /spawnRg\(/);
  assert.equal(/\bspawn\s*\(/.test(stream), false);
  assert.match(rg, /execFileRg/);
  assert.match(rg, /execFileP\('where\.exe'/);
  assert.equal(/windowsHide/.test(stream + rg), false);
});
