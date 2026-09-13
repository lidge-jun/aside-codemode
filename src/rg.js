// ripgrep resolution + streaming spawn (A-D4).
// Lazy resolution, structured failure, argv-only (never a shell).
//
// Why streaming instead of execFile buffering (measured 2026-09-13, macOS):
//   search.files({ path: '~/Developer', max: 10 }) died with
//   "stdout maxBuffer length exceeded" even though only 10 rows were wanted —
//   execFile buffers the WHOLE rg output before JS ever sees a row, so `max`
//   was applied after the damage. We now read stdout incrementally and kill rg
//   once `max` accepted rows exist, which makes `max` an actual bound on work.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const isWindows = process.platform === 'win32';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class RgNotFoundError extends Error {
  constructor() {
    super('ripgrep not found: install rg or set CODEMODE_RG / rgPath');
    this.name = 'RgNotFoundError';
    this.code = 'ERG404';
    this.hint = 'install rg or set CODEMODE_RG';
  }
}

export class RgFailedError extends Error {
  constructor(message, { exitCode = null, stderr = '' } = {}) {
    super(message);
    this.name = 'RgFailedError';
    this.code = 'ERGFAIL';
    this.exitCode = exitCode;
    if (stderr) this.stderr = stderr;
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

async function whereRg() {
  if (!isWindows) return null;
  try {
    const { stdout } = await execFileP('where.exe', ['rg'], { timeout: 5000 });
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

export function createRgResolver(config, env = process.env) {
  let cached = null;
  return async function resolveRg() {
    if (cached) return cached;
    const explicit = config.rgPath || env.CODEMODE_RG;
    if (explicit) {
      const abs = path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
      if (!isInapplicableVendoredExe(abs)) {
        // Explicit config is authoritative: a wrong path is a structured error,
        // never a silent fall-through to whatever PATH happens to hold.
        if (!existsSync(abs)) throw new RgNotFoundError();
        try {
          await execFileP(abs, ['--version'], { timeout: 5000, windowsHide: true });
          return (cached = abs);
        } catch (e) {
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
      await whereRg(),
    ].filter(Boolean);
    const failures = [];
    for (const cand of candidates) {
      // existsSync is not enough: a directory or non-executable named rg
      // passes it and then dies as spawn EINVAL/EACCES (measured via aside
      // exec's bash env, node v24, 2026-09-13). Prove each with --version.
      try {
        await execFileP(cand, ['--version'], { timeout: 5000, windowsHide: true });
        return (cached = cand);
      } catch (e) {
        failures.push(`${cand}: ${e.code ?? e.message}`);
      }
    }
    const err = new RgNotFoundError();
    err.candidates = failures.slice(0, 12);
    throw err;
  };
}

const RG_TIMEOUT_MS = 30000;
const STDERR_CAP = 4096;

// --no-config: a user's RIPGREP_CONFIG_PATH can silently change ignore rules,
//   regex mode or output format and make this wrapper non-reproducible.
// --path-separator=/: stable paths across platforms for the caller.
// NOTE: --no-messages is deliberately NOT set. It suppresses file open/read
//   errors, which turns an incomplete traversal into what looks like a clean
//   "no results" answer — the exact false-negative this tool must not produce.
//   Unreadable paths surface through the `partial` warning instead.
const BASE_ARGS = ['--no-config', '--path-separator=/'];

// Stream rg stdout line by line. `onLine` returns true when the row counts
// toward `max`; we SIGTERM rg as soon as the cap is reached.
function runStream(rg, args, { max, onLine, timeoutMs = RG_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(rg, args, { windowsHide: true });
    } catch (e) {
      reject(new RgFailedError(`cannot spawn rg: ${e.message}`));
      return;
    }
    let buf = '';
    let accepted = 0;
    let truncated = false;
    let settled = false;
    let stderr = '';

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish(new RgFailedError(`rg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve({ truncated, accepted, stderr: stderr.trim() });
    }

    function feed(line) {
      if (!line || truncated) return;
      if (onLine(line)) {
        accepted += 1;
        if (accepted >= max) {
          truncated = true;
          try { child.kill('SIGTERM'); } catch {}
        }
      }
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (settled || truncated) return;
      buf += chunk;
      let idx;
      while (!truncated && (idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        feed(line);
      }
      if (truncated) buf = '';
    });
    child.stdout.on('error', () => {}); // EPIPE after our own kill

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      if (stderr.length < STDERR_CAP) stderr += d;
    });
    child.stderr.on('error', () => {});

    child.on('error', (e) => finish(new RgFailedError(`rg failed: ${e.message}`)));
    child.on('close', (code) => {
      if (!truncated && buf) feed(buf.replace(/\r$/, ''));
      if (truncated) return finish();
      // rg exit codes: 0 = matches, 1 = no matches, 2 = error. Exit 2 covers
      // BOTH a fatal error (bad regex) and a soft one (a single unreadable
      // file), so failing the whole call on 2 threw away good results for an
      // unrelated permission problem. Rule: if rows were produced, return them
      // with a `partial` warning; only a 2 with nothing to show is an error.
      if (code === 0 || code === 1 || code === null) return finish();
      if (code === 2 && accepted > 0) return finish();
      // Include rg's own diagnosis. "exited with code 2" is unactionable;
      // "regex parse error: unclosed character class" is self-correctable.
      const why = stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ').slice(0, 400);
      finish(new RgFailedError(
        `rg exited with code ${code}${why ? `: ${why}` : ''}`,
        { exitCode: code, stderr: why },
      ));
    });
  });
}

// rg exits 0/1 even when some paths could not be read (permissions, broken
// symlinks). Without --no-messages those land on stderr; surfacing them as a
// non-enumerable `.partial` keeps the happy path clean while making an
// incomplete traversal detectable instead of looking like a clean zero.
function attachPartial(arr, stderr) {
  if (!stderr) return;
  const lines = stderr.split(/\r?\n/).filter(Boolean).slice(0, 5);
  Object.defineProperty(arr, 'partial', { value: lines, enumerable: false });
}

function decodePath(p) {
  if (!p) return '<unknown>';
  if (typeof p.text === 'string') return p.text;
  // rg emits { bytes: <base64> } for paths that are not valid UTF-8.
  if (typeof p.bytes === 'string') return Buffer.from(p.bytes, 'base64').toString('utf8');
  return '<non-utf8-path>';
}

// Flags shared by files/content. Kept in one place so the two entry points
// cannot drift in what they do or do not respect.
function discoveryArgs({ noIgnore, hidden, followSymlinks, maxFilesize }) {
  const args = [];
  // -uu equivalent, split so callers can pick one axis at a time.
  if (noIgnore) args.push('--no-ignore');
  if (hidden) args.push('--hidden');
  if (followSymlinks) args.push('--follow');
  if (maxFilesize != null) args.push('--max-filesize', String(maxFilesize));
  return args;
}

export function createRgRunner(resolveRg) {
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
    }) {
      const rg = await resolveRg();
      const args = [...BASE_ARGS, '--files'];
      args.push(...discoveryArgs({ noIgnore, hidden, followSymlinks, maxFilesize }));
      if (glob) args.push('-g', glob);
      args.push(dir);
      const out = [];
      const { truncated, stderr } = await runStream(rg, args, {
        max,
        timeoutMs,
        onLine: (line) => {
          if (pattern && !line.includes(pattern)) return false;
          out.push(line);
          return true;
        },
      });
      attachPartial(out, stderr);
      // Non-enumerable so JSON.stringify(out) still yields a plain array,
      // but `out.truncated` is readable in guest code.
      Object.defineProperty(out, 'truncated', { value: truncated, enumerable: false });
      return out;
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
    }) {
      const rg = await resolveRg();
      const args = [...BASE_ARGS, '--json'];
      if (ignoreCase) args.push('-i');
      if (fixedStrings) args.push('-F');
      if (wordRegexp) args.push('-w');
      if (multiline) args.push('-U', '--multiline-dotall');
      args.push(...discoveryArgs({ noIgnore, hidden, followSymlinks, maxFilesize }));
      if (Number.isFinite(context)) args.push('-C', String(context));
      if (glob) args.push('-g', glob);
      // NOTE: --max-count is deliberately NOT used. It is a PER-FILE cap, so
      // passing `max` there let a wide search return far more (or fewer) rows
      // than the caller asked for. `max` is enforced globally by runStream.
      args.push('--', query, dir);
      const hits = [];
      const { truncated, stderr } = await runStream(rg, args, {
        max,
        timeoutMs,
        onLine: (line) => {
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            return false;
          }
          if (ev.type !== 'match') return false;
          const d = ev.data ?? {};
          const text = typeof d.lines?.text === 'string'
            ? d.lines.text.replace(/\r?\n$/, '')
            : '<binary or non-utf8 line>';
          hits.push({ file: decodePath(d.path), line: d.line_number ?? null, text });
          return true;
        },
      });
      attachPartial(hits, stderr);
      Object.defineProperty(hits, 'truncated', { value: truncated, enumerable: false });
      return hits;
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
    }) {
      const rg = await resolveRg();
      const args = [...BASE_ARGS, '--json'];
      if (ignoreCase) args.push('-i');
      if (fixedStrings) args.push('-F');
      args.push(...discoveryArgs({ noIgnore, hidden, followSymlinks, maxFilesize }));
      if (glob) args.push('-g', glob);
      args.push('--', query, dir);
      let matches = 0;
      const files = new Set();
      await runStream(rg, args, {
        max: Number.MAX_SAFE_INTEGER,
        timeoutMs,
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
          return false; // counted, but never counts toward a cap
        },
      });
      return { matches, files: files.size };
    },
  };
}
