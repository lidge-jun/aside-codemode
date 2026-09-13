// Guest global `actions` (A-D5): in-sandbox discovery over the injected globals.
const REGISTRY = [
  {
    path: 'search.files',
    description: 'List files under a root (ripgrep --files). Fast path listing, optional substring filter and glob.',
    signature: "search.files({ path, pattern?, glob?, max? }) => Promise<string[]>",
    inputs: {
      path: { type: 'string', required: true, description: 'Directory to list (must be inside configured roots)' },
      pattern: { type: 'string', required: false, description: 'Case-sensitive substring filter on returned paths' },
      glob: { type: 'string', required: false, description: 'ripgrep -g glob, e.g. *.ts' },
      max: { type: 'number', required: false, description: 'Result cap (default from config)' },
    },
  },
  {
    path: 'search.content',
    description: 'Search file contents with ripgrep. Returns matching lines with file and line number.',
    signature: "search.content({ query, path, glob?, context?, max?, ignoreCase? }) => Promise<{file,line,text}[]>",
    inputs: {
      query: { type: 'string', required: true, description: 'ripgrep pattern (regex; quote metacharacters)' },
      path: { type: 'string', required: true, description: 'Directory or file to search (inside roots)' },
      glob: { type: 'string', required: false, description: 'ripgrep -g glob' },
      context: { type: 'number', required: false, description: 'Context lines around each match' },
      max: { type: 'number', required: false, description: 'Match cap' },
      ignoreCase: { type: 'boolean', required: false, description: 'Case-insensitive search' },
    },
  },
  {
    path: 'fs.read',
    description: 'Read a UTF-8 file inside roots (capped, truncation marker appended).',
    signature: "fs.read(path, { maxBytes? }?) => Promise<string>",
    inputs: {
      path: { type: 'string', required: true, description: 'File path (inside roots)' },
      maxBytes: { type: 'number', required: false, description: 'Read cap (default 256 KiB)' },
    },
  },
  {
    path: 'fs.write',
    description: 'Write a UTF-8 file inside roots (parent directory must exist).',
    signature: "fs.write(path, content) => Promise<{wrote,bytes}>",
    inputs: {
      path: { type: 'string', required: true, description: 'Target file path (inside roots)' },
      content: { type: 'string', required: true, description: 'File contents' },
    },
  },
  {
    path: 'fs.list',
    description: 'List directory entries with type and size.',
    signature: "fs.list(path, { max? }?) => Promise<{name,type,size}[]>",
    inputs: {
      path: { type: 'string', required: true, description: 'Directory path (inside roots)' },
      max: { type: 'number', required: false, description: 'Entry cap (default 1000)' },
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
