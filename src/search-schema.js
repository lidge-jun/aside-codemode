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
    description: "ripgrep -g glob, e.g. '**/*.ts'. A non-ASCII glob is searched in both NFC and NFD forms and the paths are unioned. Inclusive globs can match some gitignored/hidden files even when noIgnore/hidden are false (ripgrep glob precedence, not a root escape, and not -uuu).",
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
  binary: {
    type: 'boolean',
    required: false,
    description: 'Search binary files too (rg --text). DEFAULT false, because ripgrep skips binary content SILENTLY: a string inside a compiled file is invisible to search.content while search.files still lists the file. Set true when you need to prove a string is absent; scope.coverage.binaryContent stays "unknown" until you do.',
  },
  followSymlinks: {
    type: 'boolean',
    required: false,
    description: 'Only false is supported. true is rejected with ENOTSUP because a followed symlink can read outside the configured roots.',
    validate: (v) => (v === true ? FOLLOW_SYMLINKS_UNSUPPORTED : null),
    code: 'ENOTSUP',
  },
};

const DISCOVERY_ORDER = ['noIgnore', 'hidden', 'followSymlinks', 'includeExcluded', 'binary', 'maxFilesize', 'timeoutMs'];

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
    description: 'First call for any directory or project filename search. Returns file paths and streams to the `max` cap, so a large tree is safe.',
    signature: 'search.files({ path, pattern?, glob?, max?, noIgnore?, hidden?, followSymlinks?, includeExcluded?, binary?, maxFilesize?, timeoutMs? }) => Promise<string[]>',
    notes: "Returns an array usable with .length/.map/.filter. Non-enumerable `.truncated`, `.partial`, `.complete` and `.scope` describe the search itself; JSON serialization emits {rows,complete,truncated,partial,scope}. Returning only .length or a .map() projection deliberately drops that state — it is not a claim that the search was complete. `pattern` is a substring filter and `glob` is the glob: pattern:'*.pdf' is rejected with the glob you probably meant, instead of returning zero rows. Non-ASCII patterns and globs search both NFC and NFD and union paths without changing the bytes returned. `.scope.normalization` reports the forms searched and whether both finished completely. Inclusive glob can match some gitignored/hidden files even when noIgnore/hidden are false (ripgrep -g precedence, not -uuu). A skipped FILE symlink is counted in scope.skippedSymlinks but does not lower completeness; only a skipped directory does.",
    inputs: inputsFor(FILES_ORDER),
  },
  {
    path: 'search.content',
    description: 'First call for any directory or project content search. Searches file contents and returns matching lines with file, line number and optional context.',
    signature: 'search.content({ query, path, glob?, context?, max?, ignoreCase?, fixedStrings?, wordRegexp?, multiline?, noIgnore?, hidden?, followSymlinks?, includeExcluded?, binary?, maxFilesize?, timeoutMs? }) => Promise<{file,line,text,context?}[]>',
    notes: '`max` is a GLOBAL cap on returned rows (not ripgrep --max-count, which is per-file). `context` lines are attached as {before,after} on the hit and never consume the max budget. Non-ASCII queries and globs search both NFC and NFD and union hits by path/line/content; `.scope.normalization` reports whether both forms finished completely. Unknown options and invalid values are rejected rather than ignored. Inclusive glob can match some gitignored/hidden files even when noIgnore/hidden are false (ripgrep -g precedence, not -uuu).',
    inputs: inputsFor(CONTENT_ORDER),
  },
  {
    path: 'search.count',
    description: 'First call to size any directory or project content search. Returns match and matching-file counts without returning rows.',
    signature: 'search.count({ query, path, glob?, ignoreCase?, fixedStrings?, noIgnore?, hidden?, followSymlinks?, includeExcluded?, binary?, maxFilesize?, timeoutMs? }) => Promise<{matches,files}>',
    notes: 'Stays a plain {matches,files} object; `.complete`, `.truncated`, `.partial` and `.scope` are non-enumerable, and JSON serialization emits them alongside the counts. An unreadable path makes the count partial instead of silently smaller. Non-ASCII queries and globs search both NFC and NFD. Because each run returns only scalar totals, the result uses the component-wise maximum as a lower bound instead of adding possibly overlapping counts; `.scope.normalization.countAccuracy` is `lower-bound`, and both the result and `.scope.normalization` remain incomplete because an exact union cannot be proved.',
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
 * fs.grepFile shares numeric option rules with search, but its pattern is a JavaScript
 * RegExp source rather than search.files' non-empty path substring. Keeping that distinction
 * here prevents the discovery checker from refusing an empty or cross-realm RegExp that the
 * file scanner deliberately accepts.
 */
export function checkGrepFileOptionValue(name, value) {
  if (name === 'pattern') {
    if (typeof value !== 'string') return null;
    try {
      new RegExp(value);
      return null;
    } catch (error) {
      return {
        name,
        code: 'EBADVAL',
        message: `pattern must be a valid regular expression source (${String(error && error.message || error)})`,
      };
    }
  }
  // The runtime applies maxLineBytes while bounding each returned line. It accepts every
  // catalogued number plus null, whose measured coercion is a zero-byte cap.
  if (name === 'maxLineBytes') return null;
  return checkOptionValue(name, value);
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
// An agent that reaches for the wrong name is usually one word away from the right call, and
// the old message listed valid options without saying which of them replaced what it tried.
// These two are the pair that actually got confused in use: content/count match text with
// query, files filters paths with pattern.
const MISDIRECTED = {
  pattern: { belongsTo: 'search.files', insteadUse: 'query', appliesTo: ['search.content', 'search.count'] },
  query: { belongsTo: 'search.content or search.count', insteadUse: 'pattern (a path substring) or glob', appliesTo: ['search.files'] },
};

const PATH_HINT = '. Give a directory or file inside a configured root; an absolute path has '
  + 'to be inside one too, and a relative path resolves against --cwd.';

// A value that looks like a glob is a different mistake from a misplaced option name, and
// sending it to `query` would turn a path filter into a content regex.
const looksLikeGlob = (v) => typeof v === 'string' && /[*?\[\]]/.test(v);

function misdirectedOptionHint(fn, bad, opts) {
  const hints = [];
  for (const name of bad) {
    const rule = MISDIRECTED[name];
    if (!rule || !rule.appliesTo.includes(fn)) continue;
    const use = name === 'pattern' && looksLikeGlob(opts[name])
      ? `glob (that value looks like a glob), or query to match content`
      : rule.insteadUse;
    hints.push(`In ${fn}, use ${use}; ${JSON.stringify(name)} belongs to ${rule.belongsTo}.`);
  }
  return hints.length ? '. ' + hints.join(' ') : '';
}

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
      + `valid: ${[...allowed].join(', ')}`
      + misdirectedOptionHint(fn, bad, opts),
      'EBADOPT',
    );
  }

  for (const name of allowed) {
    const spec = OPTS[name];
    const present = name in opts && opts[name] !== undefined;
    if (!present) {
      if (spec.required) {
        throw new SearchOptionError(
          `${fn}: ${name} (non-empty string) is required`
          + (name === 'path' ? PATH_HINT : ''),
          'EBADVAL',
        );
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
// Which pruning mechanisms could have hidden a match on this call.
//
// Two earlier designs tried to answer absence with a single boolean and both were wrong. The
// first counted ignore files between the target and the root, which misses the .gitignore in
// a DESCENDANT directory and global excludes entirely. The second read the policy flags,
// which misses ripgrep's silent binary suppression and a symlink census that stops at depth
// three. A closed enumeration of the pipeline found mechanisms nobody can observe at all —
// input encoding is the clearest — so a boolean claiming "nothing could hide" would always
// have had unknowable terms. This records what is known instead of guessing.
//
// Selector options (glob, pattern, query, depth) define the request and are not listed: a
// caller who asked for *.js did not lose the files they excluded.
function symlinkCoverage(s) {
  if (!s) return 'unknown';
  if (s.dirs > 0 || s.files > 0) return 'on';
  // A census that stopped early cannot prove there was nothing further to find. This does
  // NOT lower `complete`, on purpose: symlink-scan.js explains why marking every large tree
  // incomplete would make that field useless. Provable coverage is a different question.
  if (s.capped || s.depthCapped) return 'unknown';
  return 'off';
}

export function buildCoverage({
  noIgnore = false, hidden = false, includeExcluded = false, excludeGlobs = [],
  maxFilesize = null, binary = false, skippedSymlinks = null, unparsableRecords = 0,
} = {}) {
  return {
    ignoreRules: noIgnore ? 'off' : 'on',
    hiddenFiles: hidden ? 'off' : 'on',
    // An empty configured list cannot exclude anything, so this reads the ARRAY and not just
    // the flag. Otherwise every call reports 'on' and the entry stops being information.
    excludeGlobs: (includeExcluded || !Array.isArray(excludeGlobs) || excludeGlobs.length === 0) ? 'off' : 'on',
    fileSize: maxFilesize == null ? 'off' : 'on',
    // Suppression is not observable when binary is false: ripgrep returns a silent zero, so
    // there is nothing to count. Measured on this repository's own bin/rg.exe: a fully open
    // search.content for a string inside it returns 0 rows with complete:true, while
    // search.files still lists the file.
    binaryContent: binary ? 'off' : 'unknown',
    symlinks: symlinkCoverage(skippedSymlinks),
    recordParse: unparsableRecords > 0 ? 'on' : 'off',
    // No --encoding is passed and the line reader decodes UTF-8 only, so text in an
    // unsupported legacy encoding is never matched and nothing observes that. Permanently
    // unknown, which is why an all-'off' record is currently unreachable. Saying so is the
    // point: the previous designs claimed a satisfiability they did not have.
    encoding: 'unknown',
    // Conservative default. Only the host aggregation layer knows whether NFC/NFD expansion
    // actually ran, and all three search entry points return DIRECTLY when it does not, so a
    // default of 'unknown' keeps a new code path honest without touching every call site.
    unicodeForms: 'unknown',
  };
}

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
  binary = false,
  excludeGlobs = [],
  skippedSymlinks = null,
  unparsableRecords = 0,
}) {
  const coverage = buildCoverage({
    noIgnore, hidden, includeExcluded, excludeGlobs, maxFilesize, binary, skippedSymlinks, unparsableRecords,
  });
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
    binary,
    // Which pruning mechanisms could have hidden a match on THIS call. 'off' means the
    // mechanism cannot have hidden anything, 'on' means it was active, 'unknown' means the
    // code cannot tell. An absence claim needs complete:true AND every entry 'off' — see
    // structure/result-completeness.md. Issue #41 was complete:true over a walk that had
    // been pruned, which is a different question than "did the walk lose anything".
    coverage,
    // The globs actually in force for this call: includeExcluded means none.
    excludeGlobs: includeExcluded ? [] : [...excludeGlobs],
    // What a non-following search stepped over. Reported even when it is zero, so a caller
    // can tell "nothing was skipped" from "nobody looked" (issue #24).
    ...(skippedSymlinks ? { skippedSymlinks } : {}),
  };
}

export { FOLLOW_SYMLINKS_UNSUPPORTED, OPTS };
