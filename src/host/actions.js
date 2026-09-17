// Guest global `actions` (A-D5): in-sandbox discovery over the injected globals.
//
// The three search entries are NOT restated here. They come from
// ../search-schema.js, the canonical owner of the search option contract,
// because the duplicated copies drifted: `includeExcluded` was executable but
// absent from this catalog, so actions.check() called a working option unknown
// (measured 2026-09-13). Value rules come from the same module, so `check` and a
// real call agree on what is acceptable.
import { types as utilTypes } from 'node:util';
import { SEARCH_ACTIONS, checkGrepFileOptionValue, checkEntryOptionValue } from '../search-schema.js';
import {
  BROWSE_ACTIONS,
  REPORT_ACTIONS,
  API_ACTIONS,
  RECIPE_ACTIONS,
  RUNTIME_VALIDATED_PATHS,
  checkBrowseArgs,
} from './browse/actions-schema.js';
import { validateRecipeRun } from './browse/watch.js';

const REGISTRY = [
  ...SEARCH_ACTIONS.map((entry) => {
    if (entry.path !== 'search.content') return entry;
    return {
      ...entry,
      notes: entry.notes + ' Array ergonomics are unchanged; JSON serialization emits {rows,complete,truncated,partial,scope}. scope.skippedSymlinks is {dirs,files,examples,capped}; a skipped directory makes complete:false because an unseen subtree may be behind it. Returned file paths are the bytes on disk, so hand-filter names by comparing both sides with .normalize("NFC"); otherwise decomposed (NFD) macOS names can be missed.',
    };
  }),
  ...BROWSE_ACTIONS.map((entry) => {
    if (entry.path !== 'browse.readText') return entry;
    return {
      ...entry,
      signature: 'browse.readText(urlString) OR browse.readText({ url, timeoutMs?, minChars?, fresh?, locale? }) => Promise<{ok,source,text,format,chars,blockKind,fallbackReason}>',
      notes: entry.notes + " Direct calls accept either a URL string or one options object containing url. actions.check validates the catalog-shaped object, so check with actions.check('browse.readText', { url, ...options }).",
    };
  }),
  ...REPORT_ACTIONS,
  ...API_ACTIONS,
  ...RECIPE_ACTIONS,
  {
    path: 'read_file',
    description: 'Read a file using the Aside read_file shape. offset/limit are 1-indexed lines.',
    signature: 'read_file({ path, offset?, limit? }) => Promise<string>',
    inputs: {
      path: { type: 'string', required: true, description: 'File path (inside roots; relative to --cwd)' },
      offset: { type: 'number', required: false, description: '1-indexed start line' },
      limit: { type: 'number', required: false, description: 'Max lines to return' },
    },
  },
  {
    path: 'write_file',
    description: 'Create a new file (Aside write_file). Fails if the file already exists.',
    signature: 'write_file({ file_path, content }) => Promise<{wrote,bytes}>',
    inputs: {
      file_path: { type: 'string', required: true, description: 'Target path (create-only)' },
      content: { type: 'string', required: true, description: 'File contents' },
    },
  },
  {
    path: 'edit_file',
    description: 'Unique oldText→newText replacements on the original file, optional appendText.',
    signature: 'edit_file({ path, appendText?, edits:[{oldText,newText}] }) => Promise<{path,replacements,appended,diff}>',
    inputs: {
      path: { type: 'string', required: true, description: 'File to edit' },
      appendText: { type: 'string', required: false, description: 'Appended after edits' },
      edits: { type: 'array', required: false, description: 'Replacements against the original text' },
    },
  },
  {
    path: 'apply_patch',
    description: 'Apply a Codex-shaped freeform patch string. Add/Update only. Success {}. No rollback.',
    notes: "actions.check validates CATALOG-shaped argument objects, which can differ from direct positional calls: check with actions.check('apply_patch', { text }), but call apply_patch(text). Update hunks are line-based; a substring that is not a whole line does not match. CRLF files keep CRLF.",
    signature: 'apply_patch(text) => Promise<{}>',
    inputs: {
      text: { type: 'string', required: true, description: 'Freeform *** Begin Patch … *** End Patch string' },
    },
  },
  {
    path: 'fs.read',
    description: 'Deprecated byte-offset read. Prefer read_file (line offset).',
    notes: 'deprecated; use read_file (line offset)',
    signature: 'fs.read(path, { maxBytes?, offset? }?) => Promise<string>',
    inputs: {
      path: { type: 'string', required: true, description: 'File path (inside roots)' },
      maxBytes: { type: 'number', required: false, description: 'Read cap (default 256 KiB)' },
      offset: { type: 'number', required: false, description: 'Start byte offset' },
    },
  },
  {
    path: 'fs.readMany',
    description: 'Read several files in one call under a shared byte budget. Per-file failures are returned inline, never thrown.',
    signature: 'fs.readMany(paths[], { maxBytes?, totalBytes? }?) => Promise<{path,text?,error?,skipped?}[]>',
    inputs: {
      paths: { type: 'array', required: true, description: 'File paths to read' },
      maxBytes: { type: 'number', required: false, description: 'Per-file cap (default 32 KiB)' },
      totalBytes: { type: 'number', required: false, description: 'Budget across all files (default 512 KiB)' },
    },
  },
  {
    path: 'fs.grepFile',
    description: 'Return only matching lines (with optional context) from ONE file. Use instead of fs.read on a large file.',
    signature: 'fs.grepFile(path, pattern, { context?, max?, ignoreCase?, normalize?, maxLineBytes? }?) => Promise<{line,text,context?}[]>',
    notes: 'Array ergonomics unchanged. Non-enumerable .truncated/.complete/.partial/.scope; JSON is {rows,complete,truncated,partial,scope}. max must be a positive integer (default 100). A non-ASCII pattern also tries the NFC-folded line so a decomposed file still matches; .scope.normalize reports whether that was in force, and normalize:false turns it off. Returned text and line numbers are always the raw file. An empty pattern matches every line. maxLineBytes:null is not omission: the runtime coerces it to a zero-byte cap.',
    inputs: {
      path: { type: 'string', required: true, description: 'File path (inside roots)' },
      pattern: { type: 'string|regexp', required: true, description: 'Regex source or a RegExp, including one created in another realm. An empty source matches every line.' },
      context: { type: 'number', required: false, description: 'Lines of context to include' },
      max: { type: 'number', required: false, description: 'Max matches (default 100). Positive integer; invalid values throw. Hitting max sets .truncated after a one-match lookahead.' },
      ignoreCase: { type: 'boolean', required: false, description: 'Case-insensitive' },
      normalize: { type: 'boolean', required: false, description: 'Fold Unicode normalization when the pattern is non-ASCII (default true). Match decision only; returned bytes are untouched.' },
      maxLineBytes: { type: 'number|null', required: false, description: 'Returned-line byte cap (default 256 KiB). Infinity preserves the full line; null is a measured zero-byte cap, not the default.' },
    },
  },
  {
    path: 'fs.write',
    description: 'Deprecated overwrite write. Prefer write_file (create-only).',
    notes: 'deprecated; use write_file (create-only)',
    signature: 'fs.write(path, content) => Promise<{wrote,bytes}>',
    inputs: {
      path: { type: 'string', required: true, description: 'Target file path (inside roots)' },
      content: { type: 'string', required: true, description: 'File contents' },
    },
  },
  {
    path: 'fs.mkdir',
    description: 'Create a directory (recursive) inside roots.',
    signature: 'fs.mkdir(path) => Promise<{created}>',
    inputs: { path: { type: 'string', required: true, description: 'Directory path (inside roots)' } },
  },
  {
    path: 'fs.stat',
    description: 'Type, size and mtime for one path.',
    signature: 'fs.stat(path) => Promise<{path,type,size,mtimeMs}>',
    inputs: { path: { type: 'string', required: true, description: 'Path (inside roots)' } },
  },
  {
    path: 'fs.exists',
    description: 'True when the path exists AND is inside roots. Never throws.',
    signature: 'fs.exists(path?) => Promise<boolean>',
    inputs: { path: { type: 'string', required: false, description: 'Path to test. Omission returns false.' } },
  },
  {
    path: 'fs.list',
    description: 'List directory entries with type and size; optionally recursive to a depth.',
    notes: 'Returned names are the bytes on disk. When hand-filtering them, compare both sides with .normalize("NFC"); otherwise decomposed (NFD) macOS filenames can be missed even though they render identically.',
    signature: 'fs.list(path, { max?, recursive?, depth? }?) => Promise<{name,type,size}[]>',
    inputs: {
      path: { type: 'string', required: true, description: 'Directory path (inside roots)' },
      max: { type: 'number', required: false, description: 'Entry cap (default 1000)' },
      recursive: { type: 'boolean', required: false, description: 'Walk subdirectories (default false)' },
      depth: { type: 'number', required: false, description: 'Max depth when recursive (default 3)' },
    },
  },
];

function score(candidate, tokens) {
  const hay = (candidate.path + ' ' + candidate.description).toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (hay.includes(t)) s += t.length;
  }
  return s;
}

function didYouMean(path) {
  const tokens = path.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return REGISTRY.map((r) => [score(r, tokens), r.path])
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map(([, p]) => p);
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (utilTypes.isRegExp(v)) return 'regexp';
  return typeof v;
}

/**
 * `recipes` is the host instance's recipe registry, and it is an argument because it is
 * instance state: a checker that guessed from an empty or global list would report a
 * configured recipe as unknown. Without it, recipes.run is not value-checked at all, which
 * is the honest answer for a caller that has no registry to check against.
 */
export function createActions({ recipes = null } = {}) {
  // Wrong-name guidance is not here: the worker rebuilds these methods from a manifest, so
  // only something attached guest-side reaches the script. See src/guest-guidance.js.
  return Object.freeze({
    list(filter) {
      const rows = REGISTRY.filter((r) => !filter || r.path.startsWith(filter));
      return rows.map((r) => ({ path: r.path, description: r.description }));
    },
    find(query) {
      const tokens = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return REGISTRY.map((r) => [score(r, tokens), r])
        .filter(([s]) => s > 0)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 10)
        .map(([, r]) => ({ path: r.path, description: r.description, signature: r.signature }));
    },
    describe(path) {
      if (path === undefined) {
        throw new Error("actions.describe takes an exact action path, for example actions.describe('fs.read'); use actions.list() or actions.find(query) to get paths");
      }
      const rec = REGISTRY.find((r) => r.path === path);
      if (!rec) {
        const cands = didYouMean(String(path));
        throw new Error(`unknown action: ${path}` + (cands.length ? `. did you mean: ${cands.join(', ')}?` : ''));
      }
      return rec;
    },
    check(path, args = {}) {
      const rec = REGISTRY.find((r) => r.path === path);
      if (!rec) {
        const cands = didYouMean(String(path));
        throw new Error(`unknown action: ${path}` + (cands.length ? `. did you mean: ${cands.join(', ')}?` : ''));
      }
      const missing = [];
      const unknown = [];
      const typeErrors = [];
      // Value-level problems an execution call would also refuse: max:0,
      // context:-1, followSymlinks:true (ENOTSUP). Reported separately from
      // typeErrors so the existing shape is unchanged for type mismatches.
      const invalid = [];
      const isSearch = rec.path.startsWith('search.');
      const hasRuntimePreflight = RUNTIME_VALIDATED_PATHS.includes(rec.path);
      // browse catalogues several options as unions ('boolean|string'). A plain !== check
      // reads that as one literal type and refuses true for an option the runtime accepts.
      const accepts = (want, got) => String(want).split('|').map((s) => s.trim()).includes(got);
      for (const [name, spec] of Object.entries(rec.inputs)) {
        // Optional null is judged by the runtime pre-flight when one exists. Some validators
        // normalize it as omission (snapshot, report paper); others give it meaning or refuse
        // it (browse pdf). Skipping only the generic type opinion lets that owning family
        // answer without turning null into a catalog-wide allowance. Families without a
        // pre-flight keep their declared type rule, including search.*.
        const runtimeOwnsNull = args[name] === null && !spec.required && hasRuntimePreflight;
        if (spec.required && !(name in args)) missing.push(name);
        else if (name in args && !runtimeOwnsNull && !accepts(spec.type, typeOf(args[name]))) {
          typeErrors.push({ name, want: spec.type, got: typeOf(args[name]) });
        } else if (name in args && (isSearch || rec.path === 'fs.grepFile')) {
          // fs.grepFile deliberately keeps its own checker. Its `pattern` is a
          // REGEX, where 'a*' is a quantifier, while search.files' `pattern` is a
          // substring filter that refuses glob metacharacters. Routing both
          // through the search entry checker would make discovery report a valid
          // grepFile regex as invalid while the real call kept running it.
          const problem = isSearch
            ? checkEntryOptionValue(rec.path, name, args[name])
            : checkGrepFileOptionValue(name, args[name]);
          if (problem) invalid.push(problem);
        }
      }
      for (const name of Object.keys(args)) {
        if (!(name in rec.inputs)) unknown.push(name);
      }
      // The runtime validator IS the answer for browse, and it only answers about a whole
      // call. Asking it about arguments already reported as missing, unknown or mistyped
      // would return that same problem a second time in different words.
      if (missing.length === 0 && unknown.length === 0 && typeErrors.length === 0) {
        invalid.push(...checkBrowseArgs(rec.path, args));
        // The one rule that cannot live in the path table with the others, because it needs
        // this host's registry rather than only the arguments.
        if (rec.path === 'recipes.run' && recipes) {
          try {
            validateRecipeRun(args.name, recipes);
          } catch (e) {
            if (e && ['EBADVAL', 'ENOTSUP', 'EBADOPT', 'EINVAL'].includes(e.code)) {
              invalid.push({ name: 'name', why: String(e.message).slice(0, 200), code: e.code });
            }
          }
        }
      }
      return {
        ok: missing.length === 0 && unknown.length === 0 && typeErrors.length === 0 && invalid.length === 0,
        missing,
        unknown,
        typeErrors,
        invalid,
        signature: rec.signature,
      };
    },
  });
}
