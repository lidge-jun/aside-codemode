#!/usr/bin/env node
// wp8 probe. Installs the batch helper into an Aside account root, loads it in a real
// 'aside repl' session, and proves the four things a unit test cannot: that the file is
// readable from the session directory, that the tab budget holds against real tabs, that a
// refused open leaves the rest of the batch intact, and that a deadline stops work without
// retrying it.
//
//   node scripts/probe-native-helper.mjs [--account-root <path>] [--label <name>] [--json]
//
// Pages are data: urls. The Aside daemon refuses file:// without local file access and the
// browser cannot reach this machine's loopback, both measured rather than assumed, so a local
// http fixture server is not a transport the probe can rely on. A data: page is still a real
// page: it has a document, a title and a DOM the callback reads through the tab.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  helperSource, helperLoadPathFor, HELPER_INSTALL_RELPATH, HELPER_LOAD_RELPATH, HELPER_VERSION,
} from '../src/host/browse/helper-bundle.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const accountRoot = arg('--account-root', path.join(os.homedir(), '.aside', 'u', '0'));
const label = arg('--label', os.hostname());
const asJson = process.argv.includes('--json');

const PROGRAM = `
// The absolute path is what the installed skill now prints, and the only form both surfaces
// read. The session-relative form is checked alongside it because 'aside repl' - the surface
// this probe runs on - is the one place it works, and a regression there is worth catching.
const src = await fs.readFile(${JSON.stringify(helperLoadPathFor(accountRoot))}, 'utf8');
(0, eval)(src);
let cliRelativeRead = null;
try {
  const rel = await fs.readFile(${JSON.stringify(HELPER_LOAD_RELPATH)}, 'utf8');
  cliRelativeRead = rel === src ? 'same-bytes' : 'different-bytes';
} catch (e) { cliRelativeRead = 'failed: ' + String(e && e.message).slice(0, 80); }
const page = (i) => 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><title>batch page ' + i + '</title><main id="content" data-page="' + i + '">'
  + '<h1>batch page ' + i + '</h1><p id="marker">page-' + i + '-body</p></main>');
const read = async (tab, item, jobId) => {
  const marker = await tab.evaluate(() => document.querySelector('#marker').textContent);
  return { jobId: jobId, marker: marker };
};
const out = { version: cm.version, cliRelativeRead: cliRelativeRead };
out.budget = await cm.run({
  items: [0,1,2,3,4,5].map((i) => ({ url: page(i), i: i })),
  limit: 2, maxTabs: 2, deadlineMs: 45000, onItem: read,
});
out.refused = await cm.run({
  items: [0,1,2,3,4,5].map((i) => ({ url: i === 3 ? 'file:///etc/hosts' : page(i), i: i })),
  limit: 2, maxTabs: 2, deadlineMs: 45000, onItem: read,
});
let deadlineCalls = 0;
out.deadline = await cm.run({
  items: [0,1,2,3].map((i) => ({ url: page(i), i: i })),
  limit: 1, maxTabs: 2, deadlineMs: 1200,
  onItem: async (tab, item, jobId) => { deadlineCalls++; await sleep(900); return jobId; },
});
out.deadlineCalls = deadlineCalls;
const solo = await openTab(page(9));
await sleep(300);
const before = await snapshot(solo);
const mixed = await cm.run({
  items: [0,1].map((i) => ({ url: page(i), i: i })),
  limit: 2, maxTabs: 2, deadlineMs: 20000,
  onItem: async (tab, item, jobId) => ({ jobId: jobId, treeChars: String((await snapshot(tab)).tree || '').length }),
});
const after = await snapshot(solo);
await solo.close();
out.mixed = {
  status: mixed.status, items: mixed.items.length,
  treeChars: mixed.items.map((i) => i.value && i.value.treeChars),
  soloBefore: String(before.tree || '').length,
  soloAfter: String(after.tree || '').length,
};
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

const bundle = helperSource();
const target = path.join(accountRoot, HELPER_INSTALL_RELPATH);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, bundle.src, 'utf8');

const probe = await run('aside', ['repl', PROGRAM]);
const line = probe.stdout.split('\n').find((l) => l.includes('PROBE_JSON '));
let data = null;
if (line) {
  try { data = JSON.parse(line.slice(line.indexOf('PROBE_JSON ') + 'PROBE_JSON '.length)); } catch (e) { data = null; }
}

if (!data) {
  check('the probe program ran and answered', false, (probe.stderr || probe.stdout).slice(-600) || 'no output');
} else {
  const marker = (r, i) => r.items[i] && r.items[i].value && r.items[i].value.marker;

  check('1 the installed helper loads and reports its version',
    data.version === HELPER_VERSION, data.version + ' (expected ' + HELPER_VERSION + ')');

  // The documents now hand out the absolute path. The session-relative form still has to
  // work here, because this surface is the one place it does: a regression would mean the
  // CLI stopped resolving from the session directory, which is worth failing over.
  check('1b the CLI still resolves the session-relative form to the same bytes',
    data.cliRelativeRead === 'same-bytes', String(data.cliRelativeRead));

  const b = data.budget;
  check('2a six real tabs, two at a time', b.tabs.peak <= 2, 'peak=' + b.tabs.peak + ' requested=' + b.tabs.requested + ' closed=' + b.tabs.closed);
  check('2b every item came back', b.items.length === 6 && b.status === 'completed', b.status + ' ' + b.completed + '/' + b.requested);
  check('2c each value landed under its own jobId',
    b.items.every((it, i) => it.jobId === 'j' + String(i).padStart(3, '0')
      && it.value && it.value.jobId === it.jobId && it.value.marker === 'page-' + i + '-body'),
    b.items.map((it, i) => it.jobId + ':' + marker(b, i)).join(' '));
  check('2d no tab was left open', b.tabs.leaked === 0 && b.tabs.closed === b.tabs.requested,
    'leaked=' + b.tabs.leaked);

  const r = data.refused;
  check('3a one refused open makes the run partial', r.status === 'partial', r.status);
  check('3b the other five are preserved', r.completed === 5, r.completed + '/' + r.requested);
  check('3c the refusal is named, not guessed', r.items[3].status === 'failed' && r.items[3].code === 'EOPEN',
    r.items[3].status + ' ' + r.items[3].code + ' ' + String(r.items[3].error || '').slice(0, 80));
  check('3d the refused open refunded its tab reservation',
    r.items.every((it) => it.code !== 'ETABBUDGET') && r.tabs.requested === 5,
    'requested=' + r.tabs.requested);

  const d = data.deadline;
  const cut = d.items.filter((it) => it.code === 'EDEADLINE');
  check('4a work past the deadline is indeterminate', cut.length > 0 && cut.every((it) => it.status === 'indeterminate'),
    cut.length + ' of ' + d.items.length + ' cut');
  check('4b nothing was retried', data.deadlineCalls === d.completed, data.deadlineCalls + ' calls for ' + d.completed + ' completed');
  check('4c the run does not call itself complete', d.complete === false && d.status !== 'completed', d.status);

  const m = data.mixed;
  check('5a a batch runs alongside a tab this session already owned',
    m.status === 'completed' && m.items === 2, m.status + ' ' + m.items);
  check('5b snapshot works inside the callback', m.treeChars.every((n) => n > 0), JSON.stringify(m.treeChars));
  check('5c the pre-existing tab survived the batch', m.soloAfter > 0, m.soloBefore + ' -> ' + m.soloAfter);
}

const failed = checks.filter((c) => !c.pass);
const report = {
  label, platform: process.platform, accountRoot,
  helper: { version: bundle.version, sha256: bundle.sha256, bytes: bundle.bytes, installedAt: target },
  when: new Date().toISOString(),
  checks, passed: checks.length - failed.length, failed: failed.length,
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log('probe: ' + label + ' (' + process.platform + ')  helper ' + bundle.version + ' sha256 ' + bundle.sha256.slice(0, 12) + ' ' + bundle.bytes + 'B');
  console.log('installed: ' + target);
  for (const c of checks) console.log((c.pass ? '  PASS  ' : '  FAIL  ') + c.name + ' -- ' + c.detail);
  console.log((failed.length === 0 ? 'ALL PASS ' : 'FAILED ' + failed.length + '/') + checks.length);
}
process.exit(failed.length === 0 ? 0 : 1);
