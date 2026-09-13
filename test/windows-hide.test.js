import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rgChildOpts } from '../src/child-opts.js';

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

test('rg call sites no longer hardcode windowsHide true', () => {
  for (const file of ['rg.js', 'rg-stream.js']) {
    const text = readFileSync(path.join(srcDir, file), 'utf8');
    assert.equal(text.includes('windowsHide: true'), false, file);
  }
});
