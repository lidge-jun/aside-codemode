const VALUE_FLAGS = new Set([
  '--account', '--code', '--code-file', '--config', '--cwd', '--host', '--timeout-ms',
]);
const BOOLEAN_FLAGS = new Set([
  '--browse', '--doctor', '--enable-browse', '--force', '--install-mcp', '--json', '--no-discovery',
]);

function missingValue(name, next = null) {
  if (name === '--account') return '--account needs an account id, for example --account u1';
  if (name === '--cwd') return '--cwd requires a directory';
  return `${name} needs a value${next ? `, not ${next}` : ''}`;
}

export function parseCliArgs(argv = []) {
  const values = new Map();
  const booleans = new Set();
  const unknown = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (VALUE_FLAGS.has(token)) {
      if (values.has(token)) throw new Error(`${token} may be passed only once`);
      if (i + 1 >= argv.length) {
        throw new Error(missingValue(token));
      }
      const value = argv[i + 1];
      // Guest source is opaque. It may itself be exactly "--host" or another flag-looking
      // token; consuming it here is what prevents selectors inside --code from being parsed.
      if (token !== '--code' && String(value).startsWith('--')) {
        throw new Error(missingValue(token, value));
      }
      if (token !== '--code' && !String(value).trim()) throw new Error(missingValue(token));
      values.set(token, value);
      i += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      if (booleans.has(token)) throw new Error(`${token} may be passed only once`);
      booleans.add(token);
      continue;
    }
    unknown.push(token);
  }

  return Object.freeze({
    has: (name) => booleans.has(name) || values.has(name),
    value: (name) => values.has(name) ? values.get(name) : null,
    unknown: Object.freeze(unknown.slice()),
    argvFor: (names) => {
      const out = [];
      for (const name of names) {
        if (values.has(name)) out.push(name, values.get(name));
        else if (booleans.has(name)) out.push(name);
      }
      return out;
    },
  });
}

export function assertCliArgs(parsed) {
  const execution = parsed.has('--code') || parsed.has('--code-file');
  const modes = ['--enable-browse', '--install-mcp', '--doctor'].filter((name) => parsed.has(name));
  if (modes.length + Number(execution) > 1) throw new Error('choose one CLI mode: execution, --doctor, --enable-browse, or --install-mcp');
  const mode = execution ? 'execution' : modes[0] || 'usage';
  if (parsed.unknown.length) {
    throw new Error(`unknown ${mode} argument(s): ${parsed.unknown.join(', ')}`);
  }
  if (parsed.has('--code') && parsed.has('--code-file')) {
    throw new Error('pass exactly one of --code or --code-file');
  }
  const allowed = new Set({
    execution: ['--account', '--code', '--code-file', '--config', '--cwd', '--host', '--timeout-ms'],
    '--enable-browse': ['--enable-browse', '--json'],
    '--install-mcp': ['--install-mcp', '--account', '--json', '--force', '--no-discovery'],
    '--doctor': ['--doctor', '--browse', '--config', '--cwd', '--json'],
    usage: ['--config', '--cwd'],
  }[mode]);
  const wrong = [...VALUE_FLAGS, ...BOOLEAN_FLAGS].filter((name) => parsed.has(name) && !allowed.has(name));
  if (wrong.length) throw new Error(`unsupported ${mode} flag(s): ${wrong.join(', ')}`);
}
