// Artifact containment. `pwd` is reported by the script, so it is influenced data: these
// pin that the host names the files and refuses anything that resolves out of the session.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { artifactNameFor, containedRead, ArtifactError } from '../src/host/browse/capture.js';

test('artifact names are host-generated and carry no caller input', () => {
  const a = artifactNameFor(0, {});
  const b = artifactNameFor(0, {});
  assert.match(a, /^shot-000-[0-9a-f-]{36}\.png$/);
  assert.notEqual(a, b, 'names must not collide across calls');
  assert.match(artifactNameFor(2, { type: 'jpeg' }), /^shot-002-.*\.jpg$/);
});

test('a path-like artifact name is refused before any filesystem call', async () => {
  let touched = false;
  const deps = { realpathImpl: async (p) => { touched = true; return p; }, readFileImpl: async () => Buffer.alloc(0) };
  for (const bad of ['../escape.png', 'a/b.png', 'a\\b.png', '..']) {
    await assert.rejects(containedRead('/session', bad, deps), (e) => e instanceof ArtifactError && e.code === 'EBADNAME');
  }
  assert.equal(touched, false, 'a bad name must not reach the filesystem');
});

test('an artifact resolving outside the session directory is refused', async () => {
  const root = path.join('/session', 'artifacts');
  const deps = {
    // Simulate a symlink that escapes: realpath returns somewhere else entirely.
    realpathImpl: async (p) => (p === root ? root : '/elsewhere/evil.png'),
    readFileImpl: async () => Buffer.from('pwned'),
  };
  await assert.rejects(containedRead('/session', 'shot.png', deps), (e) => e.code === 'EESCAPE');
});

test('a missing session directory is an error, not a silent empty read', async () => {
  await assert.rejects(containedRead(null, 'shot.png', {}), (e) => e.code === 'ENOPWD');
});

test('a contained artifact is read from under the session artifacts dir', async () => {
  const root = path.join('/session', 'artifacts');
  const seen = [];
  const deps = {
    realpathImpl: async (p) => p,
    readFileImpl: async (p) => { seen.push(p); return Buffer.from('bytes'); },
  };
  const buf = await containedRead('/session', 'shot.png', deps);
  assert.equal(String(buf), 'bytes');
  assert.equal(seen[0], path.join(root, 'shot.png'));
});
