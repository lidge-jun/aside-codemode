// ripgrep resolution + spawn (A-D4). Lazy, structured failure, execFile only.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const isWindows = process.platform === 'win32';

export class RgNotFoundError extends Error {
  constructor() {
    super('ripgrep not found: install rg or set CODEMODE_RG / rgPath');
    this.name = 'RgNotFoundError';
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

export function createRgResolver(config, env = process.env) {
  let cached = null;
  return async function resolveRg() {
    if (cached) return cached;
    const explicit = config.rgPath || env.CODEMODE_RG;
    if (explicit) {
      // Explicit config is authoritative: a wrong path is a structured error,
      // never a silent fall-through to whatever PATH happens to hold.
      const abs = path.isAbsolute(explicit) ? explicit : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', explicit);
      if (existsSync(abs)) return (cached = abs);
      throw new RgNotFoundError();
    }
    const candidates = [
      ...pathCandidates(env),
      '/opt/homebrew/bin/rg',
      '/usr/local/bin/rg',
      await whereRg(),
    ].filter(Boolean);
    const failures = [];
    for (const cand of candidates) {
    // existsSync is not enough: a directory or non-executable named rg
      // passes it and then dies as spawn EINVAL (measured via aside exec's
      // bash env, node v26, 2026-09-13). Prove each candidate with --version.
      try {
        await execFileP(cand, ['--version'], { timeout: 5000, windowsHide: true });
        return (cached = cand);
      } catch (e) {
        failures.push(`${cand}: ${e.code ?? e.message}`);
      }
    }
    const err = new RgNotFoundError();
    err.candidates = failures;
    throw err;
  };
}

const RG_TIMEOUT_MS = 30000;
const RG_MAX_BUFFER = 8 * 1024 * 1024;

export function createRgRunner(resolveRg) {
  async function run(args) {
    const rg = await resolveRg();
    const { stdout } = await execFileP(rg, args, {
      timeout: RG_TIMEOUT_MS,
      maxBuffer: RG_MAX_BUFFER,
      windowsHide: true,
    });
    return stdout;
  }

  return {
    async files({ pattern, path: dir, glob, max = 5000 }) {
      const args = ['--files', '--path-separator=/'];
      if (glob) args.push('-g', glob);
      args.push(dir);
      const out = await run(args);
      let lines = out.split(/\r?\n/).filter(Boolean);
      if (pattern) lines = lines.filter((l) => l.includes(pattern));
      return lines.slice(0, max);
    },
    async content({ query, path: dir, glob, context, max = 500, ignoreCase = false }) {
      const args = ['--json', '--path-separator=/'];
      if (ignoreCase) args.push('-i');
      if (Number.isFinite(context)) args.push('-C', String(context));
      if (glob) args.push('-g', glob);
      args.push('--max-count', String(max), '--', query, dir);
      let out = '';
      try {
        out = await run(args);
      } catch (e) {
        if (e.code === 1) return []; // no matches
        throw e;
      }
      const hits = [];
      for (const line of out.split(/\r?\n/)) {
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type !== 'match') continue;
        hits.push({
          file: ev.data.path.text,
          line: ev.data.line_number,
          text: ev.data.lines.text.replace(/\r?\n$/, ''),
        });
        if (hits.length >= max) break;
      }
      return hits;
    },
  };
}
import { fileURLToPath } from 'node:url';
