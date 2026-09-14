#!/usr/bin/env node
// Runs two paths over the same workload, alternating which goes first.
//
//   node eval/paired-run.mjs --workload eval/workloads/independent-reads.json [--pairs 10] [--dry-run]
//
// Order matters more than people expect: a browser that just opened six tabs is not the
// browser that has been idle for a minute, so whichever path runs second inherits the other's
// warm state. Pairs alternate ABBA so that bias lands on both paths equally instead of on
// whichever one the author listed first.
//
// Output is one JSON object per run on stdout, raw. Nothing is averaged here; eval/report.mjs
// does that, and keeping them apart is what makes a disputed number re-derivable.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export class WorkloadError extends Error {}

export function validateWorkload(raw) {
  const w = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!w) throw new WorkloadError('a workload is a JSON object');
  if (typeof w.id !== 'string' || !w.id) throw new WorkloadError('workload needs an id');
  if (!Array.isArray(w.paths) || w.paths.length !== 2) {
    throw new WorkloadError('a paired run compares exactly two paths');
  }
  for (const p of w.paths) {
    if (!p || typeof p.id !== 'string' || !p.id) throw new WorkloadError('every path needs an id');
    if (typeof p.program !== 'string' || !p.program.trim()) {
      throw new WorkloadError('path ' + p.id + ' has no program to run');
    }
  }
  if (!Number.isInteger(w.pairs) || w.pairs < 1) {
    throw new WorkloadError('pairs must be a positive integer; a run of zero measures nothing');
  }
  if (w.expect !== undefined && typeof w.expect !== 'object') throw new WorkloadError('expect must be an object');
  return w;
}

// ABBA. Pair 0 runs A then B, pair 1 runs B then A, and so on. Derived from the pair index
// rather than from a random seed, so two runs of the same workload are the same schedule and a
// disagreement between them is about the machine, not about the dice.
export function schedule(workload) {
  const [a, b] = workload.paths;
  const out = [];
  for (let pair = 0; pair < workload.pairs; pair++) {
    const order = pair % 2 === 0 ? [a, b] : [b, a];
    order.forEach((p, slot) => out.push({ pair, slot, pathId: p.id, program: p.program }));
  }
  return out;
}

function runOnce(bin, args, program) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(bin, args.concat([program]), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => resolve({ ms: Date.now() - startedAt, code: -1, stdout, stderr: String(e.message) }));
    child.on('close', (code) => resolve({ ms: Date.now() - startedAt, code, stdout, stderr }));
  });
}

// A run that did not produce the answer is a FAILED run, not a missing one. It keeps its
// duration and is reported; dropping it is how a path that fails half the time looks fast.
export function judge(raw, expect) {
  const line = raw.stdout.split('\n').find((l) => l.includes('EVAL_JSON '));
  let value = null;
  if (line) {
    try { value = JSON.parse(line.slice(line.indexOf('EVAL_JSON ') + 'EVAL_JSON '.length)); } catch { value = null; }
  }
  if (raw.code !== 0) return { ok: false, why: 'exit ' + raw.code, value };
  if (!value) return { ok: false, why: 'no EVAL_JSON line', value: null };
  for (const [key, want] of Object.entries(expect || {})) {
    if (JSON.stringify(value[key]) !== JSON.stringify(want)) {
      return { ok: false, why: key + ' was ' + JSON.stringify(value[key]) + ', wanted ' + JSON.stringify(want), value };
    }
  }
  return { ok: true, why: null, value };
}

export async function runWorkload(workload, { emit, dryRun = false, bin = 'aside', args = ['repl'] } = {}) {
  const plan = schedule(workload);
  if (dryRun) {
    for (const step of plan) emit({ kind: 'plan', workload: workload.id, pair: step.pair, slot: step.slot, path: step.pathId });
    return { runs: 0, planned: plan.length };
  }
  let runs = 0;
  for (const step of plan) {
    const raw = await runOnce(bin, args, step.program);
    const verdict = judge(raw, workload.expect);
    emit({
      kind: 'run', workload: workload.id, pair: step.pair, slot: step.slot, path: step.pathId,
      ms: raw.ms, ok: verdict.ok, why: verdict.why, value: verdict.value, at: new Date().toISOString(),
    });
    runs += 1;
  }
  return { runs, planned: plan.length };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const i = process.argv.indexOf('--workload');
  if (i === -1) { console.error('usage: paired-run.mjs --workload <file.json> [--pairs N] [--dry-run]'); process.exit(2); }
  const workload = validateWorkload(JSON.parse(readFileSync(process.argv[i + 1], 'utf8')));
  const pairsArg = process.argv.indexOf('--pairs');
  if (pairsArg > -1) workload.pairs = Number(process.argv[pairsArg + 1]);
  validateWorkload(workload);
  const res = await runWorkload(workload, {
    emit: (row) => console.log(JSON.stringify(row)),
    dryRun: process.argv.includes('--dry-run'),
  });
  console.error(JSON.stringify(res));
}
