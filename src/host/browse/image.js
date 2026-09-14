// Reading what was ACTUALLY captured, because the request is not evidence.
// screenshot({ maxWidth: 640 }) was measured to return a byte-identical full-size image,
// so the only way to know the real geometry is to read it out of the file.
//
// Resize is deliberately absent — see ENOTSUP below.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIG);
}

export function isJpeg(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

export function pngDimensions(buf) {
  if (!isPng(buf)) return null;
  // IHDR: width at byte 16, height at byte 20. Getting 20 wrong reads the bit-depth bytes
  // and yields a nonsense height, which is exactly what a first pass here did.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function jpegDimensions(buf) {
  if (!isJpeg(buf)) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    // SOF0-SOF15, excluding the non-frame markers DHT(c4), JPG(c8) and DAC(cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

export function imageDimensions(buf) {
  return pngDimensions(buf) || jpegDimensions(buf);
}

export function mimeOf(buf) {
  if (isPng(buf)) return 'image/png';
  if (isJpeg(buf)) return 'image/jpeg';
  return 'application/octet-stream';
}

// Resize is ENOTSUP on purpose. Resampling a bitmap in pure JS with zero dependencies would
// be slow and would look worse than what the browser already produces, and shipping a bad
// resize under the name of a good one is the silent degradation this whole layer refuses.
// The supported geometry control is `clip` at capture time, which was measured to be
// honoured exactly: 320x200 requested, 320x200 returned.
export const RESIZE_UNSUPPORTED = 'host-side resize is not implemented: use screenshot.clip, which is honoured exactly, or re-capture at the size you need';

export function verifyCapture(buf, requested = {}) {
  const dims = imageDimensions(buf);
  const out = {
    bytes: Buffer.isBuffer(buf) ? buf.length : 0,
    mime: mimeOf(buf),
    width: dims ? dims.width : null,
    height: dims ? dims.height : null,
    matched: true,
    reason: null,
  };
  const clip = requested.clip;
  if (clip && dims) {
    if (dims.width !== clip.width || dims.height !== clip.height) {
      out.matched = false;
      out.reason = `clip asked for ${clip.width}x${clip.height} but the image is ${dims.width}x${dims.height}`;
    }
  }
  if (!dims) {
    out.matched = false;
    out.reason = 'the captured bytes are not a readable PNG or JPEG';
  }
  return out;
}
