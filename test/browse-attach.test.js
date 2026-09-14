import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACH_TEMPLATE, compileAttach, createAttach } from '../src/host/browse/attach.js';
import { validateAttach } from '../src/host/browse/attach-schema.js';
import { resolveAccountRoot } from '../src/host/browse/browse.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// The generated script is evaluated against fake globals rather than grepped, the same way
// browse-script.test.js treats the job template. A real browser is never needed.
async function runSource(source, fakes) {
  const printed = [];
  const fn = new AsyncFunction(
    'listBrowserTabs', 'attachBrowserTab', 'attachActiveBrowserTab', 'console', source,
  );
  await fn(
    fakes.listBrowserTabs,
    fakes.attachBrowserTab || (() => { throw new Error('attachBrowserTab not provided'); }),
    fakes.attachActiveBrowserTab || (() => { throw new Error('No active browser tab is available to attach.'); }),
    { log: (s) => printed.push(s) },
  );
  return JSON.parse(printed[printed.length - 1]);
}

const LIVE_TABS = [
  { active: false, id: 'tab:AAA', targetId: 'AAA', title: 'Korea University LMS', url: 'https://lms.korea.ac.kr/', windowId: 1, focusedWindow: false },
  { active: false, id: 'tab:BBB', targetId: 'BBB', title: 'opencodex - proxy dashboard', url: 'http://localhost:10100/#providers', windowId: 1, focusedWindow: false },
];

function fakePage(overrides = {}) {
  const values = {
    'location.href': 'http://localhost:10100/#providers',
    'location.hash': '#providers',
    'document.title': 'opencodex - proxy dashboard',
    'window.scrollY': 120,
    "document.body ? document.body.innerText : ''": 'opencodex\nv2.54.0\n대시보드\n프로바이더\n모델',
    ...overrides.values,
  };
  return {
    url: async () => overrides.pageUrl ?? 'http://localhost:10100/',
    evaluate: async (expr) => {
      if (expr in values) return values[expr];
      if (expr.startsWith('!!document.querySelector(')) {
        const sel = JSON.parse(expr.slice('!!document.querySelector('.length, -1));
        return (overrides.selectors || []).includes(sel);
      }
      throw new Error('unexpected evaluate: ' + expr);
    },
  };
}

test('the generated script never closes a tab', () => {
  assert.equal(ATTACH_TEMPLATE.includes('closeTab'), false, 'an attached tab belongs to the user');
  assert.equal(ATTACH_TEMPLATE.includes('openTab'), false, 'attach must not open anything');
});

test('list mode strips the tab: prefix that breaks attachBrowserTab', async () => {
  const out = await runSource(compileAttach({ mode: 'list' }), {
    listBrowserTabs: async () => LIVE_TABS,
  });
  assert.equal(out.ok, true);
  const row = out.rows.find((r) => r.kind === 'tabs');
  assert.deepEqual(row.tabs.map((t) => t.targetId), ['AAA', 'BBB']);
  assert.deepEqual(row.tabs.map((t) => t.id), ['tab:AAA', 'tab:BBB']);
});

test('attach by urlIncludes calls attachBrowserTab with the BARE targetId', async () => {
  const seen = [];
  const out = await runSource(
    compileAttach(validateAttach({ urlIncludes: 'localhost:10100' })),
    {
      listBrowserTabs: async () => LIVE_TABS,
      attachBrowserTab: async (id) => { seen.push(id); return fakePage(); },
    },
  );
  assert.deepEqual(seen, ['BBB'], 'passing tab:BBB is the measured failure mode');
  const page = out.rows.find((r) => r.kind === 'page');
  assert.equal(page.selectedBy, 'urlIncludes');
  assert.equal(page.attachedVia, 'attachBrowserTab(targetId)');
});

test('an explicit targetId tolerates the prefix the listing hands back', async () => {
  const seen = [];
  await runSource(compileAttach(validateAttach({ targetId: 'tab:BBB' })), {
    listBrowserTabs: async () => LIVE_TABS,
    attachBrowserTab: async (id) => { seen.push(id); return fakePage(); },
  });
  assert.deepEqual(seen, ['BBB']);
});

test('the fragment survives, because location.href is read instead of page.url()', async () => {
  const out = await runSource(compileAttach(validateAttach({ urlIncludes: 'localhost' })), {
    listBrowserTabs: async () => LIVE_TABS,
    attachBrowserTab: async () => fakePage(),
  });
  const page = out.rows.find((r) => r.kind === 'page');
  assert.equal(page.href, 'http://localhost:10100/#providers');
  assert.equal(page.hash, '#providers');
  assert.equal(page.pageUrl, 'http://localhost:10100/', 'page.url() really does drop it');
  assert.equal(page.scrollY, 120, "the user's scroll position is readable");
});

test('contentVerified is null when nobody asked, and false when the check fails', async () => {
  const unasked = await runSource(compileAttach(validateAttach({ urlIncludes: 'localhost' })), {
    listBrowserTabs: async () => LIVE_TABS,
    attachBrowserTab: async () => fakePage(),
  });
  assert.equal(unasked.rows.find((r) => r.kind === 'page').contentVerified, null);

  const failed = await runSource(compileAttach(validateAttach({ urlIncludes: 'localhost', minTextChars: 5000 })), {
    listBrowserTabs: async () => LIVE_TABS,
    attachBrowserTab: async () => fakePage(),
  });
  const page = failed.rows.find((r) => r.kind === 'page');
  assert.equal(page.contentVerified, false);
  assert.match(page.render.reasons[0], /visible characters/);
  assert.equal(failed.ok, false);
});

test('a required selector that is missing is named, not summarised', async () => {
  const out = await runSource(
    compileAttach(validateAttach({ urlIncludes: 'localhost', requireSelector: ['[data-provider]', '.missing'] })),
    {
      listBrowserTabs: async () => LIVE_TABS,
      attachBrowserTab: async () => fakePage({ selectors: ['[data-provider]'] }),
    },
  );
  const page = out.rows.find((r) => r.kind === 'page');
  assert.deepEqual(page.render.requiredSelectorsMatched, ['[data-provider]']);
  assert.deepEqual(page.render.requiredSelectorsMissing, ['.missing']);
  assert.equal(page.contentVerified, false);
});

test('no match reports ENOTAB and hands back the tab list to choose from', async () => {
  const out = await runSource(compileAttach(validateAttach({ urlIncludes: 'nowhere.example' })), {
    listBrowserTabs: async () => LIVE_TABS,
  });
  const err = out.rows.find((r) => r.kind === 'error');
  assert.equal(err.code, 'ENOTAB');
  assert.equal(err.tabs.length, 2);
});

test('no active tab reports ENOACTIVE, the normal state over ssh', async () => {
  const out = await runSource(compileAttach(validateAttach({})), {
    listBrowserTabs: async () => LIVE_TABS,
  });
  const err = out.rows.find((r) => r.kind === 'error');
  assert.equal(err.code, 'ENOACTIVE');
  assert.match(err.message, /No active browser tab/);
});

test('validateAttach refuses ambiguity and unknown keys', () => {
  assert.throws(() => validateAttach({ targetId: 'a', urlIncludes: 'b' }), /pick one of/);
  assert.throws(() => validateAttach({ nope: 1 }), /unknown browse.attach option/);
  assert.throws(() => validateAttach({ minTextChars: 0 }), /minTextChars/);
  assert.throws(() => validateAttach({ requireSelector: [''] }), /non-empty/);
  const ok = validateAttach({ urlIncludes: 'x', requireSelector: 'main' });
  assert.deepEqual(ok.requireSelector, ['main']);
  assert.equal(ok.maxTextChars, 20000);
});

test('browse.attach is gated on the same opt-in as the rest of browsing', async () => {
  const a = createAttach({ config: { browseCaps: { enabled: false } }, session: { raw: async () => ({ rows: [] }) } });
  await assert.rejects(() => a.attach({}), (e) => e.code === 'EDISABLED');
  await assert.rejects(() => a.tabs(), (e) => e.code === 'EDISABLED');
});

test('the host layer reports fragmentDropped and never claims a close', async () => {
  const session = {
    raw: async () => ({
      rows: [{
        kind: 'page',
        tab: { targetId: 'BBB', url: 'http://localhost:10100/#providers' },
        selectedBy: 'urlIncludes',
        attachedVia: 'attachBrowserTab(targetId)',
        pageUrl: 'http://localhost:10100/',
        href: 'http://localhost:10100/#providers',
        hash: '#providers',
        title: 'dash',
        scrollY: 120,
        render: { textChars: 40, reasons: [], requiredSelectorsMatched: [], requiredSelectorsMissing: [], sample: 'x' },
        contentVerified: null,
      }],
    }),
  };
  const a = createAttach({ config: { browseCaps: { enabled: true } }, session });
  const r = await a.attach({ urlIncludes: 'localhost' });
  assert.equal(r.ok, true);
  assert.equal(r.fragmentDropped, true);
  assert.equal(r.hash, '#providers');
  assert.match(r.note, /not closed/);
});

test('a repl failure surfaces as EREPL, not as an empty success', async () => {
  const session = { raw: async () => ({ error: 'ReferenceError: listBrowserTabs is not defined', rows: [] }) };
  const a = createAttach({ config: { browseCaps: { enabled: true } }, session });
  await assert.rejects(() => a.attach({ urlIncludes: 'x' }), (e) => e.code === 'EREPL');
});

test('the shared cache keys off the CURRENT account root, not a hardcoded u/0', () => {
  const asideHome = mkdtempSync(path.join(tmpdir(), 'codemode-browse-acct-'));
  mkdirSync(path.join(asideHome, 'u', '0'), { recursive: true });
  mkdirSync(path.join(asideHome, 'u', '1'), { recursive: true });
  writeFileSync(path.join(asideHome, 'accounts.json'), JSON.stringify({
    currentAccountId: 1,
    accounts: [{ id: 1, name: 'bitkyc07' }, { id: 0, name: 'Local Account' }],
  }));
  assert.equal(resolveAccountRoot(asideHome), path.join(asideHome, 'u', '1'));
});

test('a broken accounts.json falls back to u/0 instead of taking browsing down', () => {
  const asideHome = mkdtempSync(path.join(tmpdir(), 'codemode-browse-acct-'));
  writeFileSync(path.join(asideHome, 'accounts.json'), '{ not json');
  assert.equal(resolveAccountRoot(asideHome), path.join(asideHome, 'u', '0'));
});

