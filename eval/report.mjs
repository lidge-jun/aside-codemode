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
    // cold and warm are different measurements of the same path, not samples of one. Pooling
    // them would let a slow cold start be averaged away by the warm runs beside it.
    // A row with no mode is from a campaign that predates the split. Calling it warm would
    // merge an unknown condition into a known one, so it keeps its own bucket and says so.
    // The idle gap is part of what cold MEANS. Two campaigns that both say cold but waited
    // different amounts are two conditions, and pooling them produces a median that describes
    // neither. warm has no gap, so it stays plain.
    const mode = r.mode || 'unspecified';
    const gap = Number.isFinite(r.idleMs) && r.idleMs > 0 ? ' +' + r.idleMs + 'ms idle' : '';
    const key = r.path + ' / ' + mode + gap;
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(r);
  }
  const paths = [...byPath.entries()].map(([id, list]) => {
    const failed = list.filter((r) => !r.ok);
    const reported = list.map((r) => r.roundTrips);
    const trips = [...new Set(reported.filter((n) => Number.isFinite(n)))];
    // A bucket where some rows never said how many calls they made cannot claim a figure for
    // all of them: the unique set would report the runs that spoke as if they spoke for the rest.
    const everyRowReported = reported.every((n) => Number.isFinite(n));
    return {
      path: id,
      pathId: list[0].path,
      mode: list[0].mode || 'unspecified',
      // One number only when every run in the bucket agreed. A mixed bucket printing '3,1'
      // reads like a per-run figure that applies to all of them, and it does not.
      roundTrips: everyRowReported && trips.length === 1 ? trips[0] : null,
      roundTripsMixed: trips.length > 1 ? trips.slice().sort((a, b) => a - b) : null,
      roundTripsPartial: !everyRowReported && trips.length > 0,
      // Who went first. With an even number of pairs this is balanced by construction; when it
      // is not, the path that led more often inherited less of the other's warm state.
      leads: list.filter((r) => r.slot === 0).length,
      perCallMs: list.map((r) => r.perCallMs).find((v) => Array.isArray(v) && v.length > 1) || null,
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
  out.push('| path / mode | calls per run | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |');
  out.push('|---|---|---|---|---|---|---|');
  for (const p of summary.paths) {
    out.push('| ' + [p.path, p.roundTrips ?? '-', p.runs, p.medianMs ?? '-', p.medianOkMs ?? '-',
      (p.errorRate * 100).toFixed(1) + '%', p.p95Ms ?? 'not computed'].join(' | ') + ' |');
  }
  out.push('');
  for (const p of summary.paths) {
    if (p.p95Note) out.push('- ' + p.path + ': p95 ' + p.p95Note + '.');
    if (p.roundTripsMixed) out.push('- ' + p.path + ': runs in this bucket used different call counts (' + p.roundTripsMixed.join(', ') + '), so no single figure is printed.');
    if (p.roundTripsPartial) out.push('- ' + p.path + ': some runs in this bucket did not report a call count, so none is printed for the bucket.');
  }
  // Lead counts, always. An imbalance is only visible if it is written down.
  const leadLine = summary.paths.map((p) => p.path + ' ' + p.leads + '/' + p.runs).join(', ');
  if (summary.paths.length) {
    out.push('');
    out.push('Went first (an even split is what the alternation is for): ' + leadLine + '.');
  }
  for (const p of summary.paths) {
    if (p.perCallMs) out.push('- ' + p.path + ': one run split across its calls: ' + p.perCallMs.join(' + ') + ' ms.');
  }
  out.push('');
  out.push('Every run, in order:');
  out.push('');
  for (const p of summary.paths) {
    out.push('- ' + p.path + ': ' + p.values.join(', ') + ' ms');
    if (p.failures.length) {
      out.push('  - failed: ' + p.failures.map((f) => 'pair ' + f.pair + ' (' + f.why + ')').join('; '));
    } else {
      // Said out loud, so "no failures were recorded" cannot be confused with "failures were
      // not looked at".
      out.push('  - failed: none');
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
