#!/usr/bin/env node
// Installs code mode into an Aside account root, and can take it back out.
//
//   node scripts/install-codemode.mjs <install|upgrade|repair|uninstall|rollback|doctor>
//        [--aside-home <path>] [--account <id>] [--json] [--dry-run]
//
// What it may touch is a closed list. The manifest owns a handful of files under the
// account root, plus the markered block inside AGENTS.md that register.js already writes.
// Aside's own preferences, account credentials, skills/builtin, conversations and other
// projects' instructions are not ours and are never opened.
//
// The rule that makes reinstalling safe: before writing a file, its hash is compared with
// what the manifest says was installed. A file that no longer matches was edited by the
// user, and it is kept and named rather than overwritten.
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, writeFileSync, unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperSource, helperLoadPathFor, HELPER_VERSION } from '../src/host/browse/helper-bundle.js';
import { createActions } from '../src/host/actions.js';
import {
  configureMcpActivation, listAccountRoots, upsertAgents, fillTemplate,
  MCP_ACTIVATION_REQUIRED,
} from '../src/register.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_RELPATH = 'codemode/manifest.json';
const SKILL_DIR = 'skills/user/aside-codemode';
const START = '<!-- aside-codemode:start -->';
const END = '<!-- aside-codemode:end -->';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function flag(name) { return process.argv.includes(name); }
function opt(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// One filler, shared with register.js, so the two writers of the managed block cannot drift.
const fill = fillTemplate;

// The markered block, filled for one account. Exported so a test can read what an account
// would actually be handed without writing to a real account root.
export function agentsBody({ node, cli, accountRoot }) {
  return fill(readFileSync(path.join(REPO_ROOT, 'templates', 'AGENTS.codemode.md'), 'utf8'), { node, cli, accountRoot });
}

// Every file the install owns, with its content already resolved. Keeping content and
// ownership in one list is what lets install, repair and uninstall share a definition
// instead of three that drift.
export function plannedFiles({ node, cli, accountRoot, version = HELPER_VERSION } = {}) {
  const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  const actions = createActions();
  const catalog = {
    schema: 'codemode-catalog/1',
    version,
    generatedAt: null,
    actions: actions.list().map((rec) => ({
      path: rec.path, signature: rec.signature, description: rec.description,
      inputs: Object.fromEntries(Object.entries(rec.inputs || {}).map(([k, v]) => [k, { type: v.type, required: Boolean(v.required) }])),
    })),
  };
  return [
    { path: 'codemode/cm.js', content: helperSource(version).src },
    { path: 'codemode/catalog.json', content: JSON.stringify(catalog, null, 2) + '\n' },
    { path: SKILL_DIR + '/SKILL.md', content: fill(read('templates/skill/SKILL.md'), { node, cli, accountRoot }) },
    { path: SKILL_DIR + '/references/execution-paths.md', content: fill(read('templates/skill/references/execution-paths.md'), { node, cli, accountRoot }) },
    { path: SKILL_DIR + '/references/windows-invocation.md', content: fill(read('templates/skill/references/windows-invocation.md'), { node, cli, accountRoot }) },
    { path: SKILL_DIR + '/references/call-shapes.md', content: fill(read('templates/skill/references/call-shapes.md'), { node, cli, accountRoot }) },
  ];
}

export function readManifest(accountRoot) {
  const p = path.join(accountRoot, MANIFEST_RELPATH);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// modified | missing | same | new, from the manifest's point of view. A file the manifest
// does not know about is new even when something is already there: we did not put it there,
// so we do not get to call it ours.
export function inspectFile(accountRoot, rel, manifest) {
  const abs = path.join(accountRoot, rel);
  const known = manifest && Array.isArray(manifest.files)
    ? manifest.files.find((f) => f.path === rel) : null;
  if (!existsSync(abs)) return { rel, abs, state: known ? 'missing' : 'new', known: Boolean(known) };
  const actual = sha256(readFileSync(abs, 'utf8'));
  if (!known) return { rel, abs, state: 'new', known: false, actual };
  return { rel, abs, state: actual === known.sha256 ? 'same' : 'modified', known: true, actual, recorded: known.sha256 };
}

function writeFile(abs, content, dryRun) {
  if (dryRun) return;
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function agentsBlockState(accountRoot, body) {
  const p = path.join(accountRoot, 'AGENTS.md');
  if (!existsSync(p)) return 'absent';
  const text = readFileSync(p, 'utf8');
  const start = text.indexOf(START);
  if (start === -1) return 'absent';
  const end = text.indexOf(END, start);
  if (end === -1) return 'stale';
  return text.slice(start + START.length, end).trim() === body.trim() ? 'current' : 'stale';
}

function mcpServerEntryState(accountRoot) {
  const settingsPath = path.join(accountRoot, 'settings.json');
  if (!existsSync(settingsPath)) return 'absent';
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return settings && settings.mcp && settings.mcp.servers
      && settings.mcp.servers['aside-codemode'] ? 'unchanged' : 'absent';
  } catch {
    return 'absent';
  }
}

function applyWrites(accountRoot, files, manifest, { dryRun, onlyMissing }) {
  const written = [];
  const preserved = [];
  const skipped = [];
  const adopted = [];
  for (const file of files) {
    const seen = inspectFile(accountRoot, file.path, manifest);
    const wanted = sha256(file.content);
    if (onlyMissing && seen.state !== 'missing') { skipped.push(seen); continue; }
    // Already exactly what we would write. Claiming it as a user edit and refusing to record
    // it leaves the manifest wrong about a file that is right, which is how a later repair
    // decides there is nothing to repair. Checked after the repair filter, so repair still
    // reports an untouched file as skipped rather than rewritten.
    if (seen.actual === wanted) {
      if (!seen.known) adopted.push(seen);
      written.push({ path: file.path, sha256: wanted });
      continue;
    }
    if (seen.state === 'modified') { preserved.push(seen); continue; }
    // A file we never installed, already sitting in our path, is also the user's.
    if (seen.state === 'new' && seen.actual !== undefined && !seen.known) { preserved.push(seen); continue; }
    writeFile(seen.abs, file.content, dryRun);
    written.push({ path: file.path, sha256: wanted });
  }
  return { written, preserved, skipped, adopted };
}

// Arguments in, result out. The argv parsing lives at the entry point so a test can drive
// every verb against a temporary account root without staging a process.
export function runInstaller({ verb = 'doctor', asideHome, account = null, dryRun = false } = {}) {
  const wantAccount = account;

  const { roots } = listAccountRoots({ asideHome, only: wantAccount ? [wantAccount] : undefined });
  const chosen = roots.find((r) => r.current) || roots[0];
  const accountRoot = chosen.root;
  const node = process.execPath;
  const cli = path.join(REPO_ROOT, 'bin', 'codemode.mjs');
  const body = agentsBody({ node, cli, accountRoot });
  const files = plannedFiles({ node, cli, accountRoot });
  const manifest = readManifest(accountRoot);
  const manifestPath = path.join(accountRoot, MANIFEST_RELPATH);

  const base = {
    verb,
    account: chosen.id,
    accountRoot,
    version: HELPER_VERSION,
    dryRun,
    filesInstalled: Boolean(manifest),
    serverEntry: mcpServerEntryState(accountRoot),
    mcpActivated: false,
    activationPending: false,
    activationPendingReason: null,
    discoveryQueued: false,
    atRiskServers: [],
    activationRequired: MCP_ACTIVATION_REQUIRED,
  };

  if (verb === 'doctor') {
    return {
      ...base,
      installed: Boolean(manifest),
      installedVersion: manifest ? manifest.version : null,
      hasPrevious: Boolean(manifest && manifest.previous),
      // A machine a release left behind is not healthy. The manifest agreeing with the disk
      // only says nobody edited the files since they were written; it says nothing about
      // whether those are the bytes this build ships.
      upToDate: Boolean(manifest) && files.every((f) => inspectFile(accountRoot, f.path, manifest).actual === sha256(f.content)),
      files: files.map((f) => {
        const seen = inspectFile(accountRoot, f.path, manifest);
        const agreesWithManifest = seen.state === 'same';
        const isCurrentBuild = seen.actual === sha256(f.content);
        const ok = agreesWithManifest && isCurrentBuild;
        const reason = ok ? 'matches the manifest'
          : agreesWithManifest ? 'stale'
            : seen.state;
        return { path: f.path, ok, reason };
      }),
      agentsBlock: agentsBlockState(accountRoot, body),
    };
  }

  if (verb === 'uninstall') {
    if (!manifest) return { ...base, filesInstalled: false, removed: [], preserved: [], note: 'nothing was installed here' };
    const removed = [];
    const preserved = [];
    for (const known of manifest.files || []) {
      const seen = inspectFile(accountRoot, known.path, manifest);
      if (seen.state === 'missing') continue;
      if (seen.state === 'modified') { preserved.push(seen.rel); continue; }
      if (!dryRun) unlinkSync(seen.abs);
      removed.push(known.path);
    }
    // The block goes, the file stays. AGENTS.md is the user's document; we only ever owned
    // what is between the two markers.
    const agentsPath = path.join(accountRoot, 'AGENTS.md');
    let agentsBlock = 'absent';
    if (existsSync(agentsPath)) {
      const text = readFileSync(agentsPath, 'utf8');
      const start = text.indexOf(START);
      const end = text.indexOf(END, start);
      if (start > -1 && end > -1) {
        if (!dryRun) writeFileSync(agentsPath, (text.slice(0, start) + text.slice(end + END.length)).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n'), 'utf8');
        agentsBlock = 'removed';
      }
    }
    if (!dryRun && existsSync(manifestPath)) unlinkSync(manifestPath);
    // Only directories we created, and only when they are empty. A skills directory holding
    // something else is not ours to delete.
    for (const dir of [path.join(accountRoot, SKILL_DIR, 'references'), path.join(accountRoot, SKILL_DIR), path.join(accountRoot, 'codemode')]) {
      // rmSync without recursive throws EISDIR on a directory and the catch used to swallow
      // it, so an uninstall left the empty references/ behind on every account. rmdirSync is
      // the call that removes a directory, and it still refuses a non-empty one.
      try { if (!dryRun && existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir); } catch { /* leave it */ }
    }
    return { ...base, filesInstalled: dryRun, removed, preserved, agentsBlock };
  }

  if (verb === 'rollback') {
    const previous = manifest && manifest.previous;
    if (!previous) return { ...base, ok: false, error: 'no previous install to roll back to' };
    // Whole bundle or nothing. A half-rolled-back install is a state nobody can reason about.
    const missing = (previous.files || []).filter((f) => typeof f.content !== 'string');
    if (missing.length) return { ...base, ok: false, error: 'the previous manifest did not keep its contents' };
    const restored = [];
    for (const file of previous.files) {
      writeFile(path.join(accountRoot, file.path), file.content, dryRun);
      restored.push(file.path);
    }
    // A generation that added a file has to lose it again. Restoring only what the snapshot
    // holds leaves the newer file on disk under an older manifest that does not know it,
    // and doctor then calls a file we wrote 'new'. Only untouched ones go: a file whose
    // bytes no longer match the manifest was edited by the user and is theirs to keep.
    const keep = new Set((previous.files || []).map((f) => f.path));
    const dropped = [];
    for (const known of manifest.files || []) {
      if (keep.has(known.path)) continue;
      const seen = inspectFile(accountRoot, known.path, manifest);
      if (seen.state !== 'same') continue;
      if (!dryRun) unlinkSync(seen.abs);
      dropped.push(known.path);
    }
    if (typeof previous.agentsBody === 'string') {
      const agentsPath = path.join(accountRoot, 'AGENTS.md');
      const prev = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
      if (!dryRun) writeFileSync(agentsPath, upsertAgents(prev, previous.agentsBody), 'utf8');
    }
    const rolled = {
      ...previous, previous: null, rolledBackAt: new Date().toISOString(), accountRoot,
      // Hash the bytes being restored. Copying the snapshot's declared hash carries an old
      // disagreement forward: two live accounts had a snapshot that named 1.0.0 while
      // holding 1.1.0, and a rollback that repeated the claim would leave the current
      // manifest lying about the file it had just written.
      files: previous.files.map(({ path: p, content }) => ({ path: p, sha256: sha256(content) })),
    };
    if (!dryRun) writeFile(manifestPath, JSON.stringify(rolled, null, 2) + '\n', dryRun);
    return { ...base, filesInstalled: true, ok: true, restored, dropped, version: previous.version };
  }

  // install | upgrade | repair
  const onlyMissing = verb === 'repair';
  // Read the outgoing generation BEFORE anything is written. Snapshotting afterwards records
  // the bytes we just wrote as the bytes to go back to, which makes rollback a no-op exactly
  // when it matters: an upgrade that actually changed something.
  const outgoing = manifest ? snapshotForRollback(accountRoot, manifest) : null;
  const { written, preserved, skipped, adopted } = applyWrites(accountRoot, files, manifest, { dryRun, onlyMissing });

  let agentsBlock = agentsBlockState(accountRoot, body);
  if (!onlyMissing || agentsBlock !== 'current') {
    const agentsPath = path.join(accountRoot, 'AGENTS.md');
    const prev = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
    if (!dryRun) {
      mkdirSync(accountRoot, { recursive: true });
      writeFileSync(agentsPath, upsertAgents(prev, body), 'utf8');
    }
    agentsBlock = 'current';
  }

  // A file repair left alone keeps whatever the manifest already said about it. Writing the
  // planned hash for a file we did not touch tells the next upgrade that the user edited it,
  // and that upgrade preserves a stale copy forever. Writing the DISK hash is the opposite
  // mistake: a file the user really did edit would start agreeing with the manifest, and the
  // next upgrade would overwrite their work. Keeping the recorded hash is the only answer
  // that leaves both judgements where they were.
  const skippedPaths = new Set(skipped.map((s) => s.rel));
  const recorded = new Map((manifest && Array.isArray(manifest.files) ? manifest.files : []).map((f) => [f.path, f.sha256]));
  const next = {
    schema: 'codemode-install/1',
    version: HELPER_VERSION,
    installedAt: new Date().toISOString(),
    accountRoot,
    agentsBody: body,
    files: files.map((f) => ({
      path: f.path,
      sha256: skippedPaths.has(f.path) && recorded.has(f.path) ? recorded.get(f.path) : sha256(f.content),
    })),
    previous: outgoing,
  };
  if (!dryRun) writeFile(manifestPath, JSON.stringify(next, null, 2) + '\n', dryRun);
  const activation = configureMcpActivation({
    settingsPath: path.join(accountRoot, 'settings.json'),
    execPath: node,
    repoRoot: REPO_ROOT,
    dryRun,
  });
  return {
    ...base,
    ...activation,
    filesInstalled: dryRun ? Boolean(manifest) : true,
    written: written.map((w) => w.path),
    preserved: preserved.map((p) => p.rel),
    skipped: skipped.map((s) => s.rel),
    adopted: adopted.map((a) => a.rel),
    agentsBlock,
  };
}

// The rollback bundle is read off disk at the moment of the upgrade, not reconstructed from a
// hash. The current generation therefore stays a list of hashes, and only ONE generation of
// content is ever stored: enough to go back once, bounded by construction.
//
// A file the user edited is recorded as the user left it. It was preserved rather than
// overwritten, so that IS the state a rollback should return to.
function snapshotForRollback(accountRoot, manifest) {
  const files = [];
  for (const known of manifest.files || []) {
    const abs = path.join(accountRoot, known.path);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, 'utf8');
    // Hash what we actually read. Copying the manifest's claim instead lets a snapshot
    // declare bytes it is not carrying: that happened on two live accounts where something
    // outside the installer had already replaced cm.js, and the rollback target silently
    // became the new file under the old file's name.
    const actual = sha256(content);
    const entry = { path: known.path, sha256: actual, content };
    if (actual !== known.sha256) entry.disagreedWithManifest = known.sha256;
    files.push(entry);
  }
  return {
    schema: manifest.schema, version: manifest.version, installedAt: manifest.installedAt,
    agentsBody: manifest.agentsBody, files, previous: null,
  };
}

export { MANIFEST_RELPATH, SKILL_DIR, sha256 };

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runInstaller({
    verb: process.argv[2] || 'doctor',
    asideHome: opt('--aside-home', path.join(os.homedir(), '.aside')),
    account: opt('--account', null),
    dryRun: flag('--dry-run'),
  });
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(result.verb + ': account ' + result.account + ' at ' + result.accountRoot + (result.dryRun ? ' (dry run)' : ''));
    for (const [k, v] of Object.entries(result)) {
      if (['verb', 'account', 'accountRoot', 'dryRun'].includes(k)) continue;
      console.log('  ' + k + ': ' + (Array.isArray(v) ? (v.length ? v.join(', ') : '(none)') : JSON.stringify(v)));
    }
    if (!result.dryRun && ['install', 'upgrade', 'repair'].includes(result.verb) && result.ok !== false) {
      console.log('Route 1 (CLI): ready immediately.');
      if (result.activationPending) {
        console.log('Route 2 (native MCP): activation pending.');
        console.log('  1. The normalized server entry is written with discovery migration keys omitted.');
        console.log('  2. Make the Aside daemon re-read settings: restart it when safe, or use Refresh tools in Aside Settings > Plugins & MCPs > MCPs. This installer does not restart it.');
        console.log('  3. Start a new Aside session; that session performs tool discovery.');
      } else {
        console.log('Route 2 (native MCP): ' + (result.activationRequired || 'already activated.'));
      }
    }
  }
  process.exit(result.ok === false ? 1 : 0);
}
