// Guest global `search` (A-D4). Throws on failure; execute_code maps to ok:false.
//
// Three behaviours here exist because of measured agent failures (2026-09-13):
//  1. Unknown options used to be silently dropped. An agent passed
//     `noIgnore: true`, got the same ignored-file result set back, and had no
//     way to tell the option did nothing. Unknown keys are a hard error that
//     names the valid ones.
//  2. `.gitignore` silently removed 126 of 356 matching files from a repo-wide
//     search, including the target repo's own README, because a parent
//     .gitignore listed the whole project dir. `noIgnore`/`hidden` are
//     first-class, and the effective policy is reported on `.scope`.
//  3. Option VALUES were unvalidated: max:0 / max:NaN / context:-1 reached rg as
//     nonsense flags, and `followSymlinks:true` walked outside the configured
//     roots. Values are validated here — before the rg resolver runs and before
//     any process is spawned — so an unsupported option can never touch content.
//
// The option contract itself is owned by ../search-schema.js so this file, the
// discovery catalog and the runner cannot drift.
import { validateSearchOptions } from '../search-schema.js';

export function createSearch({ rgRunner, assertInside, caps }) {
  return Object.freeze({
    async files(opts = {}) {
      // Validation first: rejecting followSymlinks:true (ENOTSUP) must happen
      // before assertInside/resolveRg, so no path is resolved and no process is
      // spawned for an unsupported request.
      validateSearchOptions('search.files', opts);
      const dir = assertInside(opts.path);
      return rgRunner.files({ ...opts, path: dir, max: opts.max ?? caps.files });
    },

    async content(opts = {}) {
      validateSearchOptions('search.content', opts);
      const dir = assertInside(opts.path);
      return rgRunner.content({ ...opts, path: dir, max: opts.max ?? caps.content });
    },

    // Pre-flight sizing: returns {matches, files} without materializing rows.
    async count(opts = {}) {
      validateSearchOptions('search.count', opts);
      const dir = assertInside(opts.path);
      return rgRunner.count({ ...opts, path: dir });
    },
  });
}
