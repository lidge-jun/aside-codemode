// Compare recorded events, not filesystem creation times. A marker hit is not
// a correctness oracle; timing targets never become a blanket performance PASS.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function failed(event) {
  const result = event.result ?? {};
  return event.isError === true || result.isError === true || result.ok === false
    || (Number.isInteger(result.exitCode) && result.exitCode !== 0);
}

export function analyze(file, needle) {
  if (typeof needle !== 'string' || !needle.trim()) throw new Error('an explicit non-empty marker is required');
  const events = readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim()).map((line, i) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${file}: invalid JSON event at line ${i + 1}`); }
  });
  let first = Infinity, last = -Infinity;
  for (const event of events) {
    for (const value of [event.message?.timestamp, event.message?.completedAt]) {
      if (Number.isFinite(value)) { first = Math.min(first, value); last = Math.max(last, value); }
    }
  }
  const starts = events.filter(e => e.type === 'tool_execution_start');
  const ends = events.filter(e => e.type === 'tool_execution_end');
  const final = events.filter(e => e.type === 'message_end' && e.message?.role === 'assistant').at(-1);
  const finalText = Array.isArray(final?.message?.content)
    ? final.message.content.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
  return {
    file, marker: needle,
    spanMs: Number.isFinite(first) && last > first ? last - first : null,
    toolCalls: starts.map(e => e.toolName),
    toolFailures: ends.filter(failed).length,
    toolNeedleHit: ends.some(e => !failed(e) && JSON.stringify(e.result ?? {}).includes(needle)),
    finalMentionsNeedle: finalText.includes(needle),
    correctness: 'not_verified',
  };
}

function cell(value) { return String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' '); }

export function compare(baseline, after) {
  const ratio = baseline.spanMs > 0 && after.spanMs > 0 ? after.spanMs / baseline.spanMs : null;
  const clean = baseline.toolFailures === 0 && after.toolFailures === 0;
  const timingTargetMet = clean && baseline.toolNeedleHit && after.toolNeedleHit
    && ratio !== null && ratio < 0.5;
  return {
    ratio, timingTargetMet,
    markdown: [
      '# codemode recorded-event comparison', '',
      `| Metric | Baseline (${cell(baseline.marker)}) | After (${cell(after.marker)}) |`,
      '| --- | --- | --- |',
      `| Log | ${cell(path.basename(baseline.file))} | ${cell(path.basename(after.file))} |`,
      `| Event span, ms (timestamp + completedAt) | ${baseline.spanMs ?? 'unavailable'} | ${after.spanMs ?? 'unavailable'} |`,
      `| Tool calls | ${baseline.toolCalls.length} | ${after.toolCalls.length} |`,
      `| Failed tool events | ${baseline.toolFailures} | ${after.toolFailures} |`,
      `| Marker in successful tool output | ${baseline.toolNeedleHit} | ${after.toolNeedleHit} |`,
      `| Marker in final assistant text | ${baseline.finalMentionsNeedle} | ${after.finalMentionsNeedle} |`, '',
      `after/baseline: ${ratio === null ? 'unavailable' : ratio.toFixed(3)}`,
      `Timing target (<0.5 with clean tool runs): ${timingTargetMet ? 'met' : 'not met'}.`,
      'Correctness: NOT VERIFIED. Marker presence does not prove complete paths, sizes, recall, or final-answer accuracy.',
      'Verdict: REVIEW NEEDED until an independent task-specific correctness oracle and repeated paired runs are supplied.',
      'Event spans cover only captured events, not omitted setup or work before logging. Filesystem birthtime/mtime are intentionally excluded.',
      !clean ? 'Contamination: failed tool events are present; do not attribute all timing differences to codemode.' : '',
      '',
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [baseline, after, output, baselineMarker, afterMarker, ...extra] = process.argv.slice(2);
  if (!baseline || !after || !output || !baselineMarker || !afterMarker || extra.length) {
    console.error('usage: node eval/compare.mjs <baseline.jsonl> <after.jsonl> <summary.md> <baselineMarker> <afterMarker>');
    process.exitCode = 2;
  } else {
    try {
      const report = compare(analyze(baseline, baselineMarker), analyze(after, afterMarker));
      writeFileSync(output, report.markdown + '\n');
      console.log(report.markdown);
    } catch (e) {
      console.error(`compare: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
