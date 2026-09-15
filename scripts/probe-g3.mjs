#!/usr/bin/env node
// wp2 probe. The four G3 fixtures the release roadmap asks for, run against a real browser
// through 'aside repl': a ref inside an iframe, a native action with a batch in the middle,
// an image handed to display(), and two calls racing on one page.
//
//   node scripts/probe-g3.mjs [--account-root <path>] [--label <name>] [--json]
//
// Every check reads the page after the action rather than trusting a return value, because
// the gate is "the fixture's actual screen or DOM", not "the call did not throw".
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { helperSource, helperLoadPathFor, HELPER_INSTALL_RELPATH } from '../src/host/browse/helper-bundle.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const accountRoot = arg('--account-root', path.join(os.homedir(), '.aside', 'u', '0'));
const label = arg('--label', os.hostname());
const asJson = process.argv.includes('--json');

const script = (body) => '<scr' + 'ipt>' + body + '</scr' + 'ipt>';
const CHILD = '<!doctype html><title>child</title><button id="b">press me</button><p id="out"></p>'
  + script('document.getElementById("b").addEventListener("click",function(){document.getElementById("out").textContent="child-clicked";});');
const CLICKABLE = '<!doctype html><title>native</title><button id="b">act</button><p id="out">untouched</p>'
  + script('document.getElementById("b").addEventListener("click",function(){document.getElementById("out").textContent="native-1";});');
const RACE = '<!doctype html><title>race</title><p id="out">idle</p>';

// The iframe fixture is served over loopback rather than a data: url. A data: page has an
// opaque origin, so its srcdoc child is cross-origin to it: the accessibility tree does not
// offer the child's controls and contentDocument reads back null. That was measured here,
// and it is why 260914_a11y-actions used 127.0.0.1 for the same fixture.
const PARENT_HTML = '<!doctype html><title>parent</title><button id="b">press me</button><p id="out"></p>'
  + '<iframe id="f" src="/child.html" width="320" height="140"></iframe>'
  + script('document.getElementById("b").addEventListener("click",function(){document.getElementById("out").textContent="parent-clicked";});');
const CHILD_HTML = CHILD;

function serveFixture() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const body = req.url && req.url.indexOf('child') > -1 ? CHILD_HTML : PARENT_HTML;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: 'http://127.0.0.1:' + port + '/parent.html' });
    });
  });
}

const fixture = await serveFixture();

const PROGRAM = `
const out = {};
const url = (html) => 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
const PARENT_URL = ${JSON.stringify(fixture.url)};
const CLICKABLE = ${JSON.stringify(CLICKABLE)};
const RACE = ${JSON.stringify(RACE)};
const page = (i) => url('<!doctype html><title>p' + i + '</title><p id="marker">page-' + i + '-body</p>');

// ---- 1. a ref that lives inside an iframe
try {
  const tab = await openTab(PARENT_URL);
  await sleep(600);
  const tree = String((await snapshot(tab)).tree || '');
  const lines = tree.split('\\n').filter((l) => l.indexOf('press me') > -1);
  const refs = lines.map((l) => { const m = l.match(/\\[ref=([A-Za-z0-9_-]+)\\]/); return m ? m[1] : null; }).filter(Boolean);
  const inFrame = refs.filter((r) => r.charAt(0) === 'f');
  const read = () => tab.evaluate(() => {
    const frame = document.querySelector('#f');
    const child = frame && frame.contentDocument ? frame.contentDocument.querySelector('#out') : null;
    return {
      parent: document.querySelector('#out').textContent,
      child: child ? child.textContent : null,
      childReachable: Boolean(frame && frame.contentDocument),
    };
  });
  const before = await read();
  let clicked = null;
  if (inFrame.length) { await tab.locator(inFrame[0]).click(); clicked = inFrame[0]; }
  await sleep(250);
  const after = await read();
  out.iframe = { refs: refs, inFrame: inFrame, clicked: clicked, before: before, after: after, lines: lines.slice(0, 4) };
  await tab.close();
} catch (e) { out.iframe = { error: String(e && e.message).slice(0, 300) }; }

// ---- 2. native action, batch, native observation again
try {
  const src = await fs.readFile(${JSON.stringify(helperLoadPathFor(accountRoot))}, 'utf8');
  (0, eval)(src);
  const a = await openTab(url(CLICKABLE));
  await sleep(400);
  await a.locator('#b').click();
  await sleep(200);
  const beforeBatch = await a.evaluate(() => document.querySelector('#out').textContent);
  const batch = await cm.run({
    items: [0, 1, 2].map((i) => ({ url: page(i) })),
    limit: 2, maxTabs: 2, deadlineMs: 45000,
    onItem: async (tab) => String(await tab.evaluate(() => document.querySelector('#marker').textContent)).trim(),
  });
  const afterBatch = await a.evaluate(() => document.querySelector('#out').textContent);
  const stillThere = String((await snapshot(a)).tree || '').indexOf('act') > -1;
  await a.close();
  out.mixed = {
    helperVersion: cm.version,
    beforeBatch: beforeBatch, afterBatch: afterBatch, stillThere: stillThere,
    status: batch.status, values: batch.items.map((i) => i.value), leaked: batch.tabs.leaked,
  };
} catch (e) { out.mixed = { error: String(e && e.message).slice(0, 300) }; }

// ---- 3. an image handed to display()
try {
  const tab = await openTab(url(CLICKABLE));
  await sleep(400);
  const shot = await tab.screenshot();
  const shape = shot && typeof shot === 'object'
    ? { type: 'object', keys: Object.keys(shot).slice(0, 8), bytes: shot.length || (shot.data ? shot.data.length : null) }
    : { type: typeof shot, bytes: shot ? String(shot).length : 0 };
  let displayed = null;
  try { const d = await display(shot); displayed = { ok: true, returned: d === undefined ? 'undefined' : typeof d }; }
  catch (e2) { displayed = { ok: false, error: String(e2 && e2.message).slice(0, 200) }; }
  await tab.close();
  out.image = { shot: shape, display: displayed, displayType: typeof display };
} catch (e) { out.image = { error: String(e && e.message).slice(0, 300) }; }

// ---- 4. two calls racing on one page
try {
  const r = await openTab(url(RACE));
  await sleep(300);
  const one = r.evaluate(() => new Promise((res) => {
    const s = Date.now(); const el = document.querySelector('#out'); el.textContent = 'one-start';
    setTimeout(() => { el.textContent = 'one-done'; res({ who: 'one', start: s, end: Date.now() }); }, 400);
  }));
  const two = r.evaluate(() => new Promise((res) => {
    const s = Date.now(); const el = document.querySelector('#out'); el.textContent = 'two-start';
    setTimeout(() => { el.textContent = 'two-done'; res({ who: 'two', start: s, end: Date.now() }); }, 400);
  }));
  const both = await Promise.all([one, two]);
  const a = both[0]; const b = both[1];
  const overlapped = !(a.end <= b.start || b.end <= a.start);
  const final = await r.evaluate(() => document.querySelector('#out').textContent);
  await r.close();
  out.race = { a: a, b: b, overlapped: overlapped, final: final };
} catch (e) { out.race = { error: String(e && e.message).slice(0, 300) }; }

console.log('PROBE_JSON ' + JSON.stringify(out));
`;

function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e.message) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass: Boolean(pass), detail: String(detail) }); };
const skip = (name, why) => { checks.push({ name, pass: null, detail: String(why) }); };

const target = path.join(accountRoot, HELPER_INSTALL_RELPATH);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, helperSource().src, 'utf8');

const probe = await run('aside', ['repl', PROGRAM]);
const line = probe.stdout.split('\n').find((l) => l.includes('PROBE_JSON '));
let data = null;
if (line) {
  try { data = JSON.parse(line.slice(line.indexOf('PROBE_JSON ') + 'PROBE_JSON '.length)); } catch { data = null; }
}

if (!data) {
  check('the probe program ran and answered', false, (probe.stderr || probe.stdout).slice(-600) || 'no output');
} else {
  const f = data.iframe || {};
  check('1a the snapshot offers a ref for the button inside the iframe',
    Array.isArray(f.inFrame) && f.inFrame.length > 0, JSON.stringify(f.refs || f.error || null));
  check('1b clicking that ref changes the child document',
    f.after && f.after.child === 'child-clicked', JSON.stringify(f.after || f.error || null));
  check('1c and leaves the identically labelled parent button alone',
    f.after && (f.after.parent === '' || f.after.parent === null), JSON.stringify(f.after || null));

  const m = data.mixed || {};
  check('2a the native click landed before the batch', m.beforeBatch === 'native-1', String(m.beforeBatch || m.error));
  check('2b the batch completed with every item', m.status === 'completed' && Array.isArray(m.values) && m.values.length === 3,
    m.status + ' ' + JSON.stringify(m.values || null));
  check('2c the batch did not disturb the tab the native work was using',
    m.afterBatch === 'native-1' && m.stillThere === true, JSON.stringify({ afterBatch: m.afterBatch, stillThere: m.stillThere }));
  check('2d the batch left no tab of its own open', m.leaked === 0, String(m.leaked));

  const img = data.image || {};
  check('3a a screenshot came back with bytes', img.shot && (img.shot.bytes > 0), JSON.stringify(img.shot || img.error || null));
  check('3b display() accepted the image', img.display && img.display.ok === true, JSON.stringify(img.display || null));
  skip('3c a downscaled image maps coordinates back',
    'not run: no API produces the stimulus - screenshot.maxWidth is accepted and ignored, host resize is ENOTSUP, page.setViewportSize is absent');
  skip('3d DPI 100/125/150/200%, zoom and clip', 'not run: same reason as 3c');

  const r = data.race || {};
  check('4a the two calls on one page actually overlapped', r.overlapped === true,
    JSON.stringify({ a: r.a, b: r.b }) || String(r.error));
  check('4b the page ended in one call\'s complete result, not a mixture',
    r.final === 'one-done' || r.final === 'two-done', String(r.final || r.error));
  skip('4c native mouse/keyboard equivalence on an explicitly chosen page',
    'not run: needs a separate native fixture; cua is not in the capability matrix at all');
}

const ran = checks.filter((c) => c.pass !== null);
const passed = ran.filter((c) => c.pass).length;
const report = { label, accountRoot, passed, ran: ran.length, skipped: checks.length - ran.length, checks };
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  for (const c of checks) console.log((c.pass === null ? '- SKIP' : c.pass ? '  ok  ' : '  FAIL') + ' ' + c.name + '  ' + c.detail.slice(0, 160));
  console.log(label + ': ' + passed + '/' + ran.length + ' ran, ' + (checks.length - ran.length) + ' not run');
}
fixture.server.close();
process.exit(ran.every((c) => c.pass) ? 0 : 1);
