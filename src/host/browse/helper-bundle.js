// The native batch helper as the host ships it: one file on disk, one version string, one
// hash. Everything that installs, injects or verifies cm.js reads it from here, so the copy
// in an account root and the copy inlined into a generated script can be proven identical.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const HELPER_URL = new URL('../../../templates/native-helper/cm.js', import.meta.url);

// The helper's own version, bumped when its shape changes. It is deliberately not the
// package version: a release that does not touch cm.js must not tell an installed copy it
// is stale, and a change to cm.js between releases must not go unnoticed.
export const HELPER_VERSION = '1.0.0';

// A REPL session is not a place to ship a library. The helper is inlined into a generated
// script that the host caps at 30000 characters, and it is read by a person deciding whether
// to trust it. Both arguments point the same way: keep it small enough to read.
export const HELPER_MAX_BYTES = 8192;

// The install path, relative to an Aside account root. The REPL resolves a relative read
// from its own session directory, so the load line an agent writes is '../../codemode/cm.js';
// both forms were probed on macOS and Windows before this was written down.
export const HELPER_INSTALL_RELPATH = 'codemode/cm.js';
export const HELPER_LOAD_RELPATH = '../../codemode/cm.js';

let cached = null;

// Synchronous on purpose. compile() is synchronous and is called on the request path; making
// it async to read one cached 6KB file would change every caller for no gain.
export function helperSource(version = HELPER_VERSION) {
  if (cached && cached.version === version) return cached.bundle;
  const raw = readFileSync(HELPER_URL, 'utf8');
  const src = raw.replace('__CM_VERSION__', String(version));
  const bundle = Object.freeze({
    src,
    version: String(version),
    sha256: createHash('sha256').update(src).digest('hex'),
    bytes: Buffer.byteLength(src),
  });
  cached = { version, bundle };
  return bundle;
}

// What the envelope carries: enough to tell which helper answered, never the body.
export function helperStamp(version = HELPER_VERSION) {
  const { version: v, sha256, bytes } = helperSource(version);
  return { version: v, sha256, bytes };
}
