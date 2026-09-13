// Bounded and streamed file reads (slice 030).
//
// The defect this replaces: every read path called readFile() first and applied
// the cap afterwards. Asking for 1 KB out of an 8 MB file still allocated 8 MB,
// so the "cap" bounded the RESULT but not the WORK — a large file could blow
// memory on a read that was declared bounded.
//
// Here the descriptor does the bounding: a capped read asks for at most the cap, and a paged read streams chunks and stops as soon as the
// requested line window has been collected.
import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

export const READ_CAP = 256 * 1024;
const STREAM_CHUNK = 64 * 1024;

// A fixed-size chunk read can split a multibyte UTF-8 character in half.
// Decoding each chunk independently turns that character into U+FFFD and
// silently corrupts the text (measured: 'a'.repeat(65535) + '한글' lost the
// '한'). StringDecoder holds the incomplete trailing bytes until the next
// chunk completes them.
function makeDecoder() {
  return new StringDecoder('utf8');
}

/**
 * Read at most `maxBytes` from `p`, touching no more than that many bytes.
 * Returns { text, bytesRead, totalBytes, truncated }.
 */
export async function readBounded(p, { maxBytes = READ_CAP, offset = 0, signal } = {}) {
  signal?.throwIfAborted();
  if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new Error('maxBytes must be a non-negative integer');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer');
  const info = await stat(p);
  if (!info.isFile()) throw new Error('read: expected a regular file');
  const totalBytes = info.size;
  const cap = Math.max(0, maxBytes);
  const start = Math.max(0, offset);
  const remaining = Math.max(0, totalBytes - start);
  const want = Math.min(cap, remaining);

  const fh = await open(p, 'r');
  try {
    const buf = Buffer.allocUnsafe(want);
    let filled = 0;
    while (filled < want) {
      signal?.throwIfAborted();
      const { bytesRead } = await fh.read(buf, filled, want - filled, start + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    // A byte cap can land mid-character. Decoding the raw slice would emit
    // U+FFFD at the seam, i.e. invent a character that is not in the file.
    // Back off to the last complete character instead. Only do this when the
    // file actually continues, so a genuinely truncated final byte sequence at
    // real EOF is still reported as-is.
    let end = filled;
    if (remaining > filled) {
      // Walk back to the lead byte of the last character, then drop that
      // character entirely if the cap cut it short.
      let i = end - 1;
      while (i >= 0 && (buf[i] & 0xc0) === 0x80) i -= 1;
      if (i >= 0) {
        const lead = buf[i];
        const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
        if (i + need > end) end = i;
      }
    }
    return {
      text: buf.subarray(0, end).toString('utf8'),
      bytesRead: filled,
      totalBytes,
      truncated: remaining > filled,
    };
  } finally {
    await fh.close();
  }
}

/** Read a line window while bounding both individual lines and retained output. */
export async function readLines(p, {
  offset = 1, limit, maxBytes = Infinity, maxLineBytes = READ_CAP,
  maxOutputBytes = READ_CAP, signal,
} = {}) {
  const out = [];
  let retained = 0;
  const end = limit === undefined ? Infinity : offset + limit - 1;
  const scan = await eachLine(p, (line, lineNo) => {
    if (lineNo < offset) return true;
    const cost = Buffer.byteLength(line) + (out.length ? 1 : 0);
    if (retained + cost > maxOutputBytes) {
      throw new Error(`read_file: line window exceeds ${maxOutputBytes} output bytes; reduce limit or use fs.read with a byte range`);
    }
    retained += cost;
    out.push(line);
    return lineNo < end;
  }, { maxBytes, maxLineBytes, signal });
  return { text: out.join('\n'), bytesRead: scan.bytesRead, lines: out };
}

/** Stream physical lines, preserving UTF-8 seams and the final empty split line. */
export async function eachLine(p, onLine, { maxBytes = Infinity, maxLineBytes = READ_CAP, signal } = {}) {
  signal?.throwIfAborted();
  const info = await stat(p);
  if (!info.isFile()) throw new Error('read: expected a regular file');
  const fh = await open(p, 'r');
  try {
    const chunk = Buffer.allocUnsafe(STREAM_CHUNK);
    const decoder = makeDecoder();
    let carry = '', lineNo = 1, bytesRead = 0;
    const checkLine = (line) => {
      if (Buffer.byteLength(line) > maxLineBytes) {
        throw new Error(`read: a single line exceeds ${maxLineBytes} bytes; use fs.read with maxBytes/offset`);
      }
    };
    for (;;) {
      signal?.throwIfAborted();
      const remaining = maxBytes - bytesRead;
      if (remaining <= 0) throw new Error('read: scan byte limit reached before EOF');
      const { bytesRead: n } = await fh.read(chunk, 0, Math.min(STREAM_CHUNK, remaining), bytesRead);
      if (!n) break;
      bytesRead += n;
      carry += decoder.write(chunk.subarray(0, n));
      let newline;
      while ((newline = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, newline).replace(/\r$/, '');
        carry = carry.slice(newline + 1);
        checkLine(line);
        if (onLine(line, lineNo++) === false) return { bytesRead, stopped: true };
      }
      // Check only the unfinished line, never the whole multi-line chunk.
      checkLine(carry);
    }
    carry += decoder.end();
    checkLine(carry);
    onLine(carry, lineNo);
    return { bytesRead, stopped: false };
  } finally { await fh.close(); }
}
