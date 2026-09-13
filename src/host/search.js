// Guest global `search` (A-D4). Throws on failure; execute_code maps to ok:false.
//
// Two behaviours here exist because of measured agent failures (2026-09-13):
//  1. Unknown options used to be silently dropped. An agent passed
//     `noIgnore: true`, got the same ignored-file result set back, and had no
//     way to tell the option did nothing. Unknown keys are now a hard error
//     that names the valid ones.
//  2. `.gitignore` silently removed 126 of 356 matching files from a repo-wide
//     search, including the target repo's own README, because a parent
//     .gitignore listed the whole project dir. `noIgnore`/`hidden` are now
//     first-class, and the miss is explained in the error surface + docs.

const FILES_OPTS = new Set([
  'pattern', 'path', 'glob', 'max',
  'noIgnore', 'hidden', 'followSymlinks', 'maxFilesize', 'timeoutMs', 'includeExcluded',
]);
const CONTENT_OPTS = new Set([
  'query', 'path', 'glob', 'context', 'max', 'ignoreCase',
  'noIgnore', 'hidden', 'followSymlinks', 'fixedStrings', 'multiline',
  'wordRegexp', 'maxFilesize', 'timeoutMs', 'includeExcluded',
]);
const COUNT_OPTS = new Set([
  'query', 'path', 'glob', 'ignoreCase',
  'noIgnore', 'hidden', 'followSymlinks', 'fixedStrings', 'maxFilesize', 'timeoutMs', 'includeExcluded',
]);

function rejectUnknown(fn, opts, allowed) {
  const bad = Object.keys(opts).filter((k) => !allowed.has(k));
  if (bad.length) {
    const err = new Error(
      `${fn}: unknown option(s) ${bad.map((b) => JSON.stringify(b)).join(', ')}. ` +
      `valid: ${[...allowed].join(', ')}`,
    );
    err.code = 'EBADOPT';
    throw err;
  }
}

function requireString(fn, name, v) {
  if (typeof v !== 'string' || !v) throw new Error(`${fn}: ${name} (non-empty string) is required`);
}

export function createSearch({ rgRunner, assertInside, caps }) {
  return Object.freeze({
    async files(opts = {}) {
      rejectUnknown('search.files', opts, FILES_OPTS);
      requireString('search.files', 'path', opts.path);
      const dir = assertInside(opts.path);
      return rgRunner.files({ ...opts, path: dir, max: opts.max ?? caps.files });
    },

    async content(opts = {}) {
      rejectUnknown('search.content', opts, CONTENT_OPTS);
      requireString('search.content', 'query', opts.query);
      requireString('search.content', 'path', opts.path);
      const dir = assertInside(opts.path);
      return rgRunner.content({ ...opts, path: dir, max: opts.max ?? caps.content });
    },

    // Pre-flight sizing: returns {matches, files} without materializing rows.
    async count(opts = {}) {
      rejectUnknown('search.count', opts, COUNT_OPTS);
      requireString('search.count', 'query', opts.query);
      requireString('search.count', 'path', opts.path);
      const dir = assertInside(opts.path);
      return rgRunner.count({ ...opts, path: dir });
    },
  });
}
