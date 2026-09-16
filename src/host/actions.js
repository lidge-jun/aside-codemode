// Guest global `actions` (A-D5): in-sandbox discovery over the injected globals.
//
// The three search entries are NOT restated here. They come from
// ../search-schema.js, the canonical owner of the search option contract,
// because the duplicated copies drifted: `includeExcluded` was executable but
// absent from this catalog, so actions.check() called a working option unknown
// (measured 2026-09-13). Value rules come from the same module, so `check` and a
// real call agree on what is acceptable.
import { SEARCH_ACTIONS, checkOptionValue, checkEntryOptionValue } from '../search-schema.js';
import { BROWSE_ACTIONS, REPORT_ACTIONS, API_ACTIONS, RECIPE_ACTIONS, checkBrowseArgs } from './browse/actions-schema.js';

const REGISTRY = [
  ...SEARCH_ACTIONS,
  ...BROWSE_ACTIONS,
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
    notes: 'Guest call is apply_patch(string). inputs.text is catalog-only, not an object argument. Update hunks are line-based; a substring that is not a whole line does not match. CRLF files keep CRLF.',
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
    signature: 'fs.grepFile(path, pattern, { context?, max?, ignoreCase?, normalize? }?) => Promise<{line,text,context?}[]>',
    notes: 'Array ergonomics unchanged. Non-enumerable .truncated/.complete/.partial/.scope; JSON is {rows,complete,truncated,partial,scope}. max must be a positive integer (default 100). A non-ASCII pattern also tries the NFC-folded line so a decomposed file still matches; .scope.normalize reports whether that was in force, and normalize:false turns it off. Returned text and line numbers are always the raw file.',
    inputs: {
      path: { type: 'string', required: true, description: 'File path (inside roots)' },
      pattern: { type: 'string', required: true, description: 'Regex source or literal' },
      context: { type: 'number', required: false, description: 'Lines of context to include' },
      max: { type: 'number', required: false, description: 'Max matches (default 100). Positive integer; invalid values throw. Hitting max sets .truncated after a one-match lookahead.' },
      ignoreCase: { type: 'boolean', required: false, description: 'Case-insensitive' },
      normalize: { type: 'boolean', required: false, description: 'Fold Unicode normalization when the pattern is non-ASCII (default true). Match decision only; returned bytes are untouched.' },
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
    signature: 'fs.exists(path) => Promise<boolean>',
    inputs: { path: { type: 'string', required: true, description: 'Path to test' } },
  },
  {
    path: 'fs.list',
    description: 'List directory entries with type and size; optionally recursive to a depth.',
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
  return typeof v;
}

export function createActions() {
  const namespaceExamples = {
    fs: ['fs.read(path)', 'fs.read'],
    search: ['search.content({ path, query })', 'search.content'],
    browse: ['browse.exec({})', 'browse.exec'],
    api: ['api.batch([])', 'api.batch'],
    report: ['report.build({})', 'report.build'],
    recipes: ['recipes.list()', 'recipes.list'],
  };
  const dispatcherGuesses = new Set(['call', 'run', 'invoke', 'exec', 'describeAll', 'get']);
  const decorateList = (rows) => {
    const rejectPromiseStyle = () => {
      throw new Error('actions.list() is synchronous; drop the await/.catch and use the returned array directly');
    };
    Object.defineProperties(rows, {
      catch: { value: rejectPromiseStyle },
      finally: { value: rejectPromiseStyle },
    });
    return rows;
  };
  const api = Object.freeze({
    list(filter) {
      const rows = REGISTRY.filter((r) => !filter || r.path.startsWith(filter));
      return decorateList(rows.map((r) => ({ path: r.path, description: r.description })));
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
      // browse catalogues several options as unions ('boolean|string'). A plain !== check
      // reads that as one literal type and refuses true for an option the runtime accepts.
      const accepts = (want, got) => String(want).split('|').map((s) => s.trim()).includes(got);
      for (const [name, spec] of Object.entries(rec.inputs)) {
        if (spec.required && !(name in args)) missing.push(name);
        else if (name in args && !accepts(spec.type, typeOf(args[name]))) {
          typeErrors.push({ name, want: spec.type, got: typeOf(args[name]) });
        } else if (name in args && (isSearch || rec.path === 'fs.grepFile')) {
          // fs.grepFile deliberately keeps the plain check. Its `pattern` is a
          // REGEX, where 'a*' is a quantifier, while search.files' `pattern` is a
          // substring filter that refuses glob metacharacters. Routing both
          // through the entry-scoped checker would make discovery report a valid
          // grepFile regex as invalid while the real call kept running it.
          const problem = isSearch
            ? checkEntryOptionValue(rec.path, name, args[name])
            : checkOptionValue(name, args[name]);
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
  return new Proxy(api, {
    get(target, property, receiver) {
      if (typeof property !== 'string' || Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      const example = namespaceExamples[property];
      if (example) {
        throw new Error(`actions is discovery only; call ${example[0]} directly in the guest and use actions.describe('${example[1]}') to look it up`);
      }
      if (dispatcherGuesses.has(property)) {
        throw new Error("actions is discovery only; call fs.read(path) directly in the guest and use actions.describe('fs.read') to look it up");
      }
      return undefined;
    },
  });
}
