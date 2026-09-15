// Config resolution (A-D6): built-in < repo codemode.config.json < env CODEMODE_CONFIG < argv --config.
// Individual env keys always win: CODEMODE_ROOTS (pathsep), CODEMODE_RG, CODEMODE_TIMEOUT_MS, CODEMODE_OUTPUT_BYTES.
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireInteger, MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES } from './execution-output.js';

// Directories that cost a lot to walk and almost never hold an answer.
// Measured on this machine with roots=$HOME: 1,565,196 files / 7.8s without
// them, 336,206 files / 0.53s with them — ~13x faster for the same hits.
// ~/Library alone is 1,138,593 of those files (caches, app support).
// These are DEFAULTS, not policy: set excludeGlobs to [] to search everything,
// or pass noIgnore/hidden per call to override ignore behaviour separately.
const DEFAULT_EXCLUDES = [
  'Library',
  'node_modules',
  '.Trash',
  '.cache',
  '.npm',
  '.gradle',
  'Caches',
  'chrome-debug-profile*',
  'Pictures',
  'Movies',
  'Music',
];

const DEFAULTS = {
  roots: [],
  rgPath: null,
  maxResultBytes: 65536,
  maxTimeoutMs: 120000,
  searchCaps: { files: 5000, content: 500 },
  asidePath: null,
  // Opt-in. `timeoutMs` is the INNER script deadline and sits below Aside's measured
  // ~30s internal screenshot timeout; the host deadline is derived as inner + slack.
  browseCaps: { enabled: true, timeoutMs: 25000, maxTabs: 8, concurrency: 4 },
  excludeGlobs: DEFAULT_EXCLUDES,
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

// CODEMODE_REPO_CONFIG names the file explicitly. The default is found relative to this
// module, which is right for a real install and impossible for a test to control: the point
// of the override is that a check can aim this layer at a file it wrote, and so pin both
// halves of the behaviour on a machine that has no repository config at all.
function repoConfigPath(env = process.env) {
  if (env.CODEMODE_REPO_CONFIG) return env.CODEMODE_REPO_CONFIG;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'codemode.config.json');
}

// A globally installed binary lives in a package directory the user should not
// have to edit (and which a reinstall wipes). This is the durable location,
// honouring XDG_CONFIG_HOME when set.
export function userConfigPath(env = process.env, homedir = os.homedir()) {
  const base = env.XDG_CONFIG_HOME || path.join(homedir, '.config');
  return path.join(base, 'codemode', 'config.json');
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
    if (Array.isArray(obj.excludeGlobs)) cfg.excludeGlobs = obj.excludeGlobs.filter((g) => typeof g === 'string');
    if ('maxResultBytes' in obj) cfg.maxResultBytes = requireInteger('maxResultBytes', obj.maxResultBytes, MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
    if ('maxTimeoutMs' in obj) cfg.maxTimeoutMs = requireInteger('maxTimeoutMs', obj.maxTimeoutMs);
    if (obj.searchCaps && typeof obj.searchCaps === 'object') {
      if ('files' in obj.searchCaps) cfg.searchCaps.files = requireInteger('searchCaps.files', obj.searchCaps.files);
      if ('content' in obj.searchCaps) cfg.searchCaps.content = requireInteger('searchCaps.content', obj.searchCaps.content);
    }
    if ('asidePath' in obj && (typeof obj.asidePath === 'string' || obj.asidePath === null)) {
      cfg.asidePath = obj.asidePath;
    }
    // Field-wise, exactly like searchCaps: a later layer adds keys instead of replacing
    // the object, so one config file cannot silently drop another's browse settings.
    if (obj.browseCaps && typeof obj.browseCaps === 'object') {
      if ('enabled' in obj.browseCaps) cfg.browseCaps.enabled = obj.browseCaps.enabled === true;
      if ('timeoutMs' in obj.browseCaps) cfg.browseCaps.timeoutMs = requireInteger('browseCaps.timeoutMs', obj.browseCaps.timeoutMs);
      if ('maxTabs' in obj.browseCaps) cfg.browseCaps.maxTabs = requireInteger('browseCaps.maxTabs', obj.browseCaps.maxTabs);
      if ('concurrency' in obj.browseCaps) cfg.browseCaps.concurrency = requireInteger('browseCaps.concurrency', obj.browseCaps.concurrency);
    }
    cfg._sources.push(source);
  };

  // The repository config is generated per machine by register-aside.mjs and is gitignored,
  // so on a developer's checkout it says whatever that machine was set up for - typically
  // browsing enabled. A test that asks "what is the default" must not read it, or the same
  // assertion is green on CI and red on the machine that wrote the file. The switch is here
  // rather than in the tests because the file is found relative to this module, not the cwd.
  const repoPath = repoConfigPath(env);
  const ignoreRepo = env.CODEMODE_IGNORE_REPO_CONFIG === '1';
  if (ignoreRepo) cfg._sources.push('repo config ignored (CODEMODE_IGNORE_REPO_CONFIG=1)');
  else if (existsSync(repoPath)) apply(readJsonFile(repoPath), repoPath);
  const userPath = userConfigPath(env);
  if (existsSync(userPath)) apply(readJsonFile(userPath), userPath);
  if (env.CODEMODE_CONFIG) apply(readJsonFile(env.CODEMODE_CONFIG), env.CODEMODE_CONFIG);
  const flagIdx = argv.indexOf('--config');
  if (flagIdx !== -1 && argv[flagIdx + 1]) apply(readJsonFile(argv[flagIdx + 1]), argv[flagIdx + 1]);

  if (env.CODEMODE_ROOTS) cfg.roots = splitRoots(env.CODEMODE_ROOTS);
  if (env.CODEMODE_RG) cfg.rgPath = env.CODEMODE_RG;
  if (env.CODEMODE_EXCLUDES !== undefined) {
    cfg.excludeGlobs = env.CODEMODE_EXCLUDES.split(',').map((g) => g.trim()).filter(Boolean);
  }
  if (env.CODEMODE_TIMEOUT_MS !== undefined) cfg.maxTimeoutMs = requireInteger('CODEMODE_TIMEOUT_MS', Number(env.CODEMODE_TIMEOUT_MS));
  if (env.CODEMODE_OUTPUT_BYTES !== undefined) cfg.maxResultBytes = requireInteger('CODEMODE_OUTPUT_BYTES', Number(env.CODEMODE_OUTPUT_BYTES), MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES);

  // A global install with no config file anywhere would otherwise have an empty
  // allowlist, i.e. deny-everything, which reads as a broken binary. Default to
  // the user's own home directory — wide, but bounded by excludeGlobs and still
  // never above $HOME. Recorded in _sources so `--doctor` shows it was implied.
  if (cfg.roots.length === 0) {
    cfg.roots = [os.homedir()];
    cfg._sources.push('default:$HOME');
  }

  // Keep the raw strings: a Windows root resolved against a macOS cwd becomes
  // "/Users/.../C:\\Users\\..." and the resulting error blames the wrong path.
  cfg.rawRoots = [...cfg.roots];
  cfg.roots = cfg.roots.map((r) => (isAbsoluteAnyPlatform(r) ? r : path.resolve(r)));
  return cfg;
}
