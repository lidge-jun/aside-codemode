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
import { decorateSearchResult } from '../search-result.js';
import { hasNonAscii } from '../unicode.js';

function normalizationCases(opts, fields) {
  const normalizedFields = fields.filter((field) => hasNonAscii(opts[field]));
  if (normalizedFields.length === 0) return null;
  let cases = [{}];
  for (const field of normalizedFields) {
    cases = cases.flatMap((entry) => ['NFC', 'NFD'].map((form) => ({
      ...entry,
      [field]: opts[field].normalize(form),
    })));
  }
  const unique = [...new Map(cases.map((entry) => [JSON.stringify(entry), entry])).values()];
  return {
    fields: normalizedFields,
    original: Object.fromEntries(normalizedFields.map((field) => [field, opts[field]])),
    cases: unique,
  };
}

function mergeRows(results, max, rowKey, normalization) {
  const rows = [];
  const seen = new Set();
  for (const result of results) {
    for (const row of result) {
      const key = rowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  const capped = rows.length > max;
  if (capped) rows.length = max;
  const partial = [...new Set(results.flatMap((result) => result.partial))];
  const truncated = capped || results.some((result) => result.truncated);
  const normalizationComplete = results.every((result) => result.complete);
  return decorateSearchResult(rows, {
    truncated,
    partial,
    complete: !truncated && partial.length === 0 && normalizationComplete,
    scope: {
      ...results[0].scope,
      ...normalization.original,
      normalization: {
        fields: normalization.fields,
        formsSearched: ['NFC', 'NFD'],
        complete: normalizationComplete,
      },
    },
  });
}

export function createSearch({ rgRunner, assertInside, caps }) {
  return Object.freeze({
    async files(opts = {}) {
      // Validation first: rejecting followSymlinks:true (ENOTSUP) must happen
      // before assertInside/resolveRg, so no path is resolved and no process is
      // spawned for an unsupported request.
      validateSearchOptions('search.files', opts);
      const dir = assertInside(opts.path);
      const max = opts.max ?? caps.files;
      const normalization = normalizationCases(opts, ['pattern', 'glob']);
      if (!normalization) return rgRunner.files({ ...opts, path: dir, max });
      const results = [];
      for (const normalized of normalization.cases) {
        results.push(await rgRunner.files({ ...opts, ...normalized, path: dir, max }));
      }
      return mergeRows(results, max, (file) => file, normalization);
    },

    async content(opts = {}) {
      validateSearchOptions('search.content', opts);
      const dir = assertInside(opts.path);
      const max = opts.max ?? caps.content;
      const normalization = normalizationCases(opts, ['query', 'glob']);
      if (!normalization) return rgRunner.content({ ...opts, path: dir, max });
      const results = [];
      for (const normalized of normalization.cases) {
        results.push(await rgRunner.content({ ...opts, ...normalized, path: dir, max }));
      }
      return mergeRows(
        results,
        max,
        (hit) => JSON.stringify([hit.file, hit.line, hit.text, hit.context]),
        normalization,
      );
    },

    // Pre-flight sizing: returns {matches, files} without materializing rows.
    async count(opts = {}) {
      validateSearchOptions('search.count', opts);
      const dir = assertInside(opts.path);
      return rgRunner.count({ ...opts, path: dir });
    },
  });
}
