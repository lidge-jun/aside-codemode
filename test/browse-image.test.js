// Image readers. The request is not evidence — maxWidth was measured to be ignored — so
// these read the real geometry out of the bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pngDimensions, jpegDimensions, imageDimensions, mimeOf, verifyCapture, isPng, isJpeg, RESIZE_UNSUPPORTED } from '../src/host/browse/image.js';

function png(width, height) {
  const b = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpeg(width, height) {
  const b = Buffer.alloc(24, 0);
  b[0] = 0xff; b[1] = 0xd8;
  b[2] = 0xff; b[3] = 0xc0;
  b.writeUInt16BE(17, 4);
  b[6] = 8;
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  return b;
}

test('PNG height is read from byte 20, not byte 24', () => {
  // Reading 24 lands on the bit-depth/colour-type bytes and yields a nonsense height.
  // A first pass at this returned 1440x134348800.
  assert.deepEqual(pngDimensions(png(1440, 900)), { width: 1440, height: 900 });
  assert.deepEqual(pngDimensions(png(320, 200)), { width: 320, height: 200 });
});

test('JPEG dimensions come from the SOF marker', () => {
  assert.deepEqual(jpegDimensions(jpeg(640, 480)), { width: 640, height: 480 });
});

test('format sniffing does not guess', () => {
  assert.equal(isPng(png(1, 1)), true);
  assert.equal(isJpeg(jpeg(1, 1)), true);
  assert.equal(isPng(jpeg(1, 1)), false);
  assert.equal(mimeOf(png(1, 1)), 'image/png');
  assert.equal(mimeOf(jpeg(1, 1)), 'image/jpeg');
  assert.equal(mimeOf(Buffer.from('nonsense')), 'application/octet-stream');
  assert.equal(imageDimensions(Buffer.from('nonsense')), null);
});

test('verifyCapture fails when clip geometry was not honoured', () => {
  const ok = verifyCapture(png(320, 200), { clip: { x: 0, y: 0, width: 320, height: 200 } });
  assert.equal(ok.matched, true);
  assert.equal(ok.reason, null);
  const bad = verifyCapture(png(1440, 900), { clip: { x: 0, y: 0, width: 320, height: 200 } });
  assert.equal(bad.matched, false);
  assert.match(bad.reason, /asked for 320x200 but the image is 1440x900/);
});

test('unreadable bytes are reported as unverified, never as a pass', () => {
  const r = verifyCapture(Buffer.from('not an image'), {});
  assert.equal(r.matched, false);
  assert.match(r.reason, /not a readable PNG or JPEG/);
});

test('resize is a stated refusal rather than a silent no-op', () => {
  assert.match(RESIZE_UNSUPPORTED, /clip/);
});
