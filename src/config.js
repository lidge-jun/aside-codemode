// Config resolution (A-D6): built-in < repo codemode.config.json < env CODEMODE_CONFIG < argv --config.
// Individual env keys always win: CODEMODE_ROOTS (pathsep), CODEMODE_RG, CODEMODE_TIMEOUT_MS, CODEMODE_OUTPUT_BYTES.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULTS = {
  roots: [],
  rgPath: null,
  maxResultBytes: 65536,
  maxTimeoutMs: 120000,
  searchCaps: { files: 5000, content: 500 },
};

function readJsonFile(p) {
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (e) {
    throw new Error(`cannot read config ${p}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`config ${p} is not valid JSON: ${e.message}`);
  }
}

// A path may be absolute for a platform other than this one (a Windows config
// read on macOS). Treat it as absolute so it is reported verbatim instead of
// being silently joined onto the current working directory.
function isAbsoluteAnyPlatform(p) {
  return path.isAbsolute(p) || path.win32.isAbsolute(p) || path.posix.isAbsolute(p);
}

// Splitting on ":" naively mangles a Windows path ("C:\\Users\\x" became "C").
// Windows uses ";" as the real delimiter, so honour ";" first and only fall
// back to ":" when the value cannot be a drive-letter path.
function splitRoots(value) {
  const parts = value.includes(';') ? value.split(';') : value.split(path.delimiter);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const cur = parts[i];
    if (!cur) continue;
    // Re-join a drive letter that ":" split apart, e.g. ["C", "\\Users\\x"].
    if (/^[A-Za-z]$/.test(cur) && i + 1 < parts.length && /^[\\/]/.test(parts[i + 1])) {
      out.push(`${cur}:${parts[i + 1]}`);
      i += 1;
      continue;
    }
    out.push(cur);
  }
  return out;
}

function repoConfigPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'codemode.config.json');
}

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const cfg = structuredClone(DEFAULTS);
  cfg._sources = ['built-in'];

  const apply = (obj, source) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj.roots)) cfg.roots = obj.roots.filter((r) => typeof r === 'string');
    // `rgPath: null` must be able to CLEAR an inherited value. The old check
    // was `typeof obj.rgPath === 'string'`, so a later config could never undo
    // an earlier "bin/rg.exe" — on macOS that produced a spawn EACCES that
    // looked like a broken install (measured 2026-09-13).
    if ('rgPath' in obj && (typeof obj.rgPath === 'string' || obj.rgPath === null)) {
      cfg.rgPath = obj.rgPath;
    }
    if (Number.isFinite(obj.maxResultBytes)) cfg.maxResultBytes = obj.maxResultBytes;
    if (Number.isFinite(obj.maxTimeoutMs)) cfg.maxTimeoutMs = obj.maxTimeoutMs;
    if (obj.searchCaps && typeof obj.searchCaps === 'object') {
      if (Number.isFinite(obj.searchCaps.files)) cfg.searchCaps.files = obj.searchCaps.files;
      if (Number.isFinite(obj.searchCaps.content)) cfg.searchCaps.content = obj.searchCaps.content;
    }
    cfg._sources.push(source);
  };

  const repoPath = repoConfigPath();
  if (existsSync(repoPath)) apply(readJsonFile(repoPath), repoPath);
  if (env.CODEMODE_CONFIG) apply(readJsonFile(env.CODEMODE_CONFIG), env.CODEMODE_CONFIG);
  const flagIdx = argv.indexOf('--config');
  if (flagIdx !== -1 && argv[flagIdx + 1]) apply(readJsonFile(argv[flagIdx + 1]), argv[flagIdx + 1]);

  if (env.CODEMODE_ROOTS) cfg.roots = splitRoots(env.CODEMODE_ROOTS);
  if (env.CODEMODE_RG) cfg.rgPath = env.CODEMODE_RG;
  if (env.CODEMODE_TIMEOUT_MS && Number.isFinite(Number(env.CODEMODE_TIMEOUT_MS))) cfg.maxTimeoutMs = Number(env.CODEMODE_TIMEOUT_MS);
  if (env.CODEMODE_OUTPUT_BYTES && Number.isFinite(Number(env.CODEMODE_OUTPUT_BYTES))) cfg.maxResultBytes = Number(env.CODEMODE_OUTPUT_BYTES);

  // Keep the raw strings: a Windows root resolved against a macOS cwd becomes
  // "/Users/.../C:\\Users\\..." and the resulting error blames the wrong path.
  cfg.rawRoots = [...cfg.roots];
  cfg.roots = cfg.roots.map((r) => (isAbsoluteAnyPlatform(r) ? r : path.resolve(r)));
  return cfg;
}
