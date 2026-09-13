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
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read config ${p}: ${e.message}`);
  }
}

function repoConfigPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'codemode.config.json');
}

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const cfg = structuredClone(DEFAULTS);
  const apply = (obj, source) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj.roots)) cfg.roots = obj.roots.filter((r) => typeof r === 'string');
    if (typeof obj.rgPath === 'string') cfg.rgPath = obj.rgPath;
    if (Number.isFinite(obj.maxResultBytes)) cfg.maxResultBytes = obj.maxResultBytes;
    if (Number.isFinite(obj.maxTimeoutMs)) cfg.maxTimeoutMs = obj.maxTimeoutMs;
    if (obj.searchCaps && typeof obj.searchCaps === 'object') {
      if (Number.isFinite(obj.searchCaps.files)) cfg.searchCaps.files = obj.searchCaps.files;
      if (Number.isFinite(obj.searchCaps.content)) cfg.searchCaps.content = obj.searchCaps.content;
    }
    cfg._sources.push(source);
  };
  cfg._sources = ['built-in'];

  const repoPath = repoConfigPath();
  if (existsSync(repoPath)) apply(readJsonFile(repoPath), repoPath);
  if (env.CODEMODE_CONFIG) apply(readJsonFile(env.CODEMODE_CONFIG), env.CODEMODE_CONFIG);
  const flagIdx = argv.indexOf('--config');
  if (flagIdx !== -1 && argv[flagIdx + 1]) apply(readJsonFile(argv[flagIdx + 1]), argv[flagIdx + 1]);

  if (env.CODEMODE_ROOTS) cfg.roots = env.CODEMODE_ROOTS.split(path.delimiter).filter(Boolean);
  if (env.CODEMODE_RG) cfg.rgPath = env.CODEMODE_RG;
  if (env.CODEMODE_TIMEOUT_MS && Number.isFinite(Number(env.CODEMODE_TIMEOUT_MS))) cfg.maxTimeoutMs = Number(env.CODEMODE_TIMEOUT_MS);
  if (env.CODEMODE_OUTPUT_BYTES && Number.isFinite(Number(env.CODEMODE_OUTPUT_BYTES))) cfg.maxResultBytes = Number(env.CODEMODE_OUTPUT_BYTES);

  cfg.roots = cfg.roots.map((r) => path.resolve(r));
  return cfg;
}
