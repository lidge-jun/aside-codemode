// wp9. The install path is whatever the user's machine actually is: a home directory with a
// space in it, a Korean folder name, an apostrophe. And an Aside home may hold more than one
// account, so 'u/0' is a guess, not an answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInstaller, MANIFEST_RELPATH } from '../scripts/install-codemode.mjs';
import { listAccountRoots } from '../src/register.js';

function homeIn(dirName) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'acm-paths-'));
  const home = path.join(base, dirName, '.aside');
  mkdirSync(path.join(home, 'u', '0'), { recursive: true });
  return { base, home, root: path.join(home, 'u', '0') };
}

for (const dirName of ['with space', '한글폴더', "it's mine", 'amp & dollar $x']) {
  test('installs under a directory named ' + JSON.stringify(dirName), (t) => {
    const f = homeIn(dirName);
    t.after(() => rmSync(f.base, { recursive: true, force: true }));
    const out = runInstaller({ verb: 'install', asideHome: f.home, account: '0' });
    assert.deepEqual(out.preserved, []);
    assert.ok(existsSync(path.join(f.root, 'codemode/cm.js')));
    const doctor = runInstaller({ verb: 'doctor', asideHome: f.home, account: '0' });
    assert.deepEqual(doctor.files.filter((x) => !x.ok), [], JSON.stringify(doctor.files));
    assert.equal(doctor.agentsBlock, 'current');
  });
}

test('a CRLF AGENTS.md keeps its own content and still gets one block', (t) => {
  const f = homeIn('crlf');
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  writeFileSync(path.join(f.root, 'AGENTS.md'), '# notes\r\n\r\nkeep this\r\n');
  runInstaller({ verb: 'install', asideHome: f.home, account: '0' });
  runInstaller({ verb: 'install', asideHome: f.home, account: '0' });
  const agents = readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('keep this'));
  assert.equal(agents.split('<!-- aside-codemode:start -->').length - 1, 1);
});

test('two accounts are enumerated, and only the named one is written', (t) => {
  const f = homeIn('multi');
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  mkdirSync(path.join(f.home, 'u', '1'), { recursive: true });
  writeFileSync(path.join(f.home, 'accounts.json'), JSON.stringify({
    currentAccountId: 1,
    accounts: [{ id: 0, email: 'zero@example.test' }, { id: 1, email: 'one@example.test' }],
  }));

  const { roots } = listAccountRoots({ asideHome: f.home });
  assert.deepEqual(roots.map((r) => r.id).sort(), ['0', '1']);
  assert.equal(roots[0].id, '1', 'the current account comes first');

  const out = runInstaller({ verb: 'install', asideHome: f.home, account: '0' });
  assert.equal(out.account, '0');
  assert.ok(existsSync(path.join(f.home, 'u', '0', MANIFEST_RELPATH)));
  assert.equal(existsSync(path.join(f.home, 'u', '1', MANIFEST_RELPATH)), false,
    'an account nobody asked for was written to');
});

test('with no account named, the current one is chosen rather than u/0', (t) => {
  const f = homeIn('current');
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  mkdirSync(path.join(f.home, 'u', '1'), { recursive: true });
  writeFileSync(path.join(f.home, 'accounts.json'), JSON.stringify({ currentAccountId: 1, accounts: [{ id: 0 }, { id: 1 }] }));
  const out = runInstaller({ verb: 'install', asideHome: f.home });
  assert.equal(out.account, '1');
});

test('nothing from accounts.json reaches the manifest', (t) => {
  const f = homeIn('secrets');
  t.after(() => rmSync(f.base, { recursive: true, force: true }));
  writeFileSync(path.join(f.home, 'accounts.json'), JSON.stringify({
    currentAccountId: 0,
    accounts: [{ id: 0, email: 'someone@example.test', accessToken: 'tok_SECRET_VALUE', refreshToken: 'ref_SECRET_VALUE' }],
  }));
  const out = runInstaller({ verb: 'install', asideHome: f.home, account: '0' });
  const written = readFileSync(path.join(f.root, MANIFEST_RELPATH), 'utf8');
  for (const secret of ['tok_SECRET_VALUE', 'ref_SECRET_VALUE', 'someone@example.test']) {
    assert.equal(written.includes(secret), false, secret + ' was copied into the manifest');
    assert.equal(JSON.stringify(out).includes(secret), false, secret + ' was reported back to the caller');
  }
});
