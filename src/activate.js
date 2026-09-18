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
import { existsSync } from 'node:fs';
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
    // Dropping the two keys makes Aside rediscover every registered server, and a server it
    // cannot reach during that pass is disabled and never retried. So the risk is any other
    // server that is not explicitly switched off: absent `enabled` is not proof of disabled,
    // and treating it as such would have let our install silently kill someone else's tool.
    'const atRisk = Object.keys(servers).filter((n) => n !== NAME && servers[n] && servers[n].enabled !== false);',
    'const cached = Object.keys(inventories).filter((n) => n !== NAME);',
    'if ((atRisk.length || cached.length) && !FORCE) {',
    '  console.log(JSON.stringify({ codemodeActivation: 1, ok: false, reason: "at-risk-servers", atRisk, cached }));',
    '} else {',
    '  servers[NAME] = ENTRY;',
    // Everything else under mcp belongs to Aside or to the user. An earlier version of this
    // script sent { servers } and nothing else, which would have deleted any other key the
    // object carried; only the two discovery keys are ours to remove.
    '  const next = Object.assign({}, mcp);',
    '  next.servers = servers;',
    '  delete next.toolInventoryMigrationVersion;',
    '  delete next.inventories;',
    '  await aside.settings.set("mcp", next);',
    '  const after = await aside.settings.getAll();',
    '  const m = (after && after.mcp) || {};',
    '  console.log(JSON.stringify({ codemodeActivation: 1, ok: true, wrote: NAME, servers: Object.keys(m.servers || {}),',
    '    version: Object.prototype.hasOwnProperty.call(m, "toolInventoryMigrationVersion") ? m.toolInventoryMigrationVersion : null,',
    '    inventories: Object.keys(m.inventories || {}), keys: Object.keys(m).sort(),',
    '    before: mcp }));',
    // The snapshot leaves the daemon with the answer, because the account this write is about
    // to change is the only place that still knows what it looked like. The host keeps it, and
    // an abort writes it straight back.
    '}',
  ].join('\n');
}

export const RESTORE_MODES = Object.freeze(['full', 'enabled']);

/**
 * The script that puts things back.
 *
 * full is the abort: the snapshot goes back exactly as it was, because the run learned
 * nothing and the account should look untouched. enabled is the success path, and it moves one
 * field. Aside disables a server it could not reach during discovery and never retries it, so
 * the switch is the part nobody else will turn back on. The cached inventory is deliberately
 * not restored: writing Aside's tool cache by hand is the one thing this installer has always
 * refused to do, and the next session rebuilds it anyway.
 */
// The repl refuses a script that mentions a module loader, and the snapshot carries this
// project's own tool description, which explains that import() and require do not exist in the
// guest. Embedding it verbatim was measured failing with "External modules are not available
// in the REPL", so the payload travels encoded and is decoded inside the daemon.
function encodePayload(value) {
  return 'JSON.parse(atob(' + JSON.stringify(Buffer.from(JSON.stringify(value), 'utf8').toString('base64')) + '))';
}

export function renderRestoreScript({ snapshot, mode = 'enabled', server = 'aside-codemode' }) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('renderRestoreScript needs the snapshot taken before the write');
  if (!RESTORE_MODES.includes(mode)) throw new TypeError('renderRestoreScript mode must be one of: ' + RESTORE_MODES.join(', '));
  const snap = encodePayload(snapshot);
  const name = JSON.stringify(server);
  if (mode === 'full') {
    return [
      'const SNAPSHOT = ' + snap + ';',
      'await aside.settings.set("mcp", SNAPSHOT);',
      'const after = await aside.settings.getAll();',
      'const m = (after && after.mcp) || {};',
      'console.log(JSON.stringify({ codemodeActivation: 1, ok: true, mode: "full",',
      '  servers: Object.keys(m.servers || {}), inventories: Object.keys(m.inventories || {}),',
      '  version: Object.prototype.hasOwnProperty.call(m, "toolInventoryMigrationVersion") ? m.toolInventoryMigrationVersion : null }));',
    ].join(String.fromCharCode(10));
  }
  return [
    'const SNAPSHOT = ' + snap + ';',
    'const NAME = ' + name + ';',
    'const s = await aside.settings.getAll();',
    'const mcp = (s && s.mcp) || {};',
    'const servers = Object.assign({}, mcp.servers || {});',
    'const was = (SNAPSHOT && SNAPSHOT.servers) || {};',
    'const wasInv = (SNAPSHOT && SNAPSHOT.inventories) || {};',
    'const nowInv = mcp.inventories || {};',
    'const restored = [];',
    'for (const n of Object.keys(was)) {',
    '  if (n === NAME) continue;',
    // An absent enabled field is how a server says nothing, and discovery only ever writes
    // the explicit false. So the ones to turn back on are those that were not explicitly off
    // and are explicitly off now.
    '  const before = was[n] && was[n].enabled !== false;',
    '  const now = servers[n] && servers[n].enabled !== false;',
    '  if (before && !now && servers[n]) {',
    '    servers[n] = Object.assign({}, servers[n], { enabled: true });',
    '    restored.push(n);',
    '  }',
    '}',
    'const lostInventories = Object.keys(wasInv).filter((n) => n !== NAME && !nowInv[n]);',
    'if (restored.length) {',
    '  const next = Object.assign({}, mcp);',
    '  next.servers = servers;',
    '  await aside.settings.set("mcp", next);',
    '}',
    'const after = await aside.settings.getAll();',
    'const m = (after && after.mcp) || {};',
    'const stillOff = Object.keys(was).filter((n) => n !== NAME && was[n] && was[n].enabled !== false && m.servers && m.servers[n] && m.servers[n].enabled === false);',
    'console.log(JSON.stringify({ codemodeActivation: 1, ok: stillOff.length === 0, mode: "enabled",',
    '  restored, lostInventories, stillOff }));',
  ].join(String.fromCharCode(10));
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

/**
 * The entry this installation should be registered as, from the paths it actually runs from.
 *
 * `--config` is only named when that file is there. A globally installed package ships
 * codemode.config.example.json and no codemode.config.json, and the server treats a config
 * it was told to read but cannot as fatal: measured on Windows, the entry pointing at the
 * missing file made every discovery pass cache nothing while the daemon reported success.
 * Without the flag the server falls back to the user config and then to built-in defaults,
 * where an empty roots list becomes the home directory.
 */
export function normalizedServerEntry({ execPath, repoRoot, configPath = null, exists = existsSync }) {
  const config = configPath ?? path.join(repoRoot, 'codemode.config.json');
  const args = [path.join(repoRoot, 'src', 'server.js')];
  if (exists(config)) args.push('--config', config);
  return {
    enabled: true,
    transport: 'stdio',
    command: execPath,
    args,
    env: {},
  };
}

function parseReplJson(stdout) {
  // aside repl prints a timing line of its own, and the repl is a general JavaScript host, so
  // "some line that parses as JSON with an ok field" is not identification. The script tags
  // its own answer and nothing else is accepted as one.
  const lines = String(stdout ?? '').split(/\r?\n/).reverse();
  for (const line of lines) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && value.codemodeActivation === 1 && 'ok' in value) return value;
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
  force = false, discover = true, run, readInventory = null, requireTool = 'execute_code',
  onSnapshot = null, readState = null,
  settleTimeoutMs = 15000, settleIntervalMs = 250,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
  // The daemon's own read-back is the only evidence that the write did what it was for. A
  // migration version still present means discovery was not reset, and a session started on
  // that state would report success while attaching nothing new.
  if (parsed.wrote !== server || !(Array.isArray(parsed.servers) && parsed.servers.includes(server))) {
    return fail(steps, 'the daemon did not read back the server we registered', JSON.stringify(parsed), {});
  }
  if (!(parsed.version === null || parsed.version === 0)) {
    return fail(steps, 'the tool-inventory migration was not reset, so discovery will not run', 'version=' + String(parsed.version), {});
  }

  // What the account looked like a moment ago. The daemon is the only thing that still knew,
  // and from here on every failure has somewhere to go back to.
  const snapshot = parsed.before && typeof parsed.before === 'object' ? parsed.before : null;
  const others = snapshot && snapshot.servers
    ? Object.keys(snapshot.servers).filter((n) => n !== server)
    : [];
  if (snapshot && typeof onSnapshot === 'function') {
    try { await onSnapshot(snapshot); } catch { /* a backup we could not write is not a reason to stop */ }
  }

  const accountArgs = account ? ['--account', normalizeAccount(account)] : [];
  const restore = async (mode) => {
    if (!snapshot) return null;
    const res = await run(asideCli, [...accountArgs, 'repl', renderRestoreScript({ snapshot, mode, server })]);
    const answer = parseReplJson(res && res.stdout);
    steps.push({ step: 'restore-' + mode, code: res ? res.code : null, parsed: answer });
    return answer;
  };

  if (!discover) {
    return { ok: true, activated: false, registered: true, discoveryRan: false, steps, tools: null,
      next: 'Start any Aside session to let discovery cache the inventory.' };
  }

  const session = await run(plan[1].cmd, plan[1].args);
  steps.push({ step: 'discovery-session', code: session ? session.code : null });
  if (!session || session.code !== 0) {
    // Nothing was learned, so the account goes back exactly as it was.
    const back = await restore('full');
    return fail(steps, 'the discovery session failed', session && session.stderr ? String(session.stderr).trim() : null,
      { registered: false, rolledBack: Boolean(back && back.ok) });
  }

  // The session process exits before Aside finishes the migration it started. Measured on
  // macOS: our write landed at 1.2s and the migration wrote its result at 2.0s, disabling the
  // server it could not reach. A restore that ran in between compared against a state where
  // nothing had been switched off yet and reported, truthfully and uselessly, that there was
  // nothing to restore. So the migration version coming back is what says the pass is over.
  let settled = null;
  if (typeof readState === 'function') {
    const started = Date.now();
    // The version key alone cannot say the pass is over: it reads the same before the write
    // and after the migration. What only the migration produces is a new refreshedAt on this
    // server's cached inventory, so that is the marker, with the version key as the fallback
    // for an account that had no inventory to begin with.
    const priorRefreshedAt = snapshot && snapshot.inventories && snapshot.inventories[server]
      ? snapshot.inventories[server].refreshedAt || null
      : null;
    const done = (state) => {
      if (!state) return false;
      if (state.version === null || state.version === undefined) return false;
      if (priorRefreshedAt === null) return true;
      return Boolean(state.refreshedAt) && state.refreshedAt !== priorRefreshedAt;
    };
    while (Date.now() - started < settleTimeoutMs) {
      settled = await readState();
      if (done(settled)) break;
      await wait(settleIntervalMs);
    }
    steps.push({ step: 'settle', ms: Date.now() - started, settled: done(settled) });
  }

  const tools = typeof readInventory === 'function' ? await readInventory() : null;
  // A cached inventory is not the same as ours being in it. Counting any tool as success
  // would call an install activated because some other server answered.
  const activated = Array.isArray(tools)
    ? (requireTool ? tools.includes(requireTool) : tools.length > 0)
    : null;
  if (activated === false) {
    // The write did not buy anything, so it does not get to keep the cost either.
    const back = await restore('full');
    return fail(steps, 'discovery ran but ' + (requireTool || 'no tool') + ' is not in the cached inventory', null,
      { registered: true, discoveryRan: true, tools, rolledBack: Boolean(back && back.ok),
        next: 'Check that the command in the entry starts and speaks MCP.' });
  }

  // Success, and the only thing owed to the other servers is the switch. Their caches come
  // back on their own; a server Aside turned off does not.
  const restored = others.length ? await restore('enabled') : null;
  return {
    ok: activated !== false && (!restored || restored.ok !== false),
    registered: true,
    activated,
    discoveryRan: true,
    steps,
    tools,
    restored: restored ? restored.restored || [] : [],
    lostInventories: restored ? restored.lostInventories || [] : [],
    stillOff: restored ? restored.stillOff || [] : [],
    next: restored && restored.stillOff && restored.stillOff.length
      ? 'Aside disabled these servers during discovery and they could not be switched back on: '
        + restored.stillOff.join(', ') + '. The settings backup this run wrote has their original state.'
      : null,
  };
}

function fail(steps, error, detail, extra) {
  return { ok: false, registered: false, activated: false, discoveryRan: false, steps, tools: null, error, detail: detail || null, ...extra };
}
