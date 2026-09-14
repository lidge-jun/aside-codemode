#!/usr/bin/env node
// Turns paired-run JSONL into a table you can argue with.
//
//   node eval/paired-run.mjs --workload w.json > runs.jsonl
//   node eval/report.mjs runs.jsonl
//
// Three rules, all of them about not flattering the result:
//
//   1. Every run is printed. A median without the values behind it is a claim, not a finding.
//   2. A failed run keeps its duration and counts in the error rate. Dropping failures makes a
//      path that only half works look like the fastest one.
//   3. p95 needs enough samples to mean anything. Under the threshold it is not computed, and
//      the report says why instead of leaving a reader to assume it was fine.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const P95_MIN_SAMPLES = 30;

export function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarize(rows) {
  const runs = rows.filter((r) => r.kind === 'run');
  const byPath = new Map();
  for (const r of runs) {
    if (!byPath.has(r.path)) byPath.set(r.path, []);
    byPath.get(r.path).push(r);
  }
  const paths = [...byPath.entries()].map(([id, list]) => {
    const failed = list.filter((r) => !r.ok);
    return {
      path: id,
      runs: list.length,
      // Every run, successful or not. Rule 2.
      medianMs: median(list.map((r) => r.ms)),
      // The same number over successes only, stated separately so nobody has to guess which
      // one a median refers to.
      medianOkMs: median(list.filter((r) => r.ok).map((r) => r.ms)),
      errorRate: list.length ? failed.length / list.length : 0,
      failures: failed.map((r) => ({ pair: r.pair, why: r.why })),
      values: list.map((r) => r.ms),
      p95Ms: null,
      p95Note: list.length < P95_MIN_SAMPLES
        ? 'not computed: ' + list.length + ' samples, under the ' + P95_MIN_SAMPLES + ' this report requires'
        : null,
    };
  });
  for (const p of paths) {
    if (p.p95Note === null) {
      const s = p.values.slice().sort((a, b) => a - b);
      p.p95Ms = s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
    }
  }
  return { workload: runs.length ? runs[0].workload : null, totalRuns: runs.length, paths };
}

export function render(summary) {
  const out = [];
  out.push('# ' + (summary.workload || 'eval') + ' — ' + summary.totalRuns + ' runs');
  out.push('');
  out.push('| path | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |');
  out.push('|---|---|---|---|---|---|');
  for (const p of summary.paths) {
    out.push('| ' + [p.path, p.runs, p.medianMs ?? '-', p.medianOkMs ?? '-',
      (p.errorRate * 100).toFixed(1) + '%', p.p95Ms ?? 'not computed'].join(' | ') + ' |');
  }
  out.push('');
  for (const p of summary.paths) {
    if (p.p95Note) out.push('- ' + p.path + ': p95 ' + p.p95Note + '.');
  }
  out.push('');
  out.push('Every run, in order:');
  out.push('');
  for (const p of summary.paths) {
    out.push('- ' + p.path + ': ' + p.values.join(', ') + ' ms');
    if (p.failures.length) {
      out.push('  - failed: ' + p.failures.map((f) => 'pair ' + f.pair + ' (' + f.why + ')').join('; '));
    }
  }
  return out.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const file = process.argv[2];
  if (!file) { console.error('usage: report.mjs <runs.jsonl>'); process.exit(2); }
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  process.stdout.write(render(summarize(rows)));
}
