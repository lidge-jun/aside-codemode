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
// The probe installs the current helper into the account root so it exercises the real load
// path. That is also a write to a live account, and it is how two accounts ended up ahead of
// their own manifest. --no-install runs against whatever is already there, which is what a
// recovery check needs.
const noInstall = process.argv.includes('--no-install');
// Where the raw answer goes. The release records have to cite what the machine said, not a
// number retyped from a terminal.
const outPath = arg('--out', null);

const script = (body) => '<scr' + 'ipt>' + body + '</scr' + 'ipt>';
const CHILD = '<!doctype html><title>child</title><button id="b">press me</button><p id="out"></p>'
  + script('document.getElementById("b").addEventListener("click",function(){document.getElementById("out").textContent="child-clicked";});');
const CLICKABLE = '<!doctype html><title>native</title><button id="b">act</button><p id="out">untouched</p>'
  + script('document.getElementById("b").addEventListener("click",function(){document.getElementById("out").textContent="native-1";});');
// Two fields, written in sequence by each caller, so an interleaving is observable. One
// field overwritten by both can only ever hold one writer's last word, which would make the
// "not a mixture" check true by construction.
const RACE = '<!doctype html><title>race</title><p id="first">idle</p><p id="second">idle</p>';

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
  // Positive control. 'the parent did not change' is worth nothing on its own: the parent
  // starts empty. Click the parent's own ref afterwards and require it to change, which is
  // what makes the earlier silence evidence that the two refs address two documents.
  const parentRefs = refs.filter((r) => r.charAt(0) !== 'f');
  let parentClicked = null;
  if (parentRefs.length) { await tab.locator(parentRefs[0]).click(); parentClicked = parentRefs[0]; }
  await sleep(250);
  const afterParent = await read();
  out.iframe = {
    refs: refs, inFrame: inFrame, clicked: clicked, parentClicked: parentClicked,
    before: before, after: after, afterParent: afterParent, lines: lines.slice(0, 4),
  };
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
  // A tab that survived is not the same as a tab that still works. Drive it again.
  let reusable = null;
  try {
    await a.evaluate(() => { document.querySelector('#b').setAttribute('data-second', '1'); });
    await a.locator('#b').click();
    await sleep(200);
    reusable = await a.evaluate(() => document.querySelector('#out').textContent);
  } catch (e2) { reusable = 'failed: ' + String(e2 && e2.message).slice(0, 120); }
  await a.close();
  out.mixed = {
    helperVersion: cm.version,
    beforeBatch: beforeBatch, afterBatch: afterBatch, stillThere: stillThere,
    reusable: reusable,
    status: batch.status, values: batch.items.map((i) => i.value), leaked: batch.tabs.leaked,
    items: batch.items.map((i) => ({ jobId: i.jobId, value: i.value })),
  };
} catch (e) { out.mixed = { error: String(e && e.message).slice(0, 300) }; }

// ---- 3. an image handed to display()
try {
  const tab = await openTab(url(CLICKABLE));
  await sleep(400);
  // Windows measured a CDP timeout capturing the viewport when the tab was not frontmost.
  // Bring it forward and give it a second attempt before calling the surface unable.
  let bringToFront = 'not-tried';
  try { await tab.bringToFront(); bringToFront = 'ok'; }
  catch (e0) { bringToFront = 'failed: ' + String(e0 && e0.message).slice(0, 120); }
  await sleep(400);
  let shot = null;
  let firstError = null;
  try { shot = await tab.screenshot(); }
  catch (e1) {
    firstError = String(e1 && e1.message).slice(0, 200);
    await sleep(1500);
    try { shot = await tab.screenshot(); } catch (e2) { firstError += ' | retry: ' + String(e2 && e2.message).slice(0, 200); }
  }
  const shape = shot && typeof shot === 'object'
    ? { type: 'object', keys: Object.keys(shot).slice(0, 8), bytes: shot.length || (shot.data ? shot.data.length : null) }
    : { type: typeof shot, bytes: shot ? String(shot).length : 0 };
  let displayed = null;
  if (shot) {
    try { const d = await display(shot); displayed = { ok: true, returned: d === undefined ? 'undefined' : typeof d }; }
    catch (e3) { displayed = { ok: false, error: String(e3 && e3.message).slice(0, 200) }; }
  } else displayed = { ok: false, error: 'no image to hand over: ' + firstError };
  // What display() returns is undefined, so acceptance is all it can tell us. Read the
  // bytes ourselves instead: a PNG signature and the IHDR dimensions say a real image of a
  // real viewport is what was handed over.
  let png = null;
  if (shot) {
    const b = (i) => Number(shot[i]);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b(i) === v);
    const be = (o) => (b(o) << 24) | (b(o + 1) << 16) | (b(o + 2) << 8) | b(o + 3);
    const ihdr = String.fromCharCode(b(12), b(13), b(14), b(15));
    png = { signature: sig, chunk: ihdr, width: sig ? be(16) : null, height: sig ? be(20) : null };
  }
  await tab.close();
  out.image = { shot: shape, png: png, display: displayed, displayType: typeof display, bringToFront: bringToFront, firstError: firstError };
} catch (e) { out.image = { error: String(e && e.message).slice(0, 300) }; }

// ---- 4. two calls racing on one page
try {
  const r = await openTab(url(RACE));
  await sleep(300);
  const one = r.evaluate(() => new Promise((res) => {
    const s = Date.now(); document.querySelector('#first').textContent = 'one';
    setTimeout(() => { document.querySelector('#second').textContent = 'one'; res({ who: 'one', start: s, end: Date.now() }); }, 400);
  }));
  const two = r.evaluate(() => new Promise((res) => {
    const s = Date.now(); document.querySelector('#first').textContent = 'two';
    setTimeout(() => { document.querySelector('#second').textContent = 'two'; res({ who: 'two', start: s, end: Date.now() }); }, 400);
  }));
  const both = await Promise.all([one, two]);
  const a = both[0]; const b = both[1];
  const overlapped = !(a.end <= b.start || b.end <= a.start);
  const final = await r.evaluate(() => ({
    first: document.querySelector('#first').textContent,
    second: document.querySelector('#second').textContent,
  }));
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
if (!noInstall) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, helperSource().src, 'utf8');
}

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
  check('1d the parent ref does change the parent, so 1c is evidence and not an empty page',
    f.afterParent && f.afterParent.parent === 'parent-clicked' && f.afterParent.child === 'child-clicked',
    JSON.stringify(f.afterParent || null));

  const m = data.mixed || {};
  check('2a the native click landed before the batch', m.beforeBatch === 'native-1', String(m.beforeBatch || m.error));
  check('2b each batch item came back under its own jobId, with its own page body',
    m.status === 'completed' && Array.isArray(m.items) && m.items.length === 3
      && m.items.every((it, i) => it.jobId === 'j' + String(i).padStart(3, '0') && it.value === 'page-' + i + '-body'),
    m.status + ' ' + JSON.stringify(m.items || null));
  check('2c the batch left the native tab on its own page and result',
    m.afterBatch === 'native-1' && m.stillThere === true, JSON.stringify({ afterBatch: m.afterBatch, stillThere: m.stillThere }));
  check('2d the tab is still drivable after the batch, not merely open',
    m.reusable === 'native-1', String(m.reusable));
  check('2e the batch left no tab of its own open', m.leaked === 0, String(m.leaked));

  const img = data.image || {};
  check('3a a screenshot came back with bytes', img.shot && (img.shot.bytes > 0),
    JSON.stringify({ shot: img.shot || img.error || null, bringToFront: img.bringToFront, firstAttempt: img.firstError }));
  check('3b those bytes are a real PNG of a real viewport',
    img.png && img.png.signature === true && img.png.chunk === 'IHDR' && img.png.width > 0 && img.png.height > 0,
    JSON.stringify(img.png || null));
  check('3c display() accepted that image without throwing (acceptance is all it returns)',
    img.display && img.display.ok === true, JSON.stringify(img.display || null));
  skip('3d a downscaled image maps coordinates back',
    'not run: no API produces the stimulus - screenshot.maxWidth is accepted and ignored, host resize is ENOTSUP, page.setViewportSize is absent');
  skip('3e DPI 100/125/150/200%, zoom and clip', 'not run: same reason as 3d');
  skip('3f that a model actually received the image', 'not run: display() returns undefined; the model side is not observable from the REPL');

  const r = data.race || {};
  check('4a the two calls on one page actually overlapped', r.overlapped === true,
    JSON.stringify({ a: r.a, b: r.b }) || String(r.error));
  check('4b both fields carry the same writer, so the two calls did not interleave',
    r.final && r.final.first === r.final.second && (r.final.first === 'one' || r.final.first === 'two'),
    JSON.stringify(r.final || r.error || null));
  skip('4c native mouse/keyboard equivalence on an explicitly chosen page',
    'not run: needs a separate native fixture; cua is not in the capability matrix at all');
}

const ran = checks.filter((c) => c.pass !== null);
const passed = ran.filter((c) => c.pass).length;
const report = {
  label, accountRoot, at: new Date().toISOString(), platform: process.platform,
  passed, ran: ran.length, skipped: checks.length - ran.length, checks, raw: data,
};
if (outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  for (const c of checks) console.log((c.pass === null ? '- SKIP' : c.pass ? '  ok  ' : '  FAIL') + ' ' + c.name + '  ' + c.detail.slice(0, 160));
  console.log(label + ': ' + passed + '/' + ran.length + ' ran, ' + (checks.length - ran.length) + ' not run');
}
fixture.server.close();
process.exit(ran.every((c) => c.pass) ? 0 : 1);
