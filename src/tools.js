// execute_code tool definition + handler (A-D2/A-D5).
import { runCode } from './sandbox.js';

export const TOOL_NAME = 'execute_code';

const GUEST_API_DOC = [
  'Run JavaScript that orchestrates local search and file tools in ONE call, instead of many separate tool calls.',
  'Your code runs as an async function body: use return for the final answer and await freely. Only the returned value and console output reach the model.',
  'Injected globals (nothing else exists: no require/process/fetch/network):',
  '- search.files({ path, pattern?, glob?, max?, noIgnore?, hidden? }) => string[] — ripgrep-backed path listing. Streams and stops at max.',
  '- search.content({ query, path, glob?, context?, max?, ignoreCase?, fixedStrings?, noIgnore?, hidden? }) => {file,line,text}[] — content search. max is a GLOBAL row cap.',
  '- search.count({ query, path, glob?, noIgnore? }) => {matches,files} — size a search before pulling rows.',
  '- read_file({ path, offset?, limit? }) => string — Aside-shaped read. offset/limit are 1-indexed LINES. Unpaged reads cap at 262144 bytes (throws if larger).',
  '- write_file({ file_path, content }) => {wrote,bytes} — Aside-shaped create-only write (wx). Overwrite throws.',
  '- edit_file({ path, appendText?, edits:[{oldText,newText}] }) — Aside-shaped unique replacements on the original file.',
  '- apply_patch(text) => {} — Codex-shaped *** Begin Patch / *** End Patch. Add File → write_file, Update File → edit_file. No rollback: earlier hunks stay if a later one fails. Delete/Move/Environment throw. Not an AGENTS verb.',
  '- fs.readMany/grepFile/mkdir/stat/exists/list — compound helpers. fs.read/fs.write remain as deprecated byte/overwrite aliases.',
  '- actions.list(filter?), actions.find(query), actions.describe(path), actions.check(path, args) — discover the above without schema dumps. Recommended flow: find -> describe -> check -> call.',
  'IMPORTANT — searches respect .gitignore by default. A parent .gitignore can hide an ENTIRE project directory, so a file you know exists can be missing from results. If something expected is absent, retry with noIgnore:true (add hidden:true for dotfiles) or compare search.count with and without it before concluding it does not exist.',
  'Unknown options are rejected with the list of valid ones rather than being silently ignored. Results carry a non-enumerable .truncated flag when max cut them short.',
  'Paths outside the configured roots are refused. Prefer one code block that searches, filters, reads only the hits, and returns a distilled answer.',
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
  return async function handleToolCall(args) {
    if (!args || typeof args.code !== 'string' || args.code.length === 0) {
      const err = new Error('code (non-empty string) is required');
      err.invalidParams = true;
      throw err;
    }
    const timeoutMs = Math.min(Number.isFinite(args.timeoutMs) ? args.timeoutMs : 30000, config.maxTimeoutMs);
    const out = await runCode(args.code, { timeoutMs, globals, maxResultBytes: config.maxResultBytes });
    return {
      content: [{ type: 'text', text: JSON.stringify(out) }],
      ...(out.ok ? {} : { isError: true }),
    };
  };
}
