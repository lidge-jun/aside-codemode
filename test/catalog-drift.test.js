// Issue #33 — actions.check refused options the runtime implements.
//
// The catalog is the only thing a guest reads before it calls, so the two directions of
// drift are both bugs: a signature that advertises an option the entry will report as
// unknown, and an entry that accepts an option its signature never mentions. The second
// is what made browse.exec read like a read-only fetcher while it could drive writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../src/host/actions.js';

const actions = createActions();
const entries = actions.list().map((row) => actions.describe(row.path));

// The return type is cut away first. Promise<{ok,items}> carries braces and identifiers of
// its own, and reading those as arguments reported `ok` as an undeclared option.
function argumentPart(signature) {
  const sig = String(signature || '');
  const arrow = sig.indexOf('=>');
  return arrow === -1 ? sig : sig.slice(0, arrow);
}

test('every option a signature marks optional is an accepted input', () => {
  const drift = [];
  for (const rec of entries) {
    for (const m of argumentPart(rec.signature).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\?/g)) {
      if (!(m[1] in (rec.inputs || {}))) drift.push(rec.path + ' advertises ' + m[1]);
    }
  }
  assert.deepEqual(drift, []);
});

test('every accepted input is named in the signature the reader sees first', () => {
  const hidden = [];
  for (const rec of entries) {
    const args = argumentPart(rec.signature);
    for (const name of Object.keys(rec.inputs || {})) {
      if (!new RegExp('\\b' + name + '\\b').test(args)) hidden.push(rec.path + ' hides ' + name);
    }
  }
  assert.deepEqual(hidden, []);
});

test('browse.exec and browse.attach admit in their signature that they can write', () => {
  for (const path of ['browse.exec', 'browse.attach']) {
    const rec = actions.describe(path);
    assert.ok(rec.signature.includes('actions?'), path + ' signature must name actions?');
    assert.ok(rec.signature.includes('approveWrites?'), path + ' signature must name approveWrites?');
    assert.equal(rec.inputs.actions.required, false);
    assert.equal(rec.inputs.approveWrites.required, false);
  }
});

test('check accepts the batch-capture options the runtime honours', () => {
  const r = actions.check('browse.captureMany', {
    urls: ['data:text/html,ok'],
    outDir: 'out',
    snapshot: true,
    timeoutMs: 8000,
    waitUntil: 'load',
    concurrency: 1,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('check accepts report.build title and timeoutMs, which report.js reads', () => {
  const r = actions.check('report.build', { items: [], outFile: 'out.pdf', title: 'x', timeoutMs: 9000 });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('check accepts the prefetch options the warmer forwards to the read', () => {
  const r = actions.check('browse.prefetch', { urls: ['https://example.com'], timeoutMs: 5000, locale: 'ko-KR' });
  assert.equal(r.ok, true, JSON.stringify(r));
});
