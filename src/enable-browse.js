// Browsing is opt-in and stays that way. This is only the shortest honest path from the
// refusal to a working call: one command, one key, nothing else touched.
//
// It writes the USER config, not the repository one. browseCaps is a machine-level decision
// and the repository file is generated per checkout; editing that one would turn a global
// install into a no-op and a fresh clone into a surprise.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { userConfigPath } from './config.js';

export const ENABLE_BROWSE_COMMAND = 'codemode --enable-browse';

export function enableBrowse({ env = process.env, homedir } = {}) {
  const target = userConfigPath(env, homedir);
  let current = {};
  if (existsSync(target)) {
    try { current = JSON.parse(readFileSync(target, 'utf8')); } catch (e) {
      const err = new Error(`${target} is not valid JSON, so it will not be rewritten: ${e.message}`);
      err.code = 'EBADCONFIG';
      throw err;
    }
  }
  if (current && current.browseCaps && current.browseCaps.enabled === true) {
    return { ok: true, enabled: true, alreadyEnabled: true, path: target, wrote: false };
  }
  // Merge, never replace. A caller's roots, rgPath and caps are theirs; this command has an
  // opinion about exactly one boolean.
  const next = { ...current, browseCaps: { ...(current.browseCaps || {}), enabled: true } };
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return { ok: true, enabled: true, alreadyEnabled: false, path: target, wrote: true };
}
