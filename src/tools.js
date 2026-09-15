// execute_code tool definition + handler (A-D2/A-D5).
import { runCode } from './sandbox.js';
import { requireInteger } from './execution-output.js';

export const TOOL_NAME = 'execute_code';

const GUEST_API_DOC = [
  'Run JavaScript that orchestrates local search and file tools in ONE call, instead of many separate tool calls.',
  'Your code runs as an async function body: use return for the final answer and await freely. Only the returned value and console output reach the model.',
  'Provided guest APIs (no direct require/process/fetch/network API; not a hostile-code security boundary):',
  '- search.files({ path, pattern?, glob?, max?, noIgnore?, hidden? }) => string[] — ripgrep-backed path listing. `pattern` is a case-sensitive SUBSTRING filter on the returned paths, NOT a glob: pattern:"*.pdf" is rejected with the glob you meant, use glob:"**/*.pdf". Streams with one-row lookahead to distinguish an exact max from truncation.',
  '- search.content({ query, path, glob?, context?, max?, ignoreCase?, fixedStrings?, noIgnore?, hidden? }) => {file,line,text}[] — content search. max is a GLOBAL row cap.',
  '- search.count({ query, path, glob?, noIgnore? }) => {matches,files} — size a search before pulling rows.',
  '- read_file({ path, offset?, limit? }) => string — Aside-shaped read. offset/limit are 1-indexed LINES. Unpaged and retained paged output cap at 262144 bytes (throws if larger); paged physical lines also cap at 262144 bytes.',
  '- write_file({ file_path, content }) => {wrote,bytes} — Aside-shaped create-only write (wx). Overwrite throws.',
  '- edit_file({ path, appendText?, edits:[{oldText,newText}] }) — Aside-shaped unique replacements on the original file.',
  '- apply_patch(text) => {} — Codex-shaped *** Begin Patch / *** End Patch. Add File → write_file. Update File matches whole lines (not substrings), deletes lines, and preserves the file newline (LF or CRLF). No rollback: earlier hunks stay if a later one fails. Multiple update hunks and EOF anchors are supported. Errors preserve applied[] and failedFile when the output budget permits. Delete/Move/Environment throw. Not an AGENTS verb.',
  '- fs.readMany/grepFile/mkdir/stat/exists/list — compound helpers. fs.read/fs.write remain as deprecated byte/overwrite aliases.',
  '- actions.list(filter?), actions.find(query), actions.describe(path), actions.check(path, args) — discover the above without schema dumps. Recommended flow: find -> describe -> check -> call.',
  '- browse.probe() => capability matrix measured against the installed Aside build: which page methods exist, which options are silently ignored, and why a request would be refused. browse.exec(job) runs a batch through one Aside REPL session and returns {items, partial, leakedUrls} where a per-item failure never empties the other results. Unsupported options (page.route, screenshot maxWidth, pdf format, file:// urls, networkidle) throw ENOTSUP before anything spawns rather than degrading silently.',
  '- browse.readText(url) or browse.readText({ url, minChars?, timeoutMs? }) => { text, format, chars, ... } — a URL STRING as the first argument, or an options object; both shapes work. The body is `text`. `format` says what it is: "markdown" when the fetch path converted the html, "text" when the browser returned its rendered body. There is no `markdown` field any more: one body means the budget is not spent twice and the shrinker cannot drop one copy while you read the other. A body too large for the envelope is still cut, so compare chars with what you received before calling it the whole page.',
  '- browse.attach({ targetId?, urlIncludes?, snapshot?, treeNodes? }) => reads a tab the USER already has open, in their session, without opening or closing anything. snapshot:"tree" returns the accessibility tree as one string; add treeNodes:true and the same tree also arrives parsed as snapshot.nodes [{depth, role, name, ref, attrs, line}] — group hierarchical rows by walking forward while depth exceeds the parent row. It is off by default because it costs payload. Two limits: snapshot:"interactive" drops text and heading rows, so a grouped read needs "tree"; and a child frame whose rows arrive without indentation cannot be grouped by depth, so use the f-prefixed refs there.',
  'The guest has NO module loader. import(), require, process and fetch do not exist and code cannot be built from a string; a dynamic import is refused with EGUESTIMPORT and the list of injected globals (search, fs, actions, browse, report, api, recipes, read_file, write_file, edit_file, apply_patch, console). Read files with read_file, and reach the network through browse.',
  'IMPORTANT — searches respect .gitignore by default. A parent .gitignore can hide an ENTIRE project directory, so a file you know exists can be missing from results. If something expected is absent, retry with noIgnore:true (add hidden:true for dotfiles) or compare search.count with and without it before concluding it does not exist. Inclusive search.glob can match gitignored/hidden files even when noIgnore/hidden are false. fs.grepFile uses the same completeness envelope as search.*.',
  'Unknown options are rejected with the list of valid ones rather than being silently ignored. Search arrays retain guest iteration; returning them directly or nested serializes {rows,complete,truncated,partial,scope}. Counts serialize the same metadata with matches/files. Preserve metadata when projecting rows. followSymlinks:true is unsupported and rejected.',
  'IMPORTANT — symlinks are never followed, and what was stepped over is reported. scope.skippedSymlinks gives {dirs, files, examples, capped}; a skipped DIRECTORY also sets complete:false, because a subtree can hide behind it. noIgnore/hidden will not bring those results back: point path at the link target instead (it has to be inside the configured roots). A skipped file link is counted but does not lower completeness, and the count does not consult .gitignore.',
  'browse is ON by default: a fresh install can call it with no extra step. A machine can still switch it off by setting browseCaps.enabled false in its config, and every refusal then carries the one command that turns it back on: codemode --enable-browse, which writes that key into the user config (~/.config/codemode/config.json) and touches nothing else.',
  'Paths outside the configured roots are refused. Prefer one code block that searches, filters, reads only the hits, and returns a distilled answer.',
  'IMPORTANT — paths come back as the bytes on disk. macOS stores filenames decomposed (NFD) while you almost certainly type them composed (NFC), and a decomposed name does NOT contain the composed needle even though both render the same. search.files `pattern`, fs.grepFile and the root guard fold normalization for you; when you filter results YOURSELF (fs.list names, files.find(f => f.includes(...))), call .normalize("NFC") on both sides or you will drop files that are right there. search.content/search.count match raw bytes inside ripgrep and are not folded.',
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
