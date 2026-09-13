// Slice 030 — cooperating writes, bounded reads, patch semantics.
//
// Every test here reproduces a defect observed against d1fa638 (devlog/_plan/
// 260913_review-hardening/001_reproduction.md). Correctness is asserted on
// observable state, never on elapsed time: there are no sleep-based barriers.
// Cross-process contention is synchronised through fork() IPC, so "all writers
// ran concurrently" is a message ordering fact, not a timing guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeRootGuard } from '../src/paths.js';
import { createFs } from '../src/host/fs.js';
import { createApplyPatch } from '../src/host/patch.js';
import { lockPathFor } from '../src/host/file-lock.js';
import { readBounded, readLines } from '../src/host/file-read.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');

function host(opts = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'codemode-write-')));
  const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }), ...opts });
  const apply_patch = createApplyPatch({ write_file: fs.write_file, edit_file: fs.edit_file });
  return { root, fs, apply_patch };
}

// Spawns n children that each open the SAME file, then releases them together.
// The barrier is `ready` -> `go` over IPC; nothing here sleeps.
function raceChildren(root, script, tokens) {
  const childPath = path.join(root, 'child.mjs');
  writeFileSync(childPath, script);
  return new Promise((resolve, reject) => {
    const kids = tokens.map((token) => fork(childPath, [srcDir, root, token], { stdio: 'ignore' }));
    const replies = [];
    let ready = 0;
    let done = 0;
    const finish = () => kids.forEach((k) => k.kill());
    for (const kid of kids) {
      kid.on('message', (m) => {
        if (m === 'ready') {
          ready += 1;
          if (ready === kids.length) kids.forEach((k) => k.send('go'));
          return;
        }
        replies.push(m);
        done += 1;
        if (done === kids.length) {
          finish();
          resolve(replies);
        }
      });
      kid.on('error', (e) => {
        finish();
        reject(e);
      });
      kid.on('exit', (code) => {
        if (done < kids.length && code !== 0 && code !== null) {
          finish();
          reject(new Error(`child exited ${code} before reporting`));
        }
      });
    }
  });
}

const childEdit = `
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [, , srcDir, root, token] = process.argv;
const load = (rel) => import(pathToFileURL(path.join(srcDir, rel)).href);
const { makeRootGuard } = await load('paths.js');
const { createFs } = await load('host/fs.js');
const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }), lockTimeoutMs: 30000 });
process.on('message', async (m) => {
  if (m !== 'go') return;
  try {
    await fs.edit_file({ path: 'shared.txt', edits: [{ oldText: token, newText: 'DONE' + token }] });
    process.send('ok:' + token);
  } catch (e) {
    process.send('err:' + token + ':' + e.message);
  }
});
process.send('ready');
`;

const childAppend = `
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [, , srcDir, root, token] = process.argv;
const load = (rel) => import(pathToFileURL(path.join(srcDir, rel)).href);
const { makeRootGuard } = await load('paths.js');
const { createFs } = await load('host/fs.js');
const fs = createFs({ assertInside: makeRootGuard([root], { cwd: root }), lockTimeoutMs: 30000 });
process.on('message', async (m) => {
  if (m !== 'go') return;
  try {
    await fs.edit_file({ path: 'shared.txt', appendText: token + '\\n' });
    process.send('ok:' + token);
  } catch (e) {
    process.send('err:' + token + ':' + e.message);
  }
});
process.send('ready');
`;

// ---------------------------------------------------------------- lost updates

test('same-process Promise.all of distinct replacements keeps every one', async () => {
  // Base behaviour: 8 unlocked read-modify-writes collapsed to 1 surviving
  // replacement in 20/20 trials.
  const { root, fs } = host();
  const slots = Array.from({ length: 8 }, (_, i) => `SLOT${i}`);
  writeFileSync(path.join(root, 'c.txt'), slots.join('\n'));
  await Promise.all(
    slots.map((s) => fs.edit_file({ path: 'c.txt', edits: [{ oldText: s, newText: `DONE${s}` }] })),
  );
  const text = readFileSync(path.join(root, 'c.txt'), 'utf8');
  for (const s of slots) assert.match(text, new RegExp(`DONE${s}\\b`), `${s} was lost`);
});

test('cross-process concurrent edits on one file all survive', async () => {
  const { root } = host();
  const tokens = Array.from({ length: 6 }, (_, i) => `TOK${i}`);
  writeFileSync(path.join(root, 'shared.txt'), tokens.join('\n'));
  const replies = await raceChildren(root, childEdit, tokens);
  assert.deepEqual(replies.filter((r) => r.startsWith('err:')), [], 'no child may fail');
  const text = readFileSync(path.join(root, 'shared.txt'), 'utf8');
  for (const t of tokens) assert.match(text, new RegExp(`DONE${t}\\b`), `${t} was lost`);
});

test('cross-process concurrent appends all survive', async () => {
  const { root } = host();
  const tokens = Array.from({ length: 6 }, (_, i) => `APP${i}`);
  writeFileSync(path.join(root, 'shared.txt'), 'head\n');
  const replies = await raceChildren(root, childAppend, tokens);
  assert.deepEqual(replies.filter((r) => r.startsWith('err:')), [], 'no child may fail');
  const lines = readFileSync(path.join(root, 'shared.txt'), 'utf8').split('\n');
  for (const t of tokens) assert.ok(lines.includes(t), `${t} was lost`);
});

test('a same-process writer sees the previous update, not a stale snapshot', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 's.txt'), 'one');
  await fs.edit_file({ path: 's.txt', edits: [{ oldText: 'one', newText: 'two' }] });
  await fs.edit_file({ path: 's.txt', edits: [{ oldText: 'two', newText: 'three' }] });
  assert.equal(readFileSync(path.join(root, 's.txt'), 'utf8'), 'three');
});

// ----------------------------------------------------------------- lock policy

test('a failed edit releases its lock so the next edit succeeds', async () => {
  const { root, fs } = host({ lockTimeoutMs: 2000 });
  writeFileSync(path.join(root, 'e.txt'), 'alpha');
  await assert.rejects(
    fs.edit_file({ path: 'e.txt', edits: [{ oldText: 'nope', newText: 'x' }] }),
    /not found/,
  );
  await fs.edit_file({ path: 'e.txt', edits: [{ oldText: 'alpha', newText: 'beta' }] });
  assert.equal(readFileSync(path.join(root, 'e.txt'), 'utf8'), 'beta');
  assert.equal(existsSync(lockPathFor(path.join(root, 'e.txt'))), false, 'lock must be gone');
});

test('a preheld foreign lock is a bounded ELOCKED with recovery info and no clobber', async () => {
  const { root, fs } = host({ lockTimeoutMs: 150 });
  const target = path.join(root, 'held.txt');
  writeFileSync(target, 'original');
  const lockPath = lockPathFor(target);
  // A lock owned by a pid this process does not control. It must never be stolen.
  const fh = await open(lockPath, 'wx');
  await fh.writeFile(JSON.stringify({ pid: 999999, token: 'foreign', target, acquiredAt: Date.now() }));
  await fh.close();
  try {
    const err = await fs
      .edit_file({ path: 'held.txt', edits: [{ oldText: 'original', newText: 'clobbered' }] })
      .then(() => null, (e) => e);
    assert.ok(err, 'a held lock must not be ignored');
    assert.equal(err.code, 'ELOCKED');
    assert.match(err.message, /999999/, 'the holder pid must be named');
    assert.ok(err.message.includes(lockPath), 'the lock file path must be named');
    assert.match(err.message, /delete|remove/i, 'recovery instructions must be explicit');
    assert.equal(readFileSync(target, 'utf8'), 'original', 'no clobber while locked');
    assert.equal(existsSync(lockPath), true, 'a foreign lock is never auto-deleted');
  } finally {
    const { unlinkSync } = await import('node:fs');
    unlinkSync(lockPath);
  }
});

test('an aborted signal rejects the write and leaves no owned lock behind', async () => {
  const controller = new AbortController();
  const { root, fs } = host({ signal: controller.signal, lockTimeoutMs: 5000 });
  const target = path.join(root, 'a.txt');
  writeFileSync(target, 'keep');
  controller.abort();
  await assert.rejects(
    fs.edit_file({ path: 'a.txt', edits: [{ oldText: 'keep', newText: 'gone' }] }),
    (e) => e.code === 'ABORT_ERR' || /abort/i.test(e.message),
  );
  assert.equal(readFileSync(target, 'utf8'), 'keep');
  assert.equal(existsSync(lockPathFor(target)), false);
});

test('a signal aborted while waiting rejects and releases the owned lock', async () => {
  const controller = new AbortController();
  const { root, fs } = host({ signal: controller.signal, lockTimeoutMs: 30000 });
  const target = path.join(root, 'w.txt');
  writeFileSync(target, 'keep');
  const lockPath = lockPathFor(target);
  const fh = await open(lockPath, 'wx');
  await fh.writeFile(JSON.stringify({ pid: 999998, token: 'foreign', target, acquiredAt: Date.now() }));
  await fh.close();
  try {
    const pending = fs.edit_file({ path: 'w.txt', edits: [{ oldText: 'keep', newText: 'gone' }] });
    controller.abort();
    await assert.rejects(pending, (e) => e.code === 'ABORT_ERR' || /abort/i.test(e.message));
    assert.equal(readFileSync(target, 'utf8'), 'keep');
  } finally {
    const { unlinkSync } = await import('node:fs');
    unlinkSync(lockPath);
  }
});

test('lock files live outside the searchable tree and leave no residue', async () => {
  const { root, fs } = host();
  const target = path.join(root, 'r.txt');
  writeFileSync(target, 'one');
  assert.ok(!lockPathFor(target).startsWith(root + path.sep), 'lock must not sit inside the root');
  await fs.edit_file({ path: 'r.txt', edits: [{ oldText: 'one', newText: 'two' }] });
  await fs.write('r2.txt', 'x');
  await fs.write_file({ file_path: 'r3.txt', content: 'y' });
  assert.deepEqual(readdirSync(root).sort(), ['r.txt', 'r2.txt', 'r3.txt']);
});

test('write_file stays create-only and never overwrites under the lock', async () => {
  const { fs } = host();
  await fs.write_file({ file_path: 'n.txt', content: 'one' });
  await assert.rejects(fs.write_file({ file_path: 'n.txt', content: 'two' }), /already exists/);
  assert.equal(await fs.read_file({ path: 'n.txt' }), 'one');
});

test('edit_file preserves the file mode across the atomic replacement', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX mode bits are not meaningful here');
    return;
  }
  const { root, fs } = host();
  const target = path.join(root, 'm.txt');
  writeFileSync(target, 'alpha');
  chmodSync(target, 0o640);
  await fs.edit_file({ path: 'm.txt', edits: [{ oldText: 'alpha', newText: 'beta' }] });
  assert.equal(statSync(target).mode & 0o777, 0o640);
});

test('edit_file rejects an ambiguous empty oldText', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'e.txt'), 'abc');
  await assert.rejects(
    fs.edit_file({ path: 'e.txt', edits: [{ oldText: '', newText: 'X' }] }),
    /empty/i,
  );
  assert.equal(readFileSync(path.join(root, 'e.txt'), 'utf8'), 'abc');
});

// ---------------------------------------------------------------- bounded reads

test('readBounded reads only the capped bytes from a large file', async () => {
  const { root } = host();
  const big = path.join(root, 'big.txt');
  writeFileSync(big, 'z'.repeat(8 * 1024 * 1024));
  const out = await readBounded(big, { maxBytes: 1024 });
  assert.equal(out.bytesRead, 1024, 'the cap must bound the descriptor read, not a post-hoc slice');
  assert.equal(out.totalBytes, 8 * 1024 * 1024);
  assert.equal(out.truncated, true);
  assert.equal(out.text.length, 1024);
});

test('readLines stops at the requested window instead of consuming the file', async () => {
  const { root } = host();
  const big = path.join(root, 'lines.txt');
  writeFileSync(big, Array.from({ length: 200000 }, (_, i) => `line${i}`).join('\n'));
  const total = statSync(big).size;
  const out = await readLines(big, { offset: 2, limit: 2 });
  assert.equal(out.text, 'line1\nline2');
  assert.ok(out.bytesRead < total / 4, `paged read consumed ${out.bytesRead} of ${total} bytes`);
});

test('a multibyte character split across stream chunks is not corrupted', async () => {
  // A 64KB chunk read can land mid-character. Decoding each chunk on its own
  // turned the split character into U+FFFD, silently corrupting the text.
  const { root, fs } = host();
  const target = path.join(root, 'k.txt');
  writeFileSync(target, `${'a'.repeat(65535)}\uD55C\uAE00\nsecond`);
  const first = await fs.read_file({ path: 'k.txt', offset: 1, limit: 1 });
  assert.ok(first.endsWith('\uD55C\uAE00'), `line 1 tail was ${JSON.stringify(first.slice(-6))}`);
  assert.ok(!first.includes('\uFFFD'), 'no replacement character may appear');
  const hits = await fs.grepFile('k.txt', 'second', {});
  assert.equal(hits[0].text, 'second');
});

test('fs.read caps a huge file without loading it whole', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'huge.txt'), 'q'.repeat(4 * 1024 * 1024));
  const text = await fs.read('huge.txt', { maxBytes: 50 });
  assert.match(text, /^q{50}\[?/);
  assert.match(text, /\[truncated: kept 50 of 4194304 bytes/);
});

test('read_file paging still uses 1-indexed lines on a large file', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'p.txt'), Array.from({ length: 100000 }, (_, i) => `L${i}`).join('\n'));
  assert.equal(await fs.read_file({ path: 'p.txt', offset: 3, limit: 2 }), 'L2\nL3');
});

test('read_file unpaged over 262144 bytes still throws', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(262145));
  await assert.rejects(fs.read_file({ path: 'big.txt' }), /262144/);
});

test('an excessive single line is bounded in the output', async () => {
  const { root, fs } = host();
  const line = 'needle' + 'y'.repeat(400000);
  writeFileSync(path.join(root, 'wide.txt'), `head\n${line}\ntail`);
  const hits = await fs.grepFile('wide.txt', 'needle', { maxLineBytes: 256 });
  assert.equal(hits.length, 1);
  assert.ok(
    Buffer.byteLength(hits[0].text) < 1024,
    `one line returned ${Buffer.byteLength(hits[0].text)} bytes`,
  );
  assert.match(hits[0].text, /line truncated/);
});

test('grepFile honours a RegExp built in another realm', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'doc.md'), ['# One', 'filler', '## Two', 'filler', '## Three'].join('\n'));
  const guestRe = vm.runInContext('/^## /', vm.createContext({}));
  const hits = await fs.grepFile('doc.md', guestRe, { context: 1 });
  assert.equal(hits.length, 2, 'a guest-realm regex must not be re-stringified into a literal');
  assert.equal(hits[0].line, 3);
});

test('grepFile with a global regex does not skip every other match', async () => {
  const { root, fs } = host();
  writeFileSync(path.join(root, 'g.md'), ['aa', 'aa', 'aa', 'aa'].join('\n'));
  const hits = await fs.grepFile('g.md', /aa/g, {});
  assert.equal(hits.length, 4, 'lastIndex must not leak between lines');
});

// -------------------------------------------------------------- patch semantics

test('Update File applies multiple @@ chunks against the original', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'm.txt', content: 'alpha\nmiddle\nomega\n' });
  const patch = [
    '*** Begin Patch',
    '*** Update File: m.txt',
    '@@',
    '-alpha',
    '+ALPHA',
    '@@',
    '-omega',
    '+OMEGA',
    '*** End Patch',
  ].join('\n');
  assert.deepEqual(await apply_patch(patch), {});
  assert.equal(readFileSync(path.join(root, 'm.txt'), 'utf8'), 'ALPHA\nmiddle\nOMEGA\n');
});

test('an @@ heading line is optional context, not an edit line', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'h.txt', content: 'def a\nbody\n' });
  const patch = [
    '*** Begin Patch',
    '*** Update File: h.txt',
    '@@ def a',
    '-body',
    '+BODY',
    '*** End Patch',
  ].join('\n');
  await apply_patch(patch);
  assert.equal(readFileSync(path.join(root, 'h.txt'), 'utf8'), 'def a\nBODY\n');
});

test('*** End of File anchors the edit to the last occurrence', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'eof.txt', content: 'dup\nmid\ndup' });
  const patch = [
    '*** Begin Patch',
    '*** Update File: eof.txt',
    '@@',
    '-dup',
    '+LAST',
    '*** End of File',
    '*** End Patch',
  ].join('\n');
  await apply_patch(patch);
  assert.equal(readFileSync(path.join(root, 'eof.txt'), 'utf8'), 'dup\nmid\nLAST');
});

test('without the EOF marker an ambiguous oldText is still refused', async () => {
  const { root, fs, apply_patch } = host();
  await fs.write_file({ file_path: 'amb.txt', content: 'dup\nmid\ndup' });
  const patch = ['*** Begin Patch', '*** Update File: amb.txt', '@@', '-dup', '+X', '*** End Patch'].join('\n');
  await assert.rejects(apply_patch(patch), /not unique/);
  assert.equal(readFileSync(path.join(root, 'amb.txt'), 'utf8'), 'dup\nmid\ndup');
});

test('Add File writes the conventional trailing newline', async () => {
  const { root, apply_patch } = host();
  await apply_patch('*** Begin Patch\n*** Add File: n.txt\n+hello\n*** End Patch');
  assert.equal(readFileSync(path.join(root, 'n.txt'), 'utf8'), 'hello\n');
});

test('Add File does not double the trailing newline', async () => {
  const { root, apply_patch } = host();
  await apply_patch('*** Begin Patch\n*** Add File: t.txt\n+hello\n+\n*** End Patch');
  assert.equal(readFileSync(path.join(root, 't.txt'), 'utf8'), 'hello\n');
});

test('a malformed later hunk is rejected before the first write', async () => {
  const { root, apply_patch } = host();
  const patch = [
    '*** Begin Patch',
    '*** Add File: good.txt',
    '+kept',
    '*** Update File: other.txt',
    'bad line with no marker',
    '*** End Patch',
  ].join('\n');
  await assert.rejects(apply_patch(patch), /bad update line/);
  assert.equal(existsSync(path.join(root, 'good.txt')), false, 'nothing may be written before validation');
});

test('a partial failure reports applied[] and failedFile and keeps the original error', async () => {
  const { root, apply_patch } = host();
  const outside = path.join(tmpdir(), `codemode-outside-${process.pid}.txt`);
  const patch = [
    '*** Begin Patch',
    '*** Add File: first.txt',
    '+kept',
    `*** Add File: ${outside}`,
    '+nope',
    '*** End Patch',
  ].join('\n');
  const err = await apply_patch(patch).then(() => null, (e) => e);
  assert.ok(err, 'the out-of-root target must fail');
  assert.equal(err.code, 'EROOT', 'the original error code survives');
  assert.match(err.message, /escapes configured roots/);
  assert.deepEqual(err.applied, [path.join(root, 'first.txt')]);
  assert.equal(err.failedFile, outside);
  assert.equal(readFileSync(path.join(root, 'first.txt'), 'utf8'), 'kept\n');
  assert.equal(existsSync(outside), false);
});
