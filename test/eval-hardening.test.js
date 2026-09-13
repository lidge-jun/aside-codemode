import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const compare = new URL('../eval/compare.mjs', import.meta.url);

function fixture(error = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-eval-test-'));
  const events = [
    { type: 'message_end', message: { role: 'turn-lifecycle', event: 'started', timestamp: 1000 } },
    { type: 'tool_execution_start', toolName: 'bash' },
    { type: 'tool_execution_end', isError: error, result: { content: [{ type: 'text', text: 'MARK-XYZ' }] } },
    { type: 'message_end', message: { role: 'assistant', timestamp: 1200, completedAt: 1500, content: [{ type: 'text', text: 'MARK-XYZ' }] } },
  ];
  const file = path.join(root, 'log.jsonl');
  writeFileSync(file, events.map(x => JSON.stringify(x)).join('\n'));
  return { root, file };
}

test('comparison requires explicit markers, not unrelated default needles', () => {
  const { file, root } = fixture();
  const r = spawnSync(process.execPath, [fileURLToPath(compare), file, file, path.join(root, 'summary.md')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /marker|required|usage/i);
});

test('event completion timestamps are portable and failed echoes are not hits', async () => {
  const { analyze } = await import(compare);
  const good = analyze(fixture().file, 'MARK-XYZ');
  const bad = analyze(fixture(true).file, 'MARK-XYZ');
  assert.equal(good.spanMs, 500);
  assert.equal(good.toolNeedleHit, true);
  assert.equal(bad.toolNeedleHit, false);
  assert.equal(bad.toolFailures, 1);
  assert.equal(good.correctness, 'not_verified');
  assert.equal(Object.hasOwn(good, 'fileSpanMs'), false);
});
