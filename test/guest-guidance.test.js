// These run through the real CLI on purpose. The first version of this guidance was
// attached to the host objects and passed its unit tests while the guest saw none of it:
// the worker is handed a manifest of method names and rebuilds the namespaces itself, so
// a proxy or a stub on the host is gone before a script can reach it. A unit test cannot
// see that gap. A script run through the CLI is the only witness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adviseName } from '../src/guest-guidance.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'codemode.mjs');
// A refused call exits non-zero with the envelope on stdout, which is the shape a caller
// sees; parse it either way rather than letting the exit code hide the message.
const run = (code) => {
  try {
    return JSON.parse(execFileSync(process.execPath, [cli, '--code', '-'], { encoding: 'utf8', input: code }));
  } catch (e) {
    const text = String(e.stdout || '');
    if (!text.trim()) throw e;
    return JSON.parse(text);
  }
};

// Every line here is a call an agent actually wrote, taken from session logs, with the
// phrase the answer has to contain for the next attempt to be right.
const WRONG_CALLS = [
  ['return actions.fs.search({ path: "/tmp" })', ['discovery only', 'fs.read(path)']],
  ['return actions.search.content({ query: "x", path: "/tmp" })', ['discovery only', 'search.content({ path, query })']],
  ['return actions.browse.exec({ urls: [] })', ['discovery only', 'browse.exec({ urls })']],
  ['return actions.call("browse.exec", {})', ['no generic caller', 'actions.check(path, args)']],
  ['return actions.run("browse.exec")', ['no generic caller']],
  ['return fs.readFile("/tmp/x")', ['Aside REPL name', 'fs.read(path)', 'read_file({ path, offset, limit })']],
  ['return fs.writeFile("/tmp/x", "y")', ['Aside REPL name', 'write_file({ file_path, content })']],
  ['return fs.readdir("/tmp")', ['fs.list(path)']],
  ['return fs.appendFile("/tmp/x", "y")', ['edit_file({ path, appendText })']],
  ['return fs.existsSync("/tmp/x")', ['async', 'await fs.exists(path)']],
  ['return fs.unlink("/tmp/x")', ['cannot delete files']],
  ['return search.grep({ path: "/tmp" })', ['search.grep does not exist', 'content, count, files']],
];

test('a wrong name reaches guest code as the right one', () => {
  for (const [code, phrases] of WRONG_CALLS) {
    const out = run(code);
    assert.equal(out.ok, false, code);
    assert.equal(out.code, 'EGUESTNAME', code);
    for (const phrase of phrases) {
      assert.ok(out.error.includes(phrase), `${code}\n  expected: ${phrase}\n  got: ${out.error}`);
    }
  }
});

test('an unknown namespace member answers with the members that do exist', () => {
  const out = run('return browse.open("https://example.com")');
  assert.equal(out.ok, false);
  for (const member of ['attach', 'captureMany', 'exec', 'readText']) {
    assert.ok(out.error.includes(member), `missing ${member} in: ${out.error}`);
  }
});

test('actions.list is synchronous and says so when awaited like a promise', () => {
  const out = run('return actions.list().catch(() => [])');
  assert.equal(out.ok, false);
  assert.match(out.error, /synchronous/);
  assert.equal(run('const rows = await actions.list("fs."); return rows.length > 0').result, true);
});

// The trap must not turn ordinary object behaviour into a failure. A namespace is awaited,
// serialized and inspected by perfectly normal guest code.
test('normal reads through a taught namespace still behave like an object', () => {
  const out = run([
    'const a = await actions;',
    'const f = await fs;',
    'return {',
    '  discovery: typeof a.describe,',
    '  read: typeof f.read,',
    '  members: Object.keys(f).length,',
    '  json: JSON.stringify(a),',
    '  absent: typeof fs.readMany,',
    '};',
  ].join('\n'));
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.discovery, 'function');
  assert.equal(out.result.read, 'function');
  assert.ok(out.result.members >= 11);
  assert.equal(out.result.absent, 'function');
});

test('a real call is untouched by the guidance layer', () => {
  const out = run('const rows = await search.files({ path: ' + JSON.stringify(path.join(root, 'bin')) + ' }); return { n: rows.length, complete: rows.complete };');
  assert.equal(out.ok, true, out.error);
  assert.ok(out.result.n > 0);
  assert.equal(out.result.complete, true);
});

// The table itself, without a process: one case per branch so a future edit that empties a
// message fails here rather than in a session.
test('the guidance table names a replacement for every branch', () => {
  assert.match(adviseName('actions', 'fs', []), /discovery only/);
  assert.match(adviseName('actions', 'invoke', []), /no generic caller/);
  assert.match(adviseName('fs', 'readFile', []), /Aside REPL name/);
  assert.match(adviseName('fs', 'readdir', []), /fs\.list\(path\)/);
  assert.equal(adviseName('fs', 'somethingNobodyGuesses', []), null);
  assert.match(adviseName('search', 'grep', ['content', 'count', 'files']), /search has content, count, files/);
});
