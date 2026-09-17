// execute_code tool definition + handler (A-D2/A-D5).
import { runCode } from './sandbox.js';
import { requireInteger } from './execution-output.js';

export const TOOL_NAME = 'execute_code';

const GUEST_API_DOC = [
  'Run JavaScript that orchestrates local search, files, browsing, APIs and reports in one call.',
  'Code is an async function body: await freely and return the final answer. Only the return value and console output reach the model.',
  'Discover before calling: actions.find(query) -> actions.describe(path) -> actions.check(path, catalogArgs) -> call the named API directly. The on-demand catalog holds signatures, options, outputs and caveats, including browse.readText, browse.attach and treeNodes.',
  'Injected globals: search, fs, actions, browse, report, api, recipes, read_file, write_file, edit_file, apply_patch, console.',
  'There is no module loader: import(), require, process and fetch do not exist; string-built code and dynamic import are refused. Use the injected APIs.',
  'Searches respect .gitignore by default. A parent rule can hide an entire project. If expected content is absent, retry with noIgnore:true (and hidden:true for dotfiles) or compare counts before concluding it does not exist. An inclusive glob may still match ignored or hidden paths.',
  'Search arrays remain iterable, but direct or nested serialization is {rows,complete,truncated,partial,scope}; counts add the same metadata to matches/files. Preserve the envelope when projecting rows. complete:false, truncated:true or partial entries mean the result is not evidence of absence.',
  'Symlinks are never followed. scope.skippedSymlinks is {dirs,files,examples,capped}; a skipped directory makes complete:false because it may hide a subtree. noIgnore/hidden cannot recover it: search the real target, which must be inside a configured root. Skipped file links are counted but do not lower completeness.',
  'Paths outside configured roots are refused. Prefer one body that searches, filters, reads only hits and returns a distilled result.',
].join('\n');

export const TOOL_DEF = {
  name: TOOL_NAME,
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
