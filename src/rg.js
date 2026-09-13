// ripgrep resolution + search execution (A-D4).
// Lazy resolution, structured failure, argv-only (never a shell).
// Streaming/child-process mechanics live in ./rg-stream.js; the option contract
// and result envelope live in ./search-schema.js and ./search-result.js.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { rgChildOpts } from './child-opts.js';
import { runStream, RgFailedError, RG_TIMEOUT_MS, throwIfSearchCancelled } from './rg-stream.js';
import { decorateSearchResult } from './search-result.js';
import { buildScope, FOLLOW_SYMLINKS_UNSUPPORTED, SearchOptionError } from './search-schema.js';

const execFileP = promisify(execFile);
const isWindows = process.platform === 'win32';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export { RgFailedError };

export class RgNotFoundError extends Error {
  constructor() {
    super('ripgrep not found: install rg or set CODEMODE_RG / rgPath');
    this.name = 'RgNotFoundError';
    this.code = 'ERG404';
    this.hint = 'install rg or set CODEMODE_RG';
  }
}

function pathCandidates(env) {
  const out = [];
  const pathEnv = env.PATH ?? env.Path ?? '';
  // .bat/.cmd shims are NOT spawnable via execFile (EINVAL without a shell) —
  // measured through aside exec's bash on Windows 2026-09-13. exe/plain only.
  const exts = isWindows ? ['rg.exe', 'rg'] : ['rg'];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of exts) out.push(path.join(dir, name));
  }
  return out;
}

async function whereRg(signal) {
  if (!isWindows) return null;
  try {
    const { stdout } = await execFileP('where.exe', ['rg'], { timeout: 5000, signal, killSignal: 'SIGKILL' });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

// A vendored bin/rg.exe is a repo default, not a per-machine choice. On a
// non-Windows host it is unrunnable (spawn EACCES, measured on macOS after a
// fresh clone), so it must not be treated as an authoritative explicit path.
function isInapplicableVendoredExe(abs) {
  return !isWindows && abs.toLowerCase().endsWith('.exe');
}

export function createRgResolver(config, env = process.env, { signal } = {}) {
  let cached = null;
  return async function resolveRg() {
    signal?.throwIfAborted();
    if (cached) return cached;
    const explicit = config.rgPath || env.CODEMODE_RG;
    if (explicit) {
      const abs = path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
      if (!isInapplicableVendoredExe(abs)) {
        // Explicit config is authoritative: a wrong path is a structured error,
        // never a silent fall-through to whatever PATH happens to hold.
        if (!existsSync(abs)) throw new RgNotFoundError();
        try {
          await execFileP(abs, ['--version'], rgChildOpts({ timeout: 5000, signal, killSignal: 'SIGKILL' }, env));
          return (cached = abs);
        } catch (e) {
          signal?.throwIfAborted();
          const err = new RgNotFoundError();
          err.candidates = [`${abs}: ${e.code ?? e.message}`];
          throw err;
        }
      }
      // else: fall through to the ladder below on purpose.
    }
    const candidates = [
      ...pathCandidates(env),
      '/opt/homebrew/bin/rg',
      '/usr/local/bin/rg',
      '/home/linuxbrew/.linuxbrew/bin/rg',
      await whereRg(signal),
    ].filter(Boolean);
    const failures = [];
    for (const cand of candidates) {
      signal?.throwIfAborted();
      // existsSync is not enough: a directory or non-executable named rg
      // passes it and then dies as spawn EINVAL/EACCES (measured via aside
      // exec's bash env, node v24, 2026-09-13). Prove each with --version.
      try {
        await execFileP(cand, ['--version'], rgChildOpts({ timeout: 5000, signal, killSignal: 'SIGKILL' }, env));
        return (cached = cand);
      } catch (e) {
        signal?.throwIfAborted();
        failures.push(`${cand}: ${e.code ?? e.message}`);
      }
    }
    const err = new RgNotFoundError();
    err.candidates = failures.slice(0, 12);
    throw err;
  };
}

// --no-config: a user's RIPGREP_CONFIG_PATH can silently change ignore rules,
//   regex mode or output format and make this wrapper non-reproducible.
// --path-separator=/: stable paths across platforms for the caller.
// NOTE: --no-messages is deliberately NOT set. It suppresses file open/read
//   errors, which turns an incomplete traversal into what looks like a clean
//   "no results" answer — the exact false-negative this tool must not produce.
//   Unreadable paths surface through the `partial` warning instead.
const BASE_ARGS = ['--no-config', '--path-separator=/'];

// rg exits 0/1 even when some paths could not be read (permissions, broken
// symlinks). Without --no-messages those land on stderr; surfacing them keeps
// the happy path clean while making an incomplete traversal detectable instead
// of looking like a clean zero.
function partialLines(stderr) {
  if (!stderr) return [];
  return stderr.split(/\r?\n/).filter(Boolean).slice(0, 5);
}

function decodePath(p) {
  if (!p) return '<unknown>';
  if (typeof p.text === 'string') return p.text;
  // rg emits { bytes: <base64> } for paths that are not valid UTF-8.
  if (typeof p.bytes === 'string') return Buffer.from(p.bytes, 'base64').toString('utf8');
  return '<non-utf8-path>';
}

function lineText(d) {
  return typeof d.lines?.text === 'string'
    ? d.lines.text.replace(/\r?\n$/, '')
    : '<binary or non-utf8 line>';
}

// Flags shared by files/content/count. Kept in one place so the entry points
// cannot drift in what they do or do not respect.
function discoveryArgs({ noIgnore, hidden, followSymlinks, maxFilesize, excludeGlobs, includeExcluded }) {
  // Defence in depth: host/search.js rejects this before we are reached, but a
  // direct runner caller must not be able to make us spawn --follow either.
  if (followSymlinks === true) {
    throw new SearchOptionError(FOLLOW_SYMLINKS_UNSUPPORTED, 'ENOTSUP');
  }
  const args = [];
  // Cheap, high-value pruning. `includeExcluded: true` opts back in.
  if (!includeExcluded && Array.isArray(excludeGlobs)) {
    for (const g of excludeGlobs) args.push('-g', `!${g}`);
  }
  // -uu equivalent, split so callers can pick one axis at a time.
  if (noIgnore) args.push('--no-ignore');
  if (hidden) args.push('--hidden');
  if (maxFilesize != null) args.push('--max-filesize', String(maxFilesize));
  return args;
}

// A search is only complete when nothing was cut short, nothing was unreadable
// and nothing killed the process from outside.
function completeness({ truncated, partial, killedBySignal }) {
  return !truncated && partial.length === 0 && !killedBySignal;
}

export function createRgRunner(resolveRg, { excludeGlobs = [], signal } = {}) {
  const checkedResolveRg = async () => {
    throwIfSearchCancelled(signal);
    const binary = await resolveRg();
    throwIfSearchCancelled(signal);
    return binary;
  };
  return {
    async files({
      pattern,
      path: dir,
      glob,
      max = 5000,
      noIgnore = false,
      hidden = false,
      followSymlinks = false,
      maxFilesize,
      timeoutMs,
      includeExcluded = false,
    }) {
      signal?.throwIfAborted();
      const discovery = discoveryArgs({ noIgnore, hidden, followSymlinks, maxFilesize, excludeGlobs, includeExcluded });
      const rg = await checkedResolveRg();
      // --null: a path may legally contain a newline, and splitting --files on
      // '\n' turned one such file into two bogus rows (or dropped it after a
      // pattern filter). NUL cannot appear in a path on any supported OS.
      const args = [...BASE_ARGS, '--files', '--null', ...discovery];
      if (glob) args.push('-g', glob);
      args.push(dir);
      const out = [];
      const { truncated, stderr, killedBySignal } = await runStream(rg, args, {
        signal,
        max,
        timeoutMs: timeoutMs ?? RG_TIMEOUT_MS,
        delimiter: '\0',
        onLine: (line) => {
          if (pattern && !line.includes(pattern)) return false;
          out.push(line);
          return true;
        },
        onOverflow: () => { out.pop(); },
      });
      const partial = partialLines(stderr);
      return decorateSearchResult(out, {
        truncated,
        partial,
        complete: completeness({ truncated, partial, killedBySignal }),
        scope: buildScope({
          kind: 'files',
          maxFilesize, timeoutMs: timeoutMs ?? RG_TIMEOUT_MS,
          path: dir,
          glob,
          pattern,
          max,
          noIgnore,
          hidden,
          followSymlinks,
          includeExcluded,
          excludeGlobs,
        }),
      });
    },

    async content({
      query,
      path: dir,
      glob,
      context,
      max = 500,
      ignoreCase = false,
      noIgnore = false,
      hidden = false,
      followSymlinks = false,
      fixedStrings = false,
      multiline = false,
      wordRegexp = false,
      maxFilesize,
      timeoutMs,
      includeExcluded = false,
    }) {
      signal?.throwIfAborted();
      const discovery = discoveryArgs({ noIgnore, hidden, followSymlinks, maxFilesize, excludeGlobs, includeExcluded });
      const rg = await checkedResolveRg();
      const args = [...BASE_ARGS, '--json'];
      if (ignoreCase) args.push('-i');
      if (fixedStrings) args.push('-F');
      if (wordRegexp) args.push('-w');
      if (multiline) args.push('-U', '--multiline-dotall');
      args.push(...discovery);
      const wantContext = Number.isInteger(context) && context > 0;
      if (wantContext) args.push('-C', String(context));
      if (glob) args.push('-g', glob);
      // NOTE: --max-count is deliberately NOT used. It is a PER-FILE cap, so
      // passing `max` there let a wide search return far more (or fewer) rows
      // than the caller asked for. `max` is enforced globally by runStream.
      args.push('--', query, dir);

      const hits = [];
      // Matching lines are also context for nearby matches. Keep a bounded
      // recent-row window and update every hit still awaiting trailing context.
      let recent = [];
      let openHits = [];
      const resetFile = () => { recent = []; openHits = []; };
      const remember = (row) => {
        for (const entry of openHits) {
          if (row.line > entry.end && row.line <= entry.end + context) entry.hit.context.after.push(row);
        }
        openHits = openHits.filter(entry => row.line < entry.end + context);
        recent.push(row);
        if (recent.length > context) recent.shift();
      };

      const { truncated, stderr, killedBySignal } = await runStream(rg, args, {
        signal,
        max,
        timeoutMs: timeoutMs ?? RG_TIMEOUT_MS,
        onLine: (line) => {
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            return false;
          }
          if (ev.type === 'begin' || ev.type === 'end') {
            resetFile();
            return false;
          }
          if (ev.type !== 'context' && ev.type !== 'match') return false;
          const d = ev.data ?? {};
          const start = d.line_number ?? null;
          const text = lineText(d);
          if (ev.type === 'context') {
            if (wantContext && start !== null) remember({ line: start, text });
            return false;
          }
          const hit = { file: decodePath(d.path), line: start, text };
          if (wantContext) {
            hit.context = {
              before: recent.filter(row => row.line >= start - context && row.line < start),
              after: [],
            };
            if (start !== null) {
              const rows = text.split(/\r?\n/);
              rows.forEach((text, i) => remember({ line: start + i, text }));
              openHits.push({ hit, end: start + rows.length - 1 });
            }
          }
          hits.push(hit);
          return true;
        },
        onOverflow: () => {
          const dropped = hits.pop();
          openHits = openHits.filter(entry => entry.hit !== dropped);
        },
      });
      const partial = partialLines(stderr);
      return decorateSearchResult(hits, {
        truncated,
        partial,
        complete: completeness({ truncated, partial, killedBySignal }),
        scope: buildScope({
          kind: 'content',
          query, ignoreCase, fixedStrings, wordRegexp, multiline,
          maxFilesize, timeoutMs: timeoutMs ?? RG_TIMEOUT_MS,
          path: dir,
          glob,
          context: Number.isInteger(context) ? context : null,
          max,
          noIgnore,
          hidden,
          followSymlinks,
          includeExcluded,
          excludeGlobs,
        }),
      });
    },

    // Cheap pre-flight: how big is this search before pulling rows?
    async count({
      query,
      path: dir,
      glob,
      ignoreCase = false,
      noIgnore = false,
      hidden = false,
      followSymlinks = false,
      fixedStrings = false,
      maxFilesize,
      timeoutMs,
      includeExcluded = false,
    }) {
      signal?.throwIfAborted();
      const discovery = discoveryArgs({ noIgnore, hidden, followSymlinks, maxFilesize, excludeGlobs, includeExcluded });
      const rg = await checkedResolveRg();
      const args = [...BASE_ARGS, '--json'];
      if (ignoreCase) args.push('-i');
      if (fixedStrings) args.push('-F');
      args.push(...discovery);
      if (glob) args.push('-g', glob);
      args.push('--', query, dir);
      let matches = 0;
      const files = new Set();
      // Counting matches as ACCEPTED rows is what makes a soft rg failure
      // survivable here: before, count reported zero accepted rows, so a single
      // unreadable directory (rg's soft exit 2) threw the whole call away
      // instead of returning the readable count with a partial warning.
      const { stderr, killedBySignal } = await runStream(rg, args, {
        signal,
        max: Infinity,
        timeoutMs: timeoutMs ?? RG_TIMEOUT_MS,
        onLine: (line) => {
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            return false;
          }
          if (ev.type !== 'match') return false;
          matches += 1;
          files.add(decodePath(ev.data?.path));
          return true;
        },
      });
      const partial = partialLines(stderr);
      return decorateSearchResult({ matches, files: files.size }, {
        truncated: false,
        partial,
        complete: completeness({ truncated: false, partial, killedBySignal }),
        scope: buildScope({
          kind: 'count',
          query, ignoreCase, fixedStrings,
          maxFilesize, timeoutMs: timeoutMs ?? RG_TIMEOUT_MS,
          path: dir,
          glob,
          noIgnore,
          hidden,
          followSymlinks,
          includeExcluded,
          excludeGlobs,
        }),
      });
    },
  };
}
