// The A4 trap, pinned with real Aside output.
// letter-format-a4.pdf was produced by pdf({ format: 'A4' }) and is US Letter.
// a4-inches.pdf was produced by pdf({ paperWidth: 210/25.4, paperHeight: 297/25.4 }).
// Both were captured from the installed build on 2026-09-14 and reproduced 3/3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMediaBoxes, verifyPageBox } from '../src/host/browse/pagebox.js';
import { A4_INCHES } from '../src/host/browse/schema.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'browse');
const read = (n) => readFileSync(path.join(dir, n));

test("pdf({format:'A4'}) really produces US Letter, so a size check is not optional", () => {
  const boxes = readMediaBoxes(read('letter-format-a4.pdf'));
  assert.ok(boxes.length > 0, 'MediaBox must be readable from the raw bytes');
  assert.equal(boxes[0].x1 - boxes[0].x0, 612);
  assert.equal(boxes[0].y1 - boxes[0].y0, 792);
});

test('paperWidth/paperHeight in inches really produces A4', () => {
  const boxes = readMediaBoxes(read('a4-inches.pdf'));
  assert.ok(Math.abs((boxes[0].x1 - boxes[0].x0) - 595.92) < 0.1);
  assert.ok(Math.abs((boxes[0].y1 - boxes[0].y0) - 841.92) < 0.1);
});

test('verifyPageBox fails the Letter file and passes the A4 file for an A4 request', () => {
  const bad = verifyPageBox(read('letter-format-a4.pdf'), A4_INCHES);
  assert.equal(bad.matched, false);
  assert.match(bad.reason, /not the requested/);
  const good = verifyPageBox(read('a4-inches.pdf'), A4_INCHES);
  assert.equal(good.matched, true);
  assert.equal(good.reason, null);
});

test('a file with no MediaBox is reported as unverified rather than as a pass', () => {
  const r = verifyPageBox(Buffer.from('not a pdf'), A4_INCHES);
  assert.equal(r.matched, false);
  assert.match(r.reason, /no MediaBox/);
});
