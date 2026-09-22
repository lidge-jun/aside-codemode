// Browser execution routing context validation and argv generation.
// Enforces per-execution routing for CLI (--account uN, --host host) and MCP execute_code.
import { createHash } from 'node:crypto';

export function normalizeAccount(id) {
  if (id === null || id === undefined) return null;
  const s = String(id).trim();
  if (!s) return null;
  return s.startsWith('u') ? s : 'u' + s;
}

export function validateAccount(account) {
  if (account === null || account === undefined) return null;
  if (typeof account !== 'string' && typeof account !== 'number') {
    throw new TypeError('--account must be a string or number, got ' + typeof account);
  }
  const s = String(account).trim();
  if (!s) {
    throw new Error('--account needs an account id, for example --account u1');
  }
  if (s.startsWith('--')) {
    throw new Error('--account needs an account id, for example --account u1');
  }
  if (!/^u?\d+$/.test(s)) {
    throw new Error('--account must be an Aside profile id like u1, not ' + JSON.stringify(s));
  }
  return normalizeAccount(s);
}

export function validateHost(host) {
  if (host === null || host === undefined) return null;
  if (typeof host !== 'string') {
    throw new TypeError('--host must be a string, got ' + typeof host);
  }
  const s = host.trim();
  if (!s) {
    throw new Error('--host cannot be empty');
  }
  if (s.startsWith('--')) {
    throw new Error('--host requires a value, for example --host local');
  }
  // Native Aside validates host identity ('local', remote ID, or device name).
  // Do not resolve or fake unknown names here.
  return s;
}

export function routingReport(routing) {
  if (!routing) {
    return {
      account: null,
      host: null,
      accountSource: 'inherited',
      hostSource: 'inherited',
      explicitAccount: false,
      explicitHost: false,
    };
  }
  const account = routing.account ?? null;
  const host = routing.host ?? null;
  const accountSource = routing.accountSource || (account ? 'explicit' : 'inherited');
  const hostSource = routing.hostSource || (host ? 'explicit' : 'inherited');
  return {
    account,
    host,
    accountSource,
    hostSource,
    explicitAccount: accountSource === 'explicit' || Boolean(routing.explicitAccount),
    explicitHost: hostSource === 'explicit' || Boolean(routing.explicitHost),
  };
}

export function browserContextToArgv(context) {
  if (!context) return [];
  const args = [];
  if (context.account) {
    args.push('--account', context.account);
  }
  if (context.host) {
    args.push('--host', context.host);
  }
  return args;
}

const OPT_WITH_VALUE = new Set([
  '--code',
  '--code-file',
  '--config',
  '--timeout-ms',
  '--cwd',
  '--account',
  '--host',
]);

export function parseExecutionArgv(argv = []) {
  const flags = new Map();
  let i = 0;

  while (i < argv.length) {
    const token = argv[i];
    if (token === '--') {
      i++;
      if (i < argv.length) {
        throw new Error(`unexpected argument: ${argv[i]}`);
      }
      break;
    }

    if (token.startsWith('--')) {
      if (!OPT_WITH_VALUE.has(token)) {
        throw new Error(`unknown execution flag: ${token}`);
      }
      if (flags.has(token)) {
        throw new Error(`duplicate flag: ${token}`);
      }
      if (i + 1 >= argv.length) {
        if (token === '--account') throw new Error('--account needs an account id, for example --account u1');
        if (token === '--host') throw new Error('--host requires a value, for example --host local');
        if (token === '--code') throw new Error('--code requires a code string or "-" for stdin');
        if (token === '--code-file') throw new Error('--code-file requires a file path');
        if (token === '--config') throw new Error('--config requires a file path');
        if (token === '--timeout-ms') throw new Error('--timeout-ms requires an integer value');
        if (token === '--cwd') throw new Error('--cwd requires a directory path');
        throw new Error(`${token} requires a value`);
      }
      const val = argv[i + 1];
      // For flags other than --code, a value starting with -- that matches known flags is a missing value error
      if (token !== '--code' && val.startsWith('--') && (OPT_WITH_VALUE.has(val) || val.length > 2)) {
        if (token === '--account') throw new Error('--account needs an account id, for example --account u1');
        if (token === '--host') throw new Error('--host requires a value, for example --host local');
        if (token === '--code-file') throw new Error('--code-file requires a file path');
        if (token === '--config') throw new Error('--config requires a file path');
        if (token === '--timeout-ms') throw new Error('--timeout-ms requires an integer value');
        if (token === '--cwd') throw new Error('--cwd requires a directory path');
      }
      flags.set(token, val);
      i += 2;
    } else {
      throw new Error(`unexpected argument: ${token}`);
    }
  }

  if (flags.has('--account')) {
    validateAccount(flags.get('--account'));
  }
  if (flags.has('--host')) {
    validateHost(flags.get('--host'));
  }

  return flags;
}

export function validateExecutionArgv(argv = []) {
  parseExecutionArgv(argv);
}

export function parseBrowserContextFromArgv(argv = []) {
  try {
    const flags = parseExecutionArgv(argv);
    const account = flags.has('--account') ? validateAccount(flags.get('--account')) : null;
    const host = flags.has('--host') ? validateHost(flags.get('--host')) : null;
    return {
      account,
      host,
      explicitAccount: flags.has('--account'),
      explicitHost: flags.has('--host'),
    };
  } catch {
    // Fallback for non-execution argv scanning (e.g. doctor)
    let account = null;
    let host = null;
    let explicitAccount = false;
    let explicitHost = false;

    const acctIdx = argv.indexOf('--account');
    if (acctIdx !== -1) {
      account = validateAccount(argv[acctIdx + 1]);
      explicitAccount = true;
    }

    const hostIdx = argv.indexOf('--host');
    if (hostIdx !== -1) {
      host = validateHost(argv[hostIdx + 1]);
      explicitHost = true;
    }

    return { account, host, explicitAccount, explicitHost };
  }
}

export function resolveBrowserContext({ argv, parsedFlags, mcpArgs, config } = {}) {
  let explicitAccount = false;
  let explicitHost = false;
  let account = null;
  let host = null;

  if (parsedFlags instanceof Map) {
    if (parsedFlags.has('--account')) {
      account = validateAccount(parsedFlags.get('--account'));
      explicitAccount = true;
    }
    if (parsedFlags.has('--host')) {
      host = validateHost(parsedFlags.get('--host'));
      explicitHost = true;
    }
  } else if (Array.isArray(argv)) {
    const parsed = parseBrowserContextFromArgv(argv);
    if (parsed.explicitAccount) {
      account = parsed.account;
      explicitAccount = true;
    }
    if (parsed.explicitHost) {
      host = parsed.host;
      explicitHost = true;
    }
  }

  if (mcpArgs && typeof mcpArgs === 'object') {
    if ('account' in mcpArgs && mcpArgs.account !== undefined) {
      if (mcpArgs.account === null || typeof mcpArgs.account !== 'string') {
        const err = new Error('account must be a string');
        err.invalidParams = true;
        throw err;
      }
      account = validateAccount(mcpArgs.account);
      explicitAccount = true;
    }
    if ('host' in mcpArgs && mcpArgs.host !== undefined) {
      if (mcpArgs.host === null || typeof mcpArgs.host !== 'string') {
        const err = new Error('host must be a string');
        err.invalidParams = true;
        throw err;
      }
      host = validateHost(mcpArgs.host);
      explicitHost = true;
    }
  }

  const cfgCtx = config && config.browseContext;
  let accountSource = explicitAccount ? 'explicit' : 'inherited';
  let hostSource = explicitHost ? 'explicit' : 'inherited';

  if (!explicitAccount && cfgCtx && cfgCtx.account) {
    account = validateAccount(cfgCtx.account);
    accountSource = 'config';
  }

  if (!explicitHost && cfgCtx && cfgCtx.host) {
    host = validateHost(cfgCtx.host);
    hostSource = 'config';
  }

  return {
    account,
    host,
    accountSource,
    hostSource,
    explicitAccount,
    explicitHost,
  };
}

export function buildCacheIdentity(baseAccountRoot, browserContext) {
  const routing = routingReport(browserContext);
  const tuple = [
    'v1',
    String(baseAccountRoot || ''),
    routing.accountSource,
    routing.account,
    routing.hostSource,
    routing.host,
  ];
  const hash = createHash('sha256').update(JSON.stringify(tuple)).digest('hex').slice(0, 32);
  return `${baseAccountRoot}#ctx=${hash}`;
}
