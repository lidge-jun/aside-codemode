import path from 'node:path';

export function resolveCwd({ argv = [], env = process.env, processCwd = process.cwd() } = {}) {
  const flagIdx = argv.indexOf('--cwd');
  if (flagIdx !== -1) {
    const v = argv[flagIdx + 1];
    if (!v || v.startsWith('-')) throw new Error('--cwd requires a directory path');
    return path.resolve(v);
  }
  if (env.CODEMODE_CWD) return path.resolve(env.CODEMODE_CWD);
  return path.resolve(processCwd);
}
