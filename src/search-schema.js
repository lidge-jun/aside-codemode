// Canonical owner of the search option contract (plan 020_search.md).
//
// Before this module the same option set existed THREE times: as Sets in
// host/search.js, as catalog `inputs` in host/actions.js, and implicitly as
// destructuring defaults in rg.js. They drifted — `includeExcluded` was
// executable but undocumented, so `actions.check('search.content', {
// includeExcluded: true })` reported it as an unknown option while the real
// call accepted it. One definition here, consumed by all three.
//
// It also owns VALUE validation, so discovery (actions.check) and execution
// (search.*) cannot disagree about what is acceptable: a `max` that the catalog
// calls fine but the runner turns into `--max 0` is a lie.

export class SearchOptionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SearchOptionError';
    this.code = code;
  }
}

// followSymlinks:true is rejected, not honoured (design decision D3). A
// followed symlink reads OUTSIDE the configured roots before any filtering can
// happen — measured 2026-09-13 against an out-of-root sentinel file. Until a
// guarded traversal exists, the clear refusal is the safe answer. `false` stays
// a supported, meaningful value.
const FOLLOW_SYMLINKS_UNSUPPORTED =
  'followSymlinks:true is not supported: following a symlink can read outside the configured roots '
  + 'before results are filtered. Use followSymlinks:false (default), or point `path` at the real directory.';

const MAX_FILESIZE_RE = /^(\d+)([KMG]?)$/;

function positiveInt(name, v) {
  if (!Number.isSafeInteger(v) || v <= 0) {
    return `${name} must be a positive integer (got ${JSON.stringify(v)})`;
  }
  return null;
}

function nonNegativeInt(name, v) {
  if (!Number.isSafeInteger(v) || v < 0) {
    return `${name} must be a non-negative integer (got ${JSON.stringify(v)})`;
  }
  return null;
}

function nonEmptyString(name, v) {
  if (typeof v !== 'string' || v.length === 0) {
    return `${name} must be a non-empty string (got ${JSON.stringify(v)})`;
  }
  return null;
}

// One entry per option: the catalog description, the declared type, and the
// value rule. `code` lets a rule be something other than a plain bad value
// (followSymlinks is ENOTSUP, an unsupported capability, not a typo).
const OPTS = {
  path: {
    type: 'string',
    required: true,
    description: 'Directory or file inside the configured roots (relative paths resolve against --cwd)',
    validate: (v) => nonEmptyString('path', v),
  },
  query: {
    type: 'string',
    required: true,
    description: 'ripgrep regex; set fixedStrings:true for a literal string',
    validate: (v) => nonEmptyString('query', v),
  },
  pattern: {
    type: 'string',
    required: false,
    description: "Case-sensitive SUBSTRING filter on the returned paths — not a glob. '*' and '?' are refused, because no path contains them and the call would return an empty result with no error; use `glob` instead. Compared with Unicode NFC folding, so a decomposed (macOS) filename still matches a composed needle.",
    validate: (v) => nonEmptyString('pattern', v),
  },
  glob: {
    type: 'string',
    required: false,
    description: "ripgrep -g glob, e.g. '**/*.ts'. Inclusive globs can match some gitignored/hidden files even when noIgnore/hidden are false (ripgrep glob precedence, not a root escape, and not -uuu).",
    validate: (v) => nonEmptyString('glob', v),
  },
  max: {
    type: 'number',
    required: false,
    description: 'GLOBAL cap on returned rows (not ripgrep --max-count, which is per file). rg is killed once it is reached and `.truncated` is set',
    validate: (v) => positiveInt('max', v),
  },
  context: {
    type: 'number',
    required: false,
    description: 'Lines of context around each match (ripgrep -C). Context is attached to the hit and never counts as a match',
    validate: (v) => nonNegativeInt('context', v),
  },
  timeoutMs: {
    type: 'number',
    required: false,
    description: 'Kill the search after this many milliseconds (positive integer)',
    validate: (v) => positiveInt('timeoutMs', v) || (v > 2147483647 ? 'timeoutMs exceeds the timer range' : null),
  },
  maxFilesize: {
    type: 'string',
    required: false,
    description: "Skip files larger than this, e.g. '1M' or '512K'",
    validate: (v) => {
      const s = nonEmptyString('maxFilesize', v);
      if (s) return s;
      const match = MAX_FILESIZE_RE.exec(v);
      const powers = { '': 0n, K: 10n, M: 20n, G: 30n };
      if (match && v.length <= 21 && (BigInt(match[1]) << powers[match[2]]) <= 18446744073709551615n) return null;
      return `maxFilesize must be an unsigned 64-bit ripgrep size: digits with an optional uppercase K, M or G (got ${JSON.stringify(v)})`;
    },
  },
  ignoreCase: { type: 'boolean', required: false, description: 'Case-insensitive search (-i)' },
  // fs.grepFile's option, not a search.* one. It is absent from every *_ORDER, so
  // search.files/content/count still reject it as unknown; it lives here because
  // host/actions.js validates grepFile values through this same table, and an
  // option that existed only in the catalog is exactly the drift this module was
  // written to stop.
  normalize: {
    type: 'boolean',
    required: false,
    description: 'fs.grepFile only. When the pattern itself is non-ASCII, retry a missed line against its NFC-folded form (default true). Returned text, line numbers and byte bounds are always the raw file — only the match decision is folded. Set false for byte-exact matching.',
  },
  fixedStrings: { type: 'boolean', required: false, description: 'Treat query as a literal string (-F)' },
  wordRegexp: { type: 'boolean', required: false, description: 'Match whole words only (-w)' },
  multiline: { type: 'boolean', required: false, description: 'Allow matches to span lines (-U --multiline-dotall)' },
  noIgnore: {
    type: 'boolean',
    required: false,
    description: 'Ignore .gitignore/.ignore rules. DEFAULT false — a parent .gitignore can silently hide an entire repo from results. Set true when a known file is missing from a search.',
  },
  hidden: { type: 'boolean', required: false, description: 'Include dotfiles and dot-directories (default false)' },
  includeExcluded: {
    type: 'boolean',
    required: false,
    description: 'Disable the configured excludeGlobs pruning (Library, node_modules, …) for this call. The effective policy is reported on the result as `.scope`.',
  },
  followSymlinks: {
    type: 'boolean',
    required: false,
    description: 'Only false is supported. true is rejected with ENOTSUP because a followed symlink can read outside the configured roots.',
    validate: (v) => (v === true ? FOLLOW_SYMLINKS_UNSUPPORTED : null),
    code: 'ENOTSUP',
  },
};

const DISCOVERY_ORDER = ['noIgnore', 'hidden', 'followSymlinks', 'includeExcluded', 'maxFilesize', 'timeoutMs'];

const FILES_ORDER = ['path', 'pattern', 'glob', 'max', ...DISCOVERY_ORDER];
const CONTENT_ORDER = [
  'query', 'path', 'glob', 'context', 'max',
  'ignoreCase', 'fixedStrings', 'wordRegexp', 'multiline',
  ...DISCOVERY_ORDER,
];
const COUNT_ORDER = ['query', 'path', 'glob', 'ignoreCase', 'fixedStrings', ...DISCOVERY_ORDER];

function inputsFor(order) {
  const out = {};
  for (const name of order) {
    const spec = OPTS[name];
    if (!spec) throw new Error(`search-schema: unknown option ${name}`);
    out[name] = { type: spec.type, required: spec.required, description: spec.description };
  }
  return out;
}

// The discovery catalog entries for the three search actions. host/actions.js
// splices these into its REGISTRY instead of restating them.
export const SEARCH_ACTIONS = [
  {
    path: 'search.files',
    description: 'List file paths under a directory (ripgrep --files). Streams and stops at `max`, so a large tree is safe.',
    signature: 'search.files({ path, pattern?, glob?, max?, noIgnore?, hidden?, followSymlinks?, includeExcluded?, maxFilesize?, timeoutMs? }) => Promise<string[]>',
    notes: "Returns an array usable with .length/.map/.filter. Non-enumerable `.truncated`, `.partial`, `.complete` and `.scope` describe the search itself; JSON serialization emits {rows,complete,truncated,partial,scope}. Returning only .length or a .map() projection deliberately drops that state — it is not a claim that the search was complete. `pattern` is a substring filter and `glob` is the glob: pattern:'*.pdf' is rejected with the glob you probably meant, instead of returning zero rows. Paths come back as the bytes on disk; the pattern comparison is NFC-folded so a decomposed macOS filename still matches. Inclusive glob can match some gitignored/hidden files even when noIgnore/hidden are false (ripgrep -g precedence, not -uuu).",
    inputs: inputsFor(FILES_ORDER),
  },
  {
    path: 'search.content',
    description: 'Search file contents with ripgrep. Returns matching lines with file, line number and optional context.',
    signature: 'search.content({ query, path, glob?, context?, max?, ignoreCase?, fixedStrings?, wordRegexp?, multiline?, noIgnore?, hidden?, followSymlinks?, includeExcluded?, maxFilesize?, timeoutMs? }) => Promise<{file,line,text,context?}[]>',
    notes: '`max` is a GLOBAL cap on returned rows (not ripgrep --max-count, which is per-file). `context` lines are attached as {before,after} on the hit and never consume the max budget. Unknown options and invalid values are rejected rather than ignored. Inclusive glob can match some gitignored/hidden files even when noIgnore/hidden are false (ripgrep -g precedence, not -uuu).',
    inputs: inputsFor(CONTENT_ORDER),
  },
  {
    path: 'search.count',
    description: 'Count matches and matching files WITHOUT returning rows. Use as a pre-flight to size a search before pulling results.',
    signature: 'search.count({ query, path, glob?, ignoreCase?, fixedStrings?, noIgnore?, hidden?, followSymlinks?, includeExcluded?, maxFilesize?, timeoutMs? }) => Promise<{matches,files}>',
    notes: 'Stays a plain {matches,files} object; `.complete`, `.truncated`, `.partial` and `.scope` are non-enumerable, and JSON serialization emits them alongside the counts. An unreadable path makes the count partial instead of silently smaller.',
    inputs: inputsFor(COUNT_ORDER),
  },
];

export const FILES_OPTS = new Set(FILES_ORDER);
export const CONTENT_OPTS = new Set(CONTENT_ORDER);
export const COUNT_OPTS = new Set(COUNT_ORDER);

export const OPT_SETS = {
  'search.files': FILES_OPTS,
  'search.content': CONTENT_OPTS,
  'search.count': COUNT_OPTS,
};

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// Rules that belong to ONE entry point, not to the option name.
//
// `pattern` is shared with fs.grepFile, where it is a REGEX and 'a*' is a legal
// quantifier. The glob refusal below therefore cannot live in OPTS.pattern:
// host/actions.js routes fs.grepFile through the same checkOptionValue, so
// discovery would start calling a working grepFile regex invalid while the real
// call still ran it — the exact catalog/execution drift this module exists to
// prevent.
const GLOB_METACHARS = /[*?]/;

function globPatternMessage(v) {
  const suggestion = v.includes('/') ? v : `**/${v}`;
  return 'pattern is a case-sensitive substring filter on the returned paths, not a glob '
    + `(got ${JSON.stringify(v)}). No path contains '*' or '?', so this matches nothing and `
    + `would come back as an empty result with no error. Use glob: ${JSON.stringify(suggestion)} `
    + 'for glob matching, or pass the literal substring to look for. A name that really does '
    + "contain '*' or '?' is possible on POSIX only: list it with `glob` and filter the returned "
    + 'rows yourself, which keeps the filter visible in your code instead of hidden in an option.';
}

const ENTRY_RULES = {
  'search.files': {
    pattern: (v) => (GLOB_METACHARS.test(v) ? globPatternMessage(v) : null),
  },
};

/**
 * checkOptionValue plus any rule that applies to one entry point only. Discovery
 * (actions.check) and execution (validateSearchOptions) both go through this, so
 * they cannot disagree about what search.files({ pattern }) accepts.
 */
export function checkEntryOptionValue(fn, name, value) {
  const problem = checkOptionValue(name, value);
  if (problem) return problem;
  const message = ENTRY_RULES[fn]?.[name]?.(value) ?? null;
  return message ? { name, code: 'EBADVAL', message } : null;
}

/**
 * Validate one option value. Returns null when acceptable, otherwise
 * { name, code, message }. Used by both execution and actions.check so the two
 * cannot disagree.
 */
export function checkOptionValue(name, value) {
  const spec = OPTS[name];
  if (!spec) return { name, code: 'EBADOPT', message: `unknown option ${JSON.stringify(name)}` };
  if (typeOf(value) !== spec.type) {
    return {
      name,
      code: 'EBADVAL',
      message: `${name} must be a ${spec.type} (got ${typeOf(value)})`,
    };
  }
  const problem = spec.validate ? spec.validate(value) : null;
  if (problem) return { name, code: spec.code ?? 'EBADVAL', message: problem };
  return null;
}

/**
 * Full option validation for one search entry point. Throws on the first
 * problem: EBADOPT for an unknown key, EBADVAL for a bad value, ENOTSUP for an
 * option that exists but cannot be honoured safely.
 */
export function validateSearchOptions(fn, opts) {
  const allowed = OPT_SETS[fn];
  if (!allowed) throw new Error(`validateSearchOptions: unknown entry point ${fn}`);
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new SearchOptionError(`${fn}: options must be an object`, 'EBADVAL');
  }

  const bad = Object.keys(opts).filter((k) => !allowed.has(k));
  if (bad.length) {
    throw new SearchOptionError(
      `${fn}: unknown option(s) ${bad.map((b) => JSON.stringify(b)).join(', ')}. `
      + `valid: ${[...allowed].join(', ')}`,
      'EBADOPT',
    );
  }

  for (const name of allowed) {
    const spec = OPTS[name];
    const present = name in opts && opts[name] !== undefined;
    if (!present) {
      if (spec.required) {
        throw new SearchOptionError(`${fn}: ${name} (non-empty string) is required`, 'EBADVAL');
      }
      continue;
    }
    const problem = checkEntryOptionValue(fn, name, opts[name]);
    if (problem) throw new SearchOptionError(`${fn}: ${problem.message}`, problem.code);
  }
  return opts;
}

/**
 * The effective ignore/hidden/exclude/path policy behind a result, so a caller
 * can tell WHY a result set looks the way it does without re-deriving defaults.
 */
export function buildScope({
  kind,
  path: target,
  query = null, ignoreCase = false, fixedStrings = false,
  wordRegexp = false, multiline = false, maxFilesize = null, timeoutMs = null,
  glob = null,
  pattern = null,
  context = null,
  max = null,
  noIgnore = false,
  hidden = false,
  followSymlinks = false,
  includeExcluded = false,
  excludeGlobs = [],
}) {
  return {
    kind,
    path: target,
    ...(query !== null ? { query, ignoreCase, fixedStrings, wordRegexp, multiline } : {}),
    ...(maxFilesize != null ? { maxFilesize } : {}),
    ...(timeoutMs != null ? { timeoutMs } : {}),
    ...(glob !== null && glob !== undefined ? { glob } : {}),
    ...(pattern !== null && pattern !== undefined ? { pattern } : {}),
    ...(context !== null && context !== undefined ? { context } : {}),
    ...(max !== null && max !== undefined ? { max } : {}),
    noIgnore,
    hidden,
    followSymlinks,
    includeExcluded,
    // The globs actually in force for this call: includeExcluded means none.
    excludeGlobs: includeExcluded ? [] : [...excludeGlobs],
  };
}

export { FOLLOW_SYMLINKS_UNSUPPORTED, OPTS };
