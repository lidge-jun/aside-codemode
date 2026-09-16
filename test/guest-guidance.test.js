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
const run = (code, env) => {
  try {
    return JSON.parse(execFileSync(process.execPath, [cli, '--code', '-'], {
      encoding: 'utf8', input: code, env: { ...process.env, ...env },
    }));
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

// A name borrowed from the Aside REPL, where a tab is opened with openTab.
test('a name borrowed from the REPL answers with the batch that replaces it', () => {
  const out = run('return browse.open("https://example.com")');
  assert.equal(out.ok, false);
  assert.match(out.error, /browse\.exec\(\{ urls \}\)/);
  for (const member of ['attach', 'captureMany', 'exec', 'readText']) {
    assert.ok(out.error.includes(member), `missing ${member} in: ${out.error}`);
  }
});

// The table throws; everything else stays silent. A version-tolerant script probes for a
// capability before using it, and a probe that crashes is worse than the blind TypeError this
// layer replaces — the script never reaches its own fallback.
test('a capability probe for a name nobody predicted stays silent', () => {
  const out = run([
    'const probes = {',
    '  truthy: Boolean(browse.somethingFromAFutureVersion),',
    '  typed: typeof fs.somethingFromAFutureVersion,',
    '  optional: search.somethingFromAFutureVersion?.() ?? "fallback",',
    '  destructured: (({ alsoNotHere }) => alsoNotHere)(browse) ?? "fallback",',
    '};',
    'return probes;',
  ].join('\n'));
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.result, { truthy: false, typed: 'undefined', optional: 'fallback', destructured: 'fallback' });
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
    '  present: typeof fs.readMany,',
    '};',
  ].join('\n'));
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.discovery, 'function');
  assert.equal(out.result.read, 'function');
  assert.ok(out.result.members >= 11);
  assert.equal(out.result.present, 'function');
});

// The checkout is not inside a configured root on every runner — on Windows CI the workspace
// lives on another drive than the home directory — so this names the root it searches.
test('a real call is untouched by the guidance layer', () => {
  const bin = path.join(root, 'bin');
  const out = run(
    'const rows = await search.files({ path: ' + JSON.stringify(bin) + ' }); return { n: rows.length, complete: rows.complete };',
    { CODEMODE_ROOTS: root },
  );
  assert.equal(out.ok, true, out.error);
  assert.ok(out.result.n > 0);
  assert.equal(out.result.complete, true);
});

// A name from another environment entirely. Node stops at "x is not defined", which does not
// say whether the capability is missing or only named differently.
test('a global from somewhere else names the guest equivalent', () => {
  const cases = [
    ['return web_search("x")', /browse\.searchMany/],
    ['return fetch("https://example.com")', /browse\.readText/],
    ['return process.version', /--doctor/],
    ['return require("fs")', /no module loader/],
  ];
  for (const [code, expected] of cases) {
    const out = run(code);
    assert.equal(out.ok, false, code);
    assert.equal(out.code, 'EGUESTNAME', code);
    assert.match(out.error, expected);
  }
});

// An ordinary typo is still an ordinary typo: translating it would hide the author's own bug.
test("a name nobody publishes keeps the engine's own words", () => {
  const out = run('return someRandomThing');
  assert.equal(out.ok, false);
  assert.match(out.error, /someRandomThing is not defined/);
  assert.equal(out.code, undefined);
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
