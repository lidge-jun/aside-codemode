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
import { parseApplyPatch } from './patch.js';

// The guest manifest exposes these same functions twice: once as globals and once through
// the fs object. They remain one catalog row because listing aliases as separate actions
// would make one implementation look like six independent capabilities.
const ACTION_ALIASES = new Map([
  ['fs.read_file', 'read_file'],
  ['fs.write_file', 'write_file'],
  ['fs.edit_file', 'edit_file'],
]);

const ALIASES_BY_ACTION = new Map();
for (const [alias, canonical] of ACTION_ALIASES) {
  const aliases = ALIASES_BY_ACTION.get(canonical) || [];
  aliases.push(alias);
  ALIASES_BY_ACTION.set(canonical, aliases);
}

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
      signature: 'browse.readText(urlString) OR browse.readText({ url, timeoutMs?, minChars?, fresh?, locale? }) => Promise<{ok,source,text,format,chars,complete,contentShape?,lostTo?,blockKind,fallbackReason}>',
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
      offset: { type: 'number', required: false, description: '1-indexed positive safe-integer start line' },
      limit: { type: 'number', required: false, description: 'Positive safe-integer maximum lines to return' },
    },
  },
  {
    path: 'write_file',
    description: 'Create a new file (Aside write_file). Fails if the file already exists.',
    signature: 'write_file({ file_path, content }) => Promise<{wrote,bytes}>',
    inputs: {
      file_path: { type: 'string', required: true, description: 'Non-empty target path (create-only)' },
      content: { type: 'string', required: true, description: 'File contents' },
    },
  },
  {
    path: 'edit_file',
    description: 'Unique oldText→newText replacements on the original file, optional appendText.',
    signature: 'edit_file({ path, appendText?, edits:[{oldText,newText}] }) => Promise<{path,replacements,appended,diff}>',
    inputs: {
      path: { type: 'string', required: true, description: 'Non-empty path of the file to edit' },
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
      maxBytes: { type: 'number', required: false, description: 'Read cap (default 256 KiB). Positive values must be safe integers; Infinity reads all bytes; non-positive values clamp to zero.' },
      offset: { type: 'number', required: false, description: 'Non-negative safe-integer start byte offset' },
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
    signature: 'fs.list(path, { max?, recursive?, depth? }?) => Promise<{name,type,size}[] + non-enumerable {complete,truncated,partial,scope}; JSON form {rows,complete,truncated,partial,scope}>',
    inputs: {
      path: { type: 'string', required: true, description: 'Directory path (inside roots)' },
      max: { type: 'number', required: false, description: 'Entry cap (default 1000)' },
      recursive: { type: 'boolean', required: false, description: 'Walk subdirectories (default false)' },
      depth: { type: 'number', required: false, description: 'Max depth when recursive (default 3)' },
    },
  },
];

function score(candidate, tokens) {
  const aliases = ALIASES_BY_ACTION.get(candidate.path) || [];
  const hay = (candidate.path + ' ' + aliases.join(' ') + ' ' + candidate.description).toLowerCase();
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
  if (utilTypes.isDate(v)) return 'date';
  if (utilTypes.isRegExp(v)) return 'regexp';
  return typeof v;
}

function problem(name, why) {
  return { name, why };
}

// These are only the argument-only refusals measured at the call boundary. File existence,
// uniqueness and root checks need I/O, so discovery does not guess about them.
function checkFileArgs(path, args) {
  if (path === 'read_file') {
    if (args.path.length === 0) return [problem('path', 'read_file: path (non-empty string) is required')];
    for (const name of ['offset', 'limit']) {
      if (!(name in args)) continue;
      const value = args[name];
      if (!Number.isInteger(value) || value < 1) {
        return [problem(name, 'read_file: offset/limit must be a positive integer')];
      }
      if (!Number.isSafeInteger(value)) {
        return [problem(name, 'readLines: offset/limit must be a positive integer')];
      }
    }
    return [];
  }

  if (path === 'write_file') {
    return args.file_path.length === 0
      ? [problem('file_path', 'write_file: file_path (non-empty string) is required')]
      : [];
  }

  if (path === 'edit_file') {
    if (args.path.length === 0) return [problem('path', 'edit_file: path (non-empty string) is required')];
    const edits = args.edits ?? [];
    if (edits.length === 0 && (typeof args.appendText !== 'string' || args.appendText.length === 0)) {
      return [problem('edits', 'edit_file: empty edits only allowed with appendText')];
    }
    for (const edit of edits) {
      if (!edit || typeof edit.oldText !== 'string' || typeof edit.newText !== 'string') {
        return [problem('edits', 'edit_file: each edit needs oldText and newText strings')];
      }
      if (edit.oldText === '') {
        return [problem('edits', 'edit_file: oldText must not be empty (use appendText to add text without an anchor)')];
      }
    }
    return [];
  }

  if (path === 'apply_patch') {
    if (!args.text.trim()) return [problem('text', 'apply_patch: freeform string required')];
    try {
      const hunks = parseApplyPatch(args.text);
      const emptyPath = hunks.find((hunk) => !hunk.path);
      if (emptyPath) {
        const why = emptyPath.type === 'add'
          ? 'write_file: file_path (non-empty string) is required'
          : 'edit_file: path (non-empty string) is required';
        return [problem('text', why)];
      }
      return [];
    } catch (error) {
      return [problem('text', String(error && error.message || error))];
    }
  }

  // Every path the guest hands in goes through the root guard, and the guard refuses an empty
  // one before it resolves anything: "path (non-empty string) is required". Discovery typed
  // these as strings and said yes to "", which is the one string a caller gets by passing a
  // variable that was never set - the case where being told early matters most.
  // search.* owns this rule already, through the option contract in search-schema.js, and
  // reporting it twice would make one mistake look like two.
  const PATH_INPUTS = path.startsWith('search.') ? [] : ['path', 'file_path', 'outFile'];
  for (const name of PATH_INPUTS) {
    if (name in args && typeof args[name] === 'string' && args[name].length === 0) {
      return [problem(name, name + ' (non-empty string) is required')];
    }
  }

  if (path === 'fs.read') {
    if ('offset' in args && (!Number.isSafeInteger(args.offset) || args.offset < 0)) {
      return [problem('offset', 'offset must be a non-negative integer')];
    }
    if ('maxBytes' in args) {
      const value = args.maxBytes;
      // fs.read clamps every non-positive number before readBounded validates it. Keeping
      // that measured coercion here avoids advertising a stricter API than the call has.
      const accepted = value === Infinity || value <= 0 || Number.isSafeInteger(value);
      if (!accepted) return [problem('maxBytes', 'maxBytes must be a non-negative integer')];
    }
  }
  return [];
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
      const canonicalPath = ACTION_ALIASES.get(path) || path;
      const rec = REGISTRY.find((r) => r.path === canonicalPath);
      if (!rec) {
        const cands = didYouMean(String(path));
        throw new Error(`unknown action: ${path}` + (cands.length ? `. did you mean: ${cands.join(', ')}?` : ''));
      }
      return rec;
    },
    check(path, args = {}) {
      const canonicalPath = ACTION_ALIASES.get(path) || path;
      const rec = REGISTRY.find((r) => r.path === canonicalPath);
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
        invalid.push(...checkFileArgs(rec.path, args));
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
