#!/usr/bin/env node
// Runs two paths over the same workload, alternating which goes first.
//
//   node eval/paired-run.mjs --workload eval/workloads/independent-reads.json \
//        [--pairs 30] [--mode cold|warm] [--dry-run]
//
// Order matters more than people expect: a browser that just opened six tabs is not the
// browser that has been idle for a minute, so whichever path runs second inherits the other's
// warm state. Pairs alternate ABBA so that bias lands on both paths equally instead of on
// whichever one the author listed first.
//
// A path is a SEQUENCE of invocations, not one. 'aside repl' starts a fresh session every
// time, so a tab cannot be carried from one call to the next: work that needs three
// observe-decide-act round trips really does pay for three page loads. Measuring a path as one
// program would hide exactly the cost batching removes, so the clock covers the whole
// sequence and roundTrips rides along with the row.
//
// cold and warm are separate campaigns rather than a column computed after the fact. --mode
// cold puts an idle gap in front of every PATH RUN, so the first call of a sequence starts
// against an idle browser; the calls after it are warm by construction and perCallMs says so.
// --mode warm runs everything back to back. Both tag their rows with the mode and the gap.
//
// Output is one JSON object per run on stdout, raw. Nothing is averaged here; eval/report.mjs
// does that, and keeping them apart is what makes a disputed number re-derivable.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export class WorkloadError extends Error {}

export const MODES = Object.freeze(['warm', 'cold']);
export const DEFAULT_COLD_IDLE_MS = 3000;
export const ANSWER_SOURCES = Object.freeze(['eval-json', 'last-json-result']);

// One path may be several invocations. Normalising here means every consumer sees the same
// shape and nobody has to remember which of the two spellings a workload used.
export function pathPrograms(p) {
  if (Array.isArray(p.programs)) return p.programs;
  return typeof p.program === 'string' ? [p.program] : [];
}

export function validateWorkload(raw) {
  const w = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!w) throw new WorkloadError('a workload is a JSON object');
  if (typeof w.id !== 'string' || !w.id) throw new WorkloadError('workload needs an id');
  if (!Array.isArray(w.paths) || w.paths.length !== 2) {
    throw new WorkloadError('a paired run compares exactly two paths');
  }
  for (const p of w.paths) {
    if (!p || typeof p.id !== 'string' || !p.id) throw new WorkloadError('every path needs an id');
    const programs = pathPrograms(p);
    if (!programs.length || programs.some((s) => typeof s !== 'string' || !s.trim())) {
      throw new WorkloadError('path ' + p.id + ' has no program to run');
    }
    if (p.bin !== undefined && (typeof p.bin !== 'string' || !p.bin.trim())) {
      throw new WorkloadError('path ' + p.id + ' has a bin that is not a command');
    }
    if (p.args !== undefined && (!Array.isArray(p.args) || p.args.some((a) => typeof a !== 'string'))) {
      throw new WorkloadError('path ' + p.id + ' has args that are not strings');
    }
    if (p.answerFrom !== undefined && !ANSWER_SOURCES.includes(p.answerFrom)) {
      // An unknown source used to fall through to the EVAL_JSON branch, so a typo in a
      // workload quietly measured the wrong contract instead of failing.
      throw new WorkloadError('path ' + p.id + ' has answerFrom ' + JSON.stringify(p.answerFrom)
        + '; expected one of ' + ANSWER_SOURCES.join(', '));
    }
    if (p.requireKeys !== undefined && (!Array.isArray(p.requireKeys) || p.requireKeys.some((k) => typeof k !== 'string'))) {
      // A bare string iterates per character, which silently demands a key named 'c'.
      throw new WorkloadError('path ' + p.id + ' has requireKeys that are not a list of strings');
    }
    if (p.expect !== undefined && (p.expect === null || typeof p.expect !== 'object' || Array.isArray(p.expect))) {
      throw new WorkloadError('path ' + p.id + ' has an expect that is not an object');
    }
  }
  if (new Set(w.paths.map((p) => p.id)).size !== w.paths.length) {
    throw new WorkloadError('the two paths need different ids, or the report cannot tell them apart');
  }
  if (!Number.isInteger(w.pairs) || w.pairs < 1) {
    throw new WorkloadError('pairs must be a positive integer; a run of zero measures nothing');
  }
  if (w.expect !== undefined && (w.expect === null || typeof w.expect !== 'object' || Array.isArray(w.expect))) {
    throw new WorkloadError('expect must be an object');
  }
  if (w.requireKeys !== undefined && (!Array.isArray(w.requireKeys) || w.requireKeys.some((k) => typeof k !== 'string'))) {
    throw new WorkloadError('requireKeys must be a list of strings');
  }
  return w;
}

// Who went first, per path. With an odd number of pairs one path leads once more than the
// other and inherits slightly less of the opponent's warm state. That is not fatal, but it has
// to be visible: an unreported imbalance is a thumb on the scale.
export function leadCounts(workload) {
  const counts = Object.fromEntries(workload.paths.map((p) => [p.id, 0]));
  for (const step of schedule(workload)) if (step.slot === 0) counts[step.pathId] += 1;
  return counts;
}

// ABBA. Pair 0 runs A then B, pair 1 runs B then A, and so on. Derived from the pair index
// rather than from a random seed, so two runs of the same workload are the same schedule and a
// disagreement between them is about the machine, not about the dice.
export function schedule(workload) {
  const [a, b] = workload.paths;
  const out = [];
  for (let pair = 0; pair < workload.pairs; pair++) {
    const order = pair % 2 === 0 ? [a, b] : [b, a];
    order.forEach((p, slot) => out.push({
      pair, slot, pathId: p.id, programs: pathPrograms(p),
      bin: p.bin || null, args: p.args || null,
      // A path may answer a differently shaped question than its opposite: six separate calls
      // cannot report a total the way one batched call can. The comparison is still fair
      // because both do the same underlying work; only the reporting differs.
      expect: p.expect || null, requireKeys: p.requireKeys || null,
      answerFrom: p.answerFrom || 'eval-json',
    }));
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
//
// A sequence prints once per call, so every line is collected and the LAST one is the run's
// answer. requireKeys is checked on all of them, which catches a path whose intermediate calls
// quietly returned nothing instead of judging it only on its final line.
// perCallStdout, not one concatenated blob: counting answers across the joined text lets a
// chatty call cover for a silent one. Each call has to produce exactly one answer of its own.
export function judge(raw, expect, requireKeys = [], answerFrom = 'eval-json', expectedCalls = null) {
  const chunks = Array.isArray(raw.perCallStdout) ? raw.perCallStdout : [raw.stdout];
  const parse = (text) => {
    const found = [];
    if (answerFrom === 'last-json-result') {
      // The codemode CLI answers with a structured envelope, which is the whole point of it.
      // Asking that path to also print a marker line would measure the workaround, so the
      // contract is declared per path rather than sniffed.
      for (const line of String(text).split('\n')) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        try {
          const env = JSON.parse(t);
          if (env && env.ok === true && env.result !== undefined) found.push(env.result);
          else if (env && env.ok === false) found.push({ __cliError: String(env.error).slice(0, 120) });
        } catch { /* not an envelope */ }
      }
    } else {
      for (const line of String(text).split('\n')) {
        const at = line.indexOf('EVAL_JSON ');
        if (at === -1) continue;
        try { found.push(JSON.parse(line.slice(at + 'EVAL_JSON '.length))); } catch { /* not ours */ }
      }
    }
    return found;
  };
  const perCall = chunks.map(parse);
  const values = perCall.flat();
  const cliError = values.find((v) => v && v.__cliError);
  if (cliError) return { ok: false, why: 'cli reported ' + cliError.__cliError, value: null, values: [] };
  const value = values.length ? values[values.length - 1] : null;
  if (raw.code !== 0) return { ok: false, why: 'exit ' + raw.code, value, values };
  // values.length, not truthiness. A legitimate answer of 0, false or '' is an answer, and
  // calling it 'no answer' would fail a run that worked.
  if (values.length === 0) return { ok: false, why: 'no answer on stdout (' + answerFrom + ')', value: null, values };
  // One answer per call, or the run did not do what it claims. A middle call that exited 0
  // while printing nothing used to pass on the strength of the last call's line, which is the
  // exact shape of a sequence that quietly skipped its work.
  if (expectedCalls !== null && perCall.length === expectedCalls) {
    const bad = perCall.findIndex((v) => v.length !== 1);
    if (bad !== -1) {
      return { ok: false, why: 'call ' + (bad + 1) + ' produced ' + perCall[bad].length + ' answers, expected 1', value, values };
    }
  } else if (expectedCalls !== null && values.length !== expectedCalls) {
    return { ok: false, why: values.length + ' answers from ' + expectedCalls + ' calls', value, values };
  }
  const notAnObject = values.findIndex((v) => v === null || typeof v !== 'object' || Array.isArray(v));
  if (notAnObject !== -1) {
    // Guarding here rather than letting v[key] throw: one malformed answer must fail its own
    // run, not take the rest of the campaign down with it.
    return { ok: false, why: 'call ' + (notAnObject + 1) + ' answered ' + JSON.stringify(values[notAnObject]), value, values };
  }
  for (const key of requireKeys || []) {
    const missing = values.findIndex((v) => v[key] === undefined);
    if (missing !== -1) return { ok: false, why: 'call ' + (missing + 1) + ' reported no ' + key, value, values };
  }
  for (const [key, want] of Object.entries(expect || {})) {
    if (JSON.stringify(value[key]) !== JSON.stringify(want)) {
      return { ok: false, why: key + ' was ' + JSON.stringify(value[key]) + ', wanted ' + JSON.stringify(want), value, values };
    }
  }
  return { ok: true, why: null, value, values };
}

export async function runWorkload(workload, {
  emit, dryRun = false, bin = 'aside', args = ['repl'],
  mode = 'warm', idleMs = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  if (!MODES.includes(mode)) throw new WorkloadError('mode must be one of ' + MODES.join(', '));
  const gap = idleMs === null ? (mode === 'cold' ? DEFAULT_COLD_IDLE_MS : 0) : idleMs;
  const plan = schedule(workload);
  if (dryRun) {
    for (const step of plan) {
      emit({
        kind: 'plan', workload: workload.id, mode, idleMs: gap, pair: step.pair, slot: step.slot,
        path: step.pathId, roundTrips: step.programs.length,
      });
    }
    return { runs: 0, planned: plan.length, mode, idleMs: gap, leads: leadCounts(workload) };
  }
  let runs = 0;
  for (const step of plan) {
    // The gap belongs INSIDE the measured campaign but OUTSIDE the clock: a cold run is one
    // that starts against an idle browser, not one that is charged for waiting.
    if (gap > 0) await sleep(gap);
    const startedAt = Date.now();
    const parts = [];
    for (const program of step.programs) {
      parts.push(await runOnce(step.bin || bin, step.args || args, program));
    }
    // The sequence is the unit. A path that needed three page loads to answer is slower than
    // one that needed a single session, and that difference is the finding.
    const raw = {
      ms: Date.now() - startedAt,
      code: parts.find((p) => p.code !== 0) ? (parts.find((p) => p.code !== 0).code) : 0,
      stdout: parts.map((p) => p.stdout).join('\n'),
      stderr: parts.map((p) => p.stderr).join('\n'),
      perCallStdout: parts.map((p) => p.stdout),
    };
    const verdict = judge(raw, step.expect || workload.expect,
      step.requireKeys || workload.requireKeys || [], step.answerFrom, step.programs.length);
    emit({
      kind: 'run', workload: workload.id, mode, pair: step.pair, slot: step.slot, path: step.pathId,
      roundTrips: step.programs.length, idleMs: gap, ms: raw.ms, perCallMs: parts.map((p) => p.ms),
      ok: verdict.ok, why: verdict.why, value: verdict.value, values: verdict.values,
      at: new Date().toISOString(),
    });
    runs += 1;
  }
  return { runs, planned: plan.length, mode, idleMs: gap, leads: leadCounts(workload) };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const i = process.argv.indexOf('--workload');
  if (i === -1) {
    console.error('usage: paired-run.mjs --workload <file.json> [--pairs N] [--mode cold|warm] [--dry-run]');
    process.exit(2);
  }
  const workload = validateWorkload(JSON.parse(readFileSync(process.argv[i + 1], 'utf8')));
  const pairsArg = process.argv.indexOf('--pairs');
  if (pairsArg > -1) workload.pairs = Number(process.argv[pairsArg + 1]);
  validateWorkload(workload);
  const modeArg = process.argv.indexOf('--mode');
  const idleArg = process.argv.indexOf('--idle-ms');
  let idleMs = null;
  if (idleArg > -1) {
    idleMs = Number(process.argv[idleArg + 1]);
    if (!Number.isFinite(idleMs) || idleMs < 0) {
      console.error('--idle-ms must be a non-negative number of milliseconds');
      process.exit(2);
    }
  }
  const res = await runWorkload(workload, {
    emit: (row) => console.log(JSON.stringify(row)),
    dryRun: process.argv.includes('--dry-run'),
    mode: modeArg > -1 ? process.argv[modeArg + 1] : 'warm',
    idleMs,
  });
  console.error(JSON.stringify(res));
}
