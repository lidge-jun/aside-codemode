// The release path is a workflow nobody reads until it fails, so the facts that make it a
// TOKENLESS publish are pinned here rather than remembered. Trusted publishing works only when
// the job asks for an OIDC identity, the runner ships an npm new enough to trade it, and no
// long-lived token is lying around to be used instead. The npm side of the pairing is the
// workflow FILENAME, so renaming this file without updating the trusted publisher on npmjs.com
// breaks the publish with ENEEDAUTH and nothing in the repository would notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = path.join(repoRoot, '.github', 'workflows', 'release.yml');
const src = readFileSync(WORKFLOW, 'utf8');
// Prose explaining why a thing is absent is not the thing being present.
const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('the release job asks for the OIDC identity npm trades for a credential', () => {
  assert.match(code, /id-token: write/);
  assert.match(code, /contents: write/);
  assert.match(code, /actions: read/);
  // Naming any permission zeroes the rest, so the top-level default has to be explicit.
  assert.match(code, /permissions: \{\}/);
});

test('nothing in the release path carries a long-lived npm token', () => {
  assert.equal(/NPM_TOKEN/.test(code), false);
  assert.equal(/NODE_AUTH_TOKEN/.test(code), false);
  assert.equal(/secrets\./.test(code), false);
  // provenance comes from the OIDC exchange; passing the flag would imply it does not.
  assert.equal(/--provenance/.test(code), false);
});

test('the runner is new enough, and the npm it publishes with is the one it shipped', () => {
  assert.match(code, /node-version: 24/);
  assert.match(code, /registry-url/);
  assert.match(code, /11\.5\.1/);
  // A global npm self-update has been seen to drop sigstore, which provenance needs.
  assert.equal(/npm install -g npm/.test(code), false);
});

test('a dispatch cannot publish a commit nobody audited', () => {
  assert.match(code, /expected-sha/);
  assert.match(code, /refs\/heads\/main/);
  assert.match(code, /\[0-9a-f\]\{40\}/);
  assert.match(code, /dry-run/);
});

test('publication is gated on this commit, and refuses a version that already exists', () => {
  assert.match(code, /--workflow ci\.yml/);
  assert.match(code, /--commit "\$GITHUB_SHA"/);
  assert.match(code, /--event push/);
  assert.match(code, /npm view/);
  assert.match(code, /npm test/);
});

// There is no lockfile in this package and nothing to install. ci.yml is held to the same rule.
test('the release job does not reach for a lockfile that does not exist', () => {
  assert.equal(/npm ci/.test(code), false);
});
