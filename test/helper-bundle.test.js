// wp8. The helper the host inlines and the helper an install copies have to be the same
// bytes, or the sha256 in a result envelope proves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  helperSource, helperStamp, HELPER_URL, HELPER_VERSION, HELPER_MAX_BYTES,
  HELPER_INSTALL_RELPATH, HELPER_LOAD_RELPATH,
  helperLoadPathFor,
} from '../src/host/browse/helper-bundle.js';
import { compile } from '../src/host/browse/script.js';
import { validateJob } from '../src/host/browse/schema.js';

test('the version placeholder is substituted, not shipped', () => {
  const raw = readFileSync(HELPER_URL, 'utf8');
  assert.ok(raw.includes('__CM_VERSION__'), 'the file on disk is the template');
  const bundle = helperSource();
  assert.equal(bundle.src.includes('__CM_VERSION__'), false);
  assert.ok(bundle.src.includes(HELPER_VERSION));
  assert.equal(bundle.version, HELPER_VERSION);
});

test('the hash is over the substituted source a run actually receives', () => {
  const bundle = helperSource();
  assert.equal(bundle.sha256, createHash('sha256').update(bundle.src).digest('hex'));
  assert.equal(bundle.bytes, Buffer.byteLength(bundle.src));
  assert.deepEqual(helperStamp(), { version: bundle.version, sha256: bundle.sha256, bytes: bundle.bytes });
});

test('a different version is a different hash', () => {
  assert.notEqual(helperSource('9.9.9').sha256, helperSource(HELPER_VERSION).sha256);
  assert.equal(helperSource(HELPER_VERSION).version, HELPER_VERSION, 'the cache did not keep the other build');
});

test('the helper stays small enough to read and to fit the wire', () => {
  assert.ok(helperSource().bytes <= HELPER_MAX_BYTES,
    'cm.js is ' + helperSource().bytes + ' bytes, over the ' + HELPER_MAX_BYTES + ' budget');
});

test('helper:false adds nothing at all to the generated script', () => {
  const base = { urls: ['https://a.test/'], timeoutMs: 20000 };
  const without = compile(validateJob({ ...base }), null);
  const withHelper = compile(validateJob({ ...base, helper: true }), null);
  assert.equal(without.includes('globalThis.cm'), false);
  assert.ok(withHelper.includes('globalThis.cm'));
  assert.equal(withHelper.length > without.length, true);
  // The whole reason it is opt-in: it is a measurable share of a hard 30000-character cap.
  assert.ok(withHelper.length - without.length < 6000, 'inlined cost grew to ' + (withHelper.length - without.length));
  assert.ok(withHelper.length < 30000);
});

test('the install path and the CLI-only load path name the same file from two places', () => {
  // 'aside repl' resolves a relative read from its session directory, two levels under the
  // account root, so this pair holds there. It does NOT hold on the in-app agent REPL, which
  // resolves from the account root; that is why documents get the absolute form instead.
  assert.equal(HELPER_INSTALL_RELPATH, 'codemode/cm.js');
  assert.equal(HELPER_LOAD_RELPATH, '../../' + HELPER_INSTALL_RELPATH);
});

test('the absolute load path is per account and uses forward slashes everywhere', () => {
  assert.equal(helperLoadPathFor('/Users/someone/.aside/u/0'), '/Users/someone/.aside/u/0/codemode/cm.js');
  assert.equal(helperLoadPathFor('/Users/someone/.aside/u/1'), '/Users/someone/.aside/u/1/codemode/cm.js');
  // A Windows root joined with backslashes is not a string literal: '\\u' is a parse error
  // in the code an agent pastes. Forward slashes read the same file and survive parsing.
  assert.equal(helperLoadPathFor('C:\\Users\\someone\\.aside\\u\\0'), 'C:/Users/someone/.aside/u/0/codemode/cm.js');
  assert.equal(helperLoadPathFor('/Users/someone/.aside/u/0/'), '/Users/someone/.aside/u/0/codemode/cm.js');
});
