// Guest global `actions` (A-D5): in-sandbox discovery over the injected globals.
const DISCOVERY_OPTS = {
  noIgnore: { type: 'boolean', required: false, description: 'Ignore .gitignore/.ignore rules. DEFAULT false — a parent .gitignore can silently hide an entire repo from results. Set true when a known file is missing from a search.' },
  hidden: { type: 'boolean', required: false, description: 'Include dotfiles and dot-directories (default false)' },
  followSymlinks: { type: 'boolean', required: false, description: 'Follow symlinks while walking (default false)' },
  maxFilesize: { type: 'string', required: false, description: "Skip files larger than this, e.g. '1M'" },
  timeoutMs: { type: 'number', required: false, description: 'Kill the search after this long' },
};

const REGISTRY = [
  {
    path: 'search.files',
    description: 'List file paths under a directory (ripgrep --files). Streams and stops at `max`, so a large tree is safe.',
    signature: 'search.files({ path, pattern?, glob?, max?, noIgnore?, hidden?, followSymlinks?, maxFilesize?, timeoutMs? }) => Promise<string[]>',
    notes: 'Returns a plain array; a non-enumerable `.truncated` flag is true when `max` cut the result short.',
    inputs: {
      path: { type: 'string', required: true, description: 'Directory to list (must be inside configured roots)' },
      pattern: { type: 'string', required: false, description: 'Case-sensitive substring filter on returned paths' },
      glob: { type: 'string', required: false, description: "ripgrep -g glob, e.g. '**/*.ts'" },
      max: { type: 'number', required: false, description: 'Hard cap on returned paths; rg is killed once reached' },
      ...DISCOVERY_OPTS,
    },
  },
  {
    path: 'search.content',
    description: 'Search file contents with ripgrep. Returns matching lines with file and line number.',
    signature: 'search.content({ query, path, glob?, context?, max?, ignoreCase?, fixedStrings?, wordRegexp?, multiline?, noIgnore?, hidden?, followSymlinks?, maxFilesize?, timeoutMs? }) => Promise<{file,line,text}[]>',
    notes: '`max` is a GLOBAL cap on returned rows (not ripgrep --max-count, which is per-file). `.truncated` is set when it bites. Unknown options are rejected rather than ignored.',
    inputs: {
      query: { type: 'string', required: true, description: 'ripgrep regex; set fixedStrings for a literal' },
      path: { type: 'string', required: true, description: 'Directory or file to search (inside roots)' },
      glob: { type: 'string', required: false, description: 'ripgrep -g glob' },
      context: { type: 'number', required: false, description: 'Context lines around each match' },
      max: { type: 'number', required: false, description: 'Global cap on total returned rows' },
      ignoreCase: { type: 'boolean', required: false, description: 'Case-insensitive search' },
      fixedStrings: { type: 'boolean', required: false, description: 'Treat query as a literal string (-F)' },
      wordRegexp: { type: 'boolean', required: false, description: 'Match whole words only (-w)' },
      multiline: { type: 'boolean', required: false, description: 'Allow matches to span lines (-U)' },
      ...DISCOVERY_OPTS,
    },
  },
  {
    path: 'search.count',
    description: 'Count matches and matching files WITHOUT returning rows. Use as a pre-flight to size a search before pulling results.',
    signature: 'search.count({ query, path, glob?, ignoreCase?, fixedStrings?, noIgnore?, hidden?, followSymlinks?, maxFilesize?, timeoutMs? }) => Promise<{matches,files}>',
    notes: 'Cheap way to detect that a default (ignore-respecting) search is hiding results: compare against the same call with noIgnore:true.',
    inputs: {
      query: { type: 'string', required: true, description: 'ripgrep regex' },
      path: { type: 'string', required: true, description: 'Directory or file (inside roots)' },
      glob: { type: 'string', required: false, description: 'ripgrep -g glob' },
      ignoreCase: { type: 'boolean', required: false, description: 'Case-insensitive search' },
      fixedStrings: { type: 'boolean', required: false, description: 'Literal string match (-F)' },
      ...DISCOVERY_OPTS,
    },
  },
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
    notes: 'Guest call is apply_patch(string). inputs.text is catalog-only, not an object argument.',
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
    signature: 'fs.grepFile(path, pattern, { context?, max?, ignoreCase? }?) => Promise<{line,text,context?}[]>',
    inputs: {
      path: { type: 'string', required: true, description: 'File path (inside roots)' },
      pattern: { type: 'string', required: true, description: 'Regex source or literal' },
      context: { type: 'number', required: false, description: 'Lines of context to include' },
      max: { type: 'number', required: false, description: 'Max matches (default 100)' },
      ignoreCase: { type: 'boolean', required: false, description: 'Case-insensitive' },
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
      for (const [name, spec] of Object.entries(rec.inputs)) {
        if (spec.required && !(name in args)) missing.push(name);
        else if (name in args && typeOf(args[name]) !== spec.type) {
          typeErrors.push({ name, want: spec.type, got: typeOf(args[name]) });
        }
      }
      for (const name of Object.keys(args)) {
        if (!(name in rec.inputs)) unknown.push(name);
      }
      return { ok: missing.length === 0 && unknown.length === 0 && typeErrors.length === 0, missing, unknown, typeErrors, signature: rec.signature };
    },
  });
}
