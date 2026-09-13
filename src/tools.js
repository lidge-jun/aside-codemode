// execute_code tool definition + handler (A-D2/A-D5).
import { runCode } from './sandbox.js';

export const TOOL_NAME = 'execute_code';

const GUEST_API_DOC = [
  'Run JavaScript that orchestrates local search and file tools in ONE call, instead of many separate tool calls.',
  'Your code runs as an async function body: use return for the final answer and await freely. Only the returned value and console output reach the model.',
  'Injected globals (nothing else exists: no require/process/fetch/network):',
  '- search.files({ path, pattern?, glob?, max? }) => string[] — ripgrep-backed file listing (very fast).',
  '- search.content({ query, path, glob?, context?, max?, ignoreCase? }) => {file,line,text}[] — ripgrep-backed content search.',
  '- fs.read(path, {maxBytes?}?) => string, fs.write(path, content), fs.list(path, {max?}?) => {name,type,size}[] — root-scoped fs.',
  '- actions.list(filter?), actions.find(query), actions.describe(path), actions.check(path, args) — discover the above without schema dumps. Recommended flow: find -> describe -> check -> call.',
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
