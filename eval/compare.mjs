// Compare two log-dumps (020 D3, wp2 A 교정본): message.timestamp span + file span,
// tool-call counts, needle hit. Writes evidence/summary.md.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [,, baselineFile, afterFile, outFile, baselineMark, afterMark] = process.argv;
if (!baselineFile || !afterFile || !outFile) {
  console.error('usage: node compare.mjs <baseline.jsonl> <after.jsonl> <summary.md> [baselineMark] [afterMark]');
  process.exit(2);
}

function analyze(file, needle) {
  const events = readFileSync(file, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const stamps = events.map((e) => e.message && e.message.timestamp).filter((t) => Number.isFinite(t));
  const spanMs = stamps.length >= 2 ? Math.max(...stamps) - Math.min(...stamps) : null;
  const st = statSync(file);
  const fileSpanMs = Math.round(st.mtimeMs - st.birthtimeMs);
  const starts = events.filter((e) => e.type === 'tool_execution_start');
  const toolNames = starts.map((e) => e.toolName);
  const ends = events.filter((e) => e.type === 'tool_execution_end');
  const hit = ends.some((e) => JSON.stringify(e.result ?? {}).includes(needle));
  return { file, spanMs, fileSpanMs, toolCalls: toolNames, hit };
}

const b = analyze(baselineFile, baselineMark ?? 'area-18');
const a = analyze(afterFile, afterMark ?? 'area-29');
const ratio = a.spanMs && b.spanMs ? (a.spanMs / b.spanMs) : null;
const verdict = a.hit && ratio !== null && ratio < 0.5 ? 'PASS (c-speedup)' : 'REVIEW NEEDED';

const md = [
  '# codemode exec 측정 요약',
  '',
  '| 항목 | baseline (NEEDLE-A2) | after (NEEDLE-A3) |',
  '| --- | --- | --- |',
  `| dump | ${path.basename(b.file)} | ${path.basename(a.file)} |`,
  `| wall-clock (message.timestamp 스팬) | ${b.spanMs} ms | ${a.spanMs} ms |`,
  `| wall-clock (파일 스팬, 보조) | ${b.fileSpanMs} ms | ${a.fileSpanMs} ms |`,
  `| 툴콜 | ${b.toolCalls.join(', ')} (${b.toolCalls.length}) | ${a.toolCalls.join(', ')} (${a.toolCalls.length}) |`,
  `| needle 적중 | ${b.hit} | ${a.hit} |`,
  '',
  `ratio: ${ratio === null ? 'n/a' : ratio.toFixed(3)} (판정 기준: < 0.5)`,
  `verdict: **${verdict}**`,
  '',
  '오염 메모: baseline 첫 bash 호출은 경로 오타(codemod-eval)로 1회 실패 후 재시도했다(공개된 오염, 기각 사유 아님).',
  ''].join('\n');
writeFileSync(outFile, md);
console.log(md);
