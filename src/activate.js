// Activation without a GUI: the daemon owns the live copy of settings.
//
// The installer can write ~/.aside/u/<n>/settings.json, and the omit-both-keys recipe does
// queue Aside's legacy discovery, but the daemon holds its own copy and a file written
// underneath it stays invisible until something makes it re-read. That was the last manual
// step in this install path, and it is the step a script cannot perform.
//
// Measured 2026-09-17 against Aside CLI 1.26.906.1630: `aside repl` runs inside the daemon
// and exposes aside.settings.get/getAll/set. set('mcp', value) stores exactly the object it
// is handed - a set whose value omits toolInventoryMigrationVersion and inventories was
// read back as version 0 with an empty inventory map - and the write lands in the copy the
// daemon is already using. One ordinary session then runs discovery: a probe server added
// this way, and the server that was already registered, both came back with their tools
// cached and the version back at 1, with no settings window opened and no daemon restart.
//
// An unchanged value is a no-op: the first measured set re-sent the existing servers map
// and the file kept its version and inventories, which is why activation has to change the
// entry (or be forced) to mean anything.
import path from 'node:path';

export const SETTINGS_KEY = 'mcp';

// The session exists only to make the daemon perform discovery, so it must not ask the
// model for work: a prompt that browses would spend a real session on a side effect.
export const DISCOVERY_PROMPT = 'Reply with the single word ok and do nothing else.';

export const ACTIVATION_BLOCKED_REASON = 'another enabled MCP server would lose its cached inventory';

/**
 * The JavaScript handed to `aside repl`. It decides inside the daemon, because the
 * installer's view of settings.json is exactly the stale view this path exists to avoid.
 */
export function renderActivationScript({ server, entry, force = false }) {
  if (!server || typeof server !== 'string') throw new TypeError('renderActivationScript needs a server name');
  if (!entry || typeof entry !== 'object') throw new TypeError('renderActivationScript needs a server entry');
  const name = JSON.stringify(server);
  const value = JSON.stringify(entry);
  return [
    'const NAME = ' + name + ';',
    'const ENTRY = ' + value + ';',
    'const FORCE = ' + (force ? 'true' : 'false') + ';',
    'const s = await aside.settings.getAll();',
    'const mcp = (s && s.mcp) || {};',
    'const servers = Object.assign({}, mcp.servers || {});',
    'const inventories = mcp.inventories || {};',
    // set() replaces the whole mcp object, so every other server's cached inventory goes
    // with it and has to be rediscovered. Aside's migration disables a server it cannot
    // reach and never retries, so a server that is merely offline right now would be
    // switched off by our install. That is somebody else's tool, not ours to spend.
    'const atRisk = Object.keys(servers).filter((n) => n !== NAME && servers[n] && servers[n].enabled === true);',
    'const cached = Object.keys(inventories).filter((n) => n !== NAME);',
    'if ((atRisk.length || cached.length) && !FORCE) {',
    '  console.log(JSON.stringify({ ok: false, reason: "at-risk-servers", atRisk, cached }));',
    '} else {',
    '  servers[NAME] = ENTRY;',
    '  await aside.settings.set("mcp", { servers });',
    '  const after = await aside.settings.getAll();',
    '  const m = (after && after.mcp) || {};',
    '  console.log(JSON.stringify({ ok: true, wrote: NAME, servers: Object.keys(m.servers || {}),',
    '    version: Object.prototype.hasOwnProperty.call(m, "toolInventoryMigrationVersion") ? m.toolInventoryMigrationVersion : null,',
    '    inventories: Object.keys(m.inventories || {}) }));',
    '}',
  ].join('\n');
}

/** The two commands, in order, that carry an entry from a script into a cached inventory. */
export function planActivation({ asideCli = 'aside', account = null, server, entry, force = false }) {
  const accountArgs = account ? ['--account', normalizeAccount(account)] : [];
  return [
    { step: 'settings-set', cmd: asideCli, args: [...accountArgs, 'repl', renderActivationScript({ server, entry, force })] },
    { step: 'discovery-session', cmd: asideCli, args: [...accountArgs, 'exec', DISCOVERY_PROMPT] },
  ];
}

// u1 and 1 name the same profile; the CLI only accepts the u-form.
export function normalizeAccount(account) {
  const id = String(account).trim();
  return /^u/.test(id) ? id : 'u' + id;
}

/** The entry this installation should be registered as, from the paths it actually runs from. */
export function normalizedServerEntry({ execPath, repoRoot }) {
  return {
    enabled: true,
    transport: 'stdio',
    command: execPath,
    args: [path.join(repoRoot, 'src', 'server.js'), '--config', path.join(repoRoot, 'codemode.config.json')],
    env: {},
  };
}

function parseReplJson(stdout) {
  // aside repl prints a timing line of its own, and console.log output is what we asked for,
  // so the answer is the last line that parses as the object we printed.
  const lines = String(stdout ?? '').split(/\r?\n/).reverse();
  for (const line of lines) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && 'ok' in value) return value;
    } catch { /* not our line */ }
  }
  return null;
}

/**
 * Register and activate in one call. `run` is injected so this is testable without a daemon;
 * `readInventory` is injected because the proof of activation is the file, not our own report.
 */
export async function activateMcp({
  server = 'aside-codemode', entry, account = null, asideCli = 'aside',
  force = false, discover = true, run, readInventory = null,
}) {
  if (typeof run !== 'function') throw new TypeError('activateMcp needs a run(cmd, args) function');
  const steps = [];
  const plan = planActivation({ asideCli, account, server, entry, force });

  const set = await run(plan[0].cmd, plan[0].args);
  const parsed = parseReplJson(set && set.stdout);
  steps.push({ step: 'settings-set', code: set ? set.code : null, parsed });
  if (!set || set.code !== 0) {
    return fail(steps, 'aside repl failed', set && set.stderr ? String(set.stderr).trim() : null, { cliMissing: Boolean(set && set.cliMissing) });
  }
  if (!parsed) return fail(steps, 'aside repl returned no parseable result', null, {});
  if (parsed.ok === false) {
    return fail(steps, ACTIVATION_BLOCKED_REASON, null, {
      atRisk: parsed.atRisk ?? [], cached: parsed.cached ?? [], blocked: true,
    });
  }

  if (!discover) {
    return { ok: true, activated: false, registered: true, discoveryRan: false, steps, tools: null,
      next: 'Start any Aside session to let discovery cache the inventory.' };
  }

  const session = await run(plan[1].cmd, plan[1].args);
  steps.push({ step: 'discovery-session', code: session ? session.code : null });
  if (!session || session.code !== 0) {
    return fail(steps, 'the discovery session failed', session && session.stderr ? String(session.stderr).trim() : null, { registered: true });
  }

  const tools = typeof readInventory === 'function' ? await readInventory() : null;
  const activated = Array.isArray(tools) ? tools.length > 0 : null;
  return {
    ok: activated !== false,
    registered: true,
    activated,
    discoveryRan: true,
    steps,
    tools,
    next: activated === false
      ? 'Discovery ran but cached no tools. Check that the command in the entry starts and speaks MCP.'
      : null,
  };
}

function fail(steps, error, detail, extra) {
  return { ok: false, registered: false, activated: false, discoveryRan: false, steps, tools: null, error, detail: detail || null, ...extra };
}
