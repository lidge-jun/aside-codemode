// desktop.* (macOS Codex Computer Use) — contract tests with a fake broker. No real app is driven.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDesktop, DESKTOP_METHODS } from '../src/host/desktop/desktop.js';
import { createActions } from '../src/host/actions.js';
import { loadConfig } from '../src/config.js';

function fakePackageDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'cu-pkg-'));
  mkdirSync(path.join(dir, 'dist'));
  writeFileSync(path.join(dir, 'dist', 'session-executor.js'), '');
  return dir;
}

function fakeLoader(log) {
  return async () => ({
    DirectSessionExecutor: class {
      constructor(opts) { log.push(['ctor', opts.idleTimeoutMs]); }
      async execute(method, args) {
        log.push([method, args]);
        if (args.fail) return { isError: true, content: [{ type: 'text', text: 'boom' }] };
        return { content: [{ type: 'text', text: `tree for ${args.app || 'all'}\nline 2` }, { type: 'image', mimeType: 'image/jpeg', data: 'QUJDRA==' }] };
      }
      async close() { log.push(['close']); }
    },
    getDirectStatus: () => ({ brokerVerified: true }),
  });
}

const on = (extra = {}) => ({ desktop: { enabled: true, packageDir: fakePackageDir(), idleMs: 5, ...extra } });

test('desktop is off by default and says how to turn it on', async () => {
  const d = createDesktop({ config: {}, loader: fakeLoader([]) });
  await assert.rejects(() => d.list_apps({}), (e) => e.code === 'EDISABLED' && /desktop/.test(e.message));
  assert.deepEqual((await d.status()).enabled, false);
});

test('config default keeps desktop disabled', () => {
  assert.equal(loadConfig([], { CODEMODE_IGNORE_REPO_CONFIG: '1', XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), 'xdg-')) }).desktop.enabled, false);
});

test('exposes the ten official methods plus run and status', () => {
  const d = createDesktop({ platform: 'darwin', config: on(), loader: fakeLoader([]) });
  for (const m of DESKTOP_METHODS) assert.equal(typeof d[m], 'function', m);
  assert.equal(typeof d.run, 'function');
  assert.equal(typeof d.status, 'function');
  assert.equal(DESKTOP_METHODS.length, 10);
});

test('images are metadata unless the caller opts in', async () => {
  const d = createDesktop({ platform: 'darwin', config: on(), loader: fakeLoader([]) });
  const a = await d.get_app_state({ app: 'X' });
  assert.equal(a.ok, true);
  assert.equal(a.image.omitted, true);
  assert.equal('data' in a.image, false);
  const b = await d.get_app_state({ app: 'X' }, { image: true });
  assert.equal(b.image.data, 'QUJDRA==');
});

test('one broker executor is reused across calls (element indexes stay valid)', async () => {
  const log = [];
  const d = createDesktop({ platform: 'darwin', config: on(), loader: fakeLoader(log) });
  await d.get_app_state({ app: 'X' });
  await d.click({ app: 'X', element_index: '3' });
  assert.equal(log.filter((r) => r[0] === 'ctor').length, 1);
});

test('run batches steps, trims text, and stops at the first failure or missing expect', async () => {
  const d = createDesktop({ platform: 'darwin', config: on(), loader: fakeLoader([]) });
  const good = await d.run([{ method: 'list_apps', args: {} }, { method: 'get_app_state', args: { app: 'X' }, expect: 'tree for X' }], { textChars: 4 });
  assert.equal(good.ok, true);
  assert.equal(good.results[1].text, 'tree');
  const miss = await d.run([{ method: 'get_app_state', args: { app: 'X' }, expect: 'nope' }, { method: 'click', args: { app: 'X' } }]);
  assert.equal(miss.ok, false);
  assert.equal(miss.failedAt, 0);
  assert.equal(miss.results.length, 1);
  const err = await d.run([{ method: 'click', args: { app: 'X', fail: true } }]);
  assert.equal(err.ok, false);
  const bad = await d.run([{ method: 'rm_rf', args: {} }]);
  assert.equal(bad.failedAt, 0);
});

test('non-object args are refused before reaching the broker', async () => {
  const log = [];
  const d = createDesktop({ platform: 'darwin', config: on(), loader: fakeLoader(log) });
  await assert.rejects(() => d.click('X'), (e) => e.code === 'EBADVAL');
  assert.equal(log.length, 0);
});

test('a wrong packageDir is a named error, not a crash', async () => {
  const d = createDesktop({ platform: 'darwin', config: { desktop: { enabled: true, packageDir: '/nonexistent' } }, loader: fakeLoader([]) });
  await assert.rejects(() => d.list_apps({}), (e) => e.code === 'ENOTFOUND');
});

test('the catalog lists every desktop entry and check() validates required inputs', () => {
  const actions = createActions();
  const paths = actions.list().map((r) => r.path).filter((p) => p.startsWith('desktop.'));
  for (const m of [...DESKTOP_METHODS, 'run', 'status']) assert.ok(paths.includes('desktop.' + m), m);
  assert.equal(actions.check('desktop.click', { app: 'X', element_index: '1' }).ok, true);
  assert.equal(actions.check('desktop.type_text', { app: 'X' }).ok, false);
});

test('concurrent first calls open one broker session', async () => {
  const log = [];
  const d = createDesktop({ platform: 'darwin', config: on(), loader: fakeLoader(log) });
  await Promise.all([d.list_apps({}), d.get_app_state({ app: 'X' }), d.click({ app: 'X', element_index: '1' })]);
  assert.equal(log.filter((r) => r[0] === 'ctor').length, 1);
});

test('a cancelled execution stops a run before the next step and leaves the shared session open', async () => {
  const log = [];
  const shared = createDesktop({ platform: 'darwin', config: on(), loader: fakeLoader(log) });
  const ctl = new AbortController();
  const d = shared._view(ctl.signal);
  const first = { method: 'get_app_state', args: { app: 'X' } };
  const orig = first.args;
  first.args = new Proxy(orig, { get(t, k) { if (k === 'app') ctl.abort(); return t[k]; } });
  const out = await d.run([first, { method: 'click', args: { app: 'X', element_index: '1' } }]);
  assert.equal(out.ok, false);
  assert.equal(out.failedAt, 1);
  assert.equal(log.some((r) => r[0] === 'click'), false);
  await assert.rejects(() => d.click({ app: 'X' }), (e) => e.code === 'EABORTED');
  assert.equal((await shared.click({ app: 'X', element_index: '1' })).ok, true);
  assert.equal(log.some((r) => r[0] === 'close'), false);
});

test('run treats null options as defaults', async () => {
  const d = createDesktop({ platform: 'darwin', config: on(), loader: fakeLoader([]) });
  const out = await d.run([{ method: 'list_apps', args: {} }], null);
  assert.equal(out.ok, true);
});

test('desktop refuses non-macOS hosts with a named error', async () => {
  const d = createDesktop({ platform: 'linux', config: on(), loader: fakeLoader([]) });
  await assert.rejects(() => d.list_apps({}), (e) => e.code === 'ENOTSUP');
});
