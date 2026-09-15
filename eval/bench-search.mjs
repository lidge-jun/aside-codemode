#!/usr/bin/env node
// Companion search bench. Not the operator 55s/1s/51x folder pair.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const cli = path.join(repoRoot, 'bin', 'codemode.mjs');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}
function has(name) {
  return process.argv.includes(name);
}

const query = arg('--query', 'NEEDLE-51X');
const repeats = Number(arg('--repeats', '3'));
if (!Number.isInteger(repeats) || repeats < 1) {
  process.stderr.write('repeats must be a positive integer\n');
  process.exit(2);
}
const selfCheck = has('--self-check');
const internalWalk = has('--internal-walk');

function resolveGrep() {
  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  const names = process.platform === 'win32' ? ['grep.exe', 'grep'] : ['grep'];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const cand = path.join(dir, name);
      if (existsSync(cand) && !cand.toLowerCase().endsWith('.cmd')) return cand;
    }
  }
  return null;
}

function canon(p) {
  try { return realpathSync.native(p); } catch { return path.resolve(p); }
}

function rel(root, abs) {
  return path.relative(canon(root), canon(abs)).split(path.sep).join('/');
}

function keyOf(row) {
  return `${row.relPath}\t${row.line}\t${row.text}`;
}

function sortKeys(rows) {
  return rows.map(keyOf).sort();
}

function nodeWalk(root, needle) {
  const rows = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) { stack.push(abs); continue; }
      if (!ent.isFile()) continue;
      let text;
      try { text = readFileSync(abs, 'utf8'); }
      catch { continue; }
      const lines = text.split(/\n/);
      lines.forEach((line, i) => {
        const body = line.replace(/\r$/, '');
        if (body.includes(needle)) rows.push({ relPath: rel(root, abs), line: i + 1, text: body });
      });
    }
  }
  return rows;
}

function parseGrep(stdout, root) {
  const rows = [];
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw) continue;
    const m = raw.match(/^(.*?):(\d+):(.*)$/);
    if (!m) continue;
    rows.push({ relPath: rel(root, path.resolve(m[1])), line: Number(m[2]), text: m[3] });
  }
  return rows;
}

function parseSearchResult(stdout, root) {
  const env = JSON.parse(stdout);
  if (!env.ok) throw new Error(env.error || 'codemode failed');
  const value = env.result;
  const list = Array.isArray(value) ? value : value?.rows;
  if (!Array.isArray(list)) throw new Error('search.content result is not a row list');
  return list.map((r) => {
    const raw = String(r.file ?? r.path ?? '');
    return {
      relPath: rel(root, raw),
      line: Number(r.line),
      text: String(r.text ?? ''),
    };
  });
}

function runBaseline(root, needle) {
  const grepBin = resolveGrep();
  if (grepBin) {
    const argv = [grepBin, '-R', '-n', '--', needle, root];
    const t0 = performance.now();
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
    const baselineMs = performance.now() - t0;
    if (r.status !== 0 && r.status !== 1) {
      throw new Error(`grep -R failed: ${r.stderr || r.status}`);
    }
    return { kind: 'grep-R', argv, rows: parseGrep(r.stdout, root), baselineMs };
  }
  const argv = [process.execPath, path.join(repoRoot, 'eval', 'bench-search.mjs'), '--internal-walk', root, needle];
  const t0 = performance.now();
  const rows = nodeWalk(root, needle);
  const baselineMs = performance.now() - t0;
  return { kind: 'node-walk', argv, rows, baselineMs };
}

function runAfter(root, needle) {
  const code = `return await search.content({ path: ".", query: ${JSON.stringify(needle)}, fixedStrings: true, max: 1000 })`;
  const argv = [process.execPath, cli, '--cwd', root, '--code', code];
  const t0 = performance.now();
  const r = spawnSync(argv[0], argv.slice(1), {
    encoding: 'utf8',
    env: { ...process.env, CODEMODE_ROOTS: root },
  });
  const afterMs = performance.now() - t0;
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `codemode exit ${r.status}`);
  return { argv, rows: parseSearchResult(r.stdout, root), afterMs, code };
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function plantCorpus(root, { dirs, files, needle, planted = 1 }) {
  mkdirSync(root, { recursive: true });
  for (let d = 0; d < dirs; d += 1) {
    const dir = path.join(root, `area-${String(d).padStart(2, '0')}`);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < files; f += 1) {
      writeFileSync(path.join(dir, `doc-${String(f).padStart(3, '0')}.txt`), `filler ${d}/${f}\ncommon words\n`);
    }
  }
  for (let i = 0; i < planted; i += 1) {
    const d = Math.min(i, dirs - 1);
    const dir = path.join(root, `area-${String(d).padStart(2, '0')}`);
    writeFileSync(path.join(dir, `doc-${String(i).padStart(3, '0')}.txt`), `marker\ncontains ${needle} exactly once\n`);
  }
}

if (internalWalk) {
  const root = process.argv[process.argv.indexOf('--internal-walk') + 1];
  const needle = process.argv[process.argv.indexOf('--internal-walk') + 2] ?? query;
  process.stdout.write(JSON.stringify(nodeWalk(root, needle)) + '\n');
  process.exit(0);
}

let root = arg('--dir');
let cleanup = null;
if (selfCheck) {
  root = mkdtempSync(path.join(tmpdir(), 'cm-bench-self-'));
  cleanup = root;
  plantCorpus(root, { dirs: 3, files: 10, needle: query, planted: 1 });
} else if (!root) {
  root = mkdtempSync(path.join(tmpdir(), 'cm-bench-'));
  cleanup = root;
  plantCorpus(root, { dirs: 20, files: 25, needle: query, planted: 5 });
}

const options = { fixedStrings: true, max: 1000, noIgnore: false, hidden: false };
const runs = [];
let equality = true;
let baselineMeta;
let afterMeta;
const n = selfCheck ? 1 : repeats;

try {
  for (let i = 0; i < n; i += 1) {
    const base = runBaseline(root, query);
    const after = runAfter(root, query);
    baselineMeta = { kind: base.kind, argv: base.argv };
    afterMeta = { argv: after.argv, code: after.code };
    const equal = JSON.stringify(sortKeys(base.rows)) === JSON.stringify(sortKeys(after.rows));
    if (!equal) equality = false;
    runs.push({ baselineMs: base.baselineMs, afterMs: after.afterMs, equal, matchCount: after.rows.length });
  }
} finally {
  if (cleanup) rmSync(cleanup, { recursive: true, force: true });
}

if (!equality) {
  const report = {
    root,
    repeats: n,
    query,
    options,
    baseline: baselineMeta,
    after: afterMeta,
    runs,
    equality: false,
    notOperator51x: true,
    note: 'Companion pair. Not the operator 55s/1s folder. Equality failed; no ratio.',
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(1);
}

const medianBaselineMs = median(runs.map((r) => r.baselineMs));
const medianAfterMs = median(runs.map((r) => r.afterMs));
const report = {
  root,
  repeats: n,
  query,
  options,
  baseline: baselineMeta,
  after: afterMeta,
  runs,
  medianBaselineMs,
  medianAfterMs,
  ratio: medianAfterMs === 0 ? null : medianBaselineMs / medianAfterMs,
  equality: true,
  notOperator51x: true,
  note: 'Companion pair. Not the operator 55s/1s folder.',
};
process.stderr.write(`equal=true medianBaseline=${medianBaselineMs} medianAfter=${medianAfterMs}\n`);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(0);
