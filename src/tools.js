// execute_code tool definition + handler (A-D2/A-D5).
import { runCode } from './sandbox.js';
import { requireInteger } from './execution-output.js';

export const TOOL_NAME = 'execute_code';

const GUEST_API_DOC = [
  'Run JavaScript to search, filter and read local files, pages and APIs in one call; only returned output enters context.',
  'Use first for every directory or repo search and for 2+ independent files, URLs, pages, queries, API lookups or captures, even if a search returns one hit.',
  'Never start a native read_file loop, bash find/grep or repeated grep; call search.content or search.files once, then read only the hits.',
  'Shelling out anyway means rg, never grep or find, and rg answers without any completeness signal.',
  'For "this page" or an already-open tab, use browse.attach; it reads the existing tab without opening or closing one.',
  'Code is an async function body; await freely and return the answer. Only return and console output enter context.',
  'Discover calls with actions.find(query) -> actions.describe(path) -> actions.check(path,args). The catalog includes browse.readText, browse.attach and treeNodes.',
  'Globals: search, fs, actions, browse, report, api, recipes, read_file, write_file, edit_file, apply_patch, console.',
  'There is no module loader: import(), require, process and fetch do not exist; string-built code and dynamic import are refused. Use the injected APIs.',
  'Searches prune by .gitignore, dotfiles, excludeGlobs and binary content by default, and rg skips binary content SILENTLY. scope.coverage marks each mechanism off/on/unknown: absence needs complete:true AND every entry off, so noIgnore/hidden/includeExcluded/binary true.',
  'Search arrays remain iterable, but direct or nested serialization is {rows,complete,truncated,partial,scope}; counts add the same metadata to matches/files. Preserve the envelope when projecting rows. complete:false, truncated:true or partial entries mean rows are missing.',
  'Symlinks are never followed. scope.skippedSymlinks is {dirs,files,examples,capped}; a skipped directory makes complete:false because it may hide a subtree. noIgnore/hidden cannot recover it: search the real target, which must be inside a configured root.',
  'Paths outside roots are refused. Search, filter and read hits in one body.',
].join('\n');

export const TOOL_DEF = {
  name: TOOL_NAME,
  title: 'Code mode: project search and multi-item work',
  description: GUEST_API_DOC,
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript async function body. Use return for the final answer.' },
      timeoutMs: { type: 'number', description: 'Execution timeout in ms (default 30000).' },
    },
    required: ['code'],
    additionalProperties: false,
  },
};

export function createToolHandler({ config, globals }) {
  return async function handleToolCall(args, { signal } = {}) {
    if (!args || typeof args.code !== 'string' || args.code.length === 0) {
      const err = new Error('code (non-empty string) is required');
      err.invalidParams = true;
      throw err;
    }
    let timeoutMs;
    try { timeoutMs = Math.min(args.timeoutMs === undefined ? 30000 : requireInteger('timeoutMs', args.timeoutMs), config.maxTimeoutMs); }
    catch (e) { e.invalidParams = true; throw e; }
    const out = await runCode(args.code, { timeoutMs, globals, maxResultBytes: config.maxResultBytes, signal });
    return {
      content: [{ type: 'text', text: JSON.stringify(out) }],
      ...(out.ok ? {} : { isError: true }),
    };
  };
}
