// Download original images directly instead of screenshotting the page around them.
//
// The magic bytes gate the WRITE. Content-Type is a claim the server makes, and a block
// page or a login redirect can send image/png while being HTML — so nothing reaches disk
// until mimeOf/imageDimensions recognise real PNG or JPEG bytes. Writing first and
// verifying second would leave an HTML error page on disk under a host-generated .png name,
// which is exactly the outcome this is supposed to prevent.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageDimensions, mimeOf } from './image.js';

export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export class MediaError extends Error {
  constructor(message, code) { super(message); this.name = 'MediaError'; this.code = code; }
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg' };

// Discovery runs this same pre-flight. Keeping it ahead of fetch and mkdir is what makes
// asking whether a call is valid observational: no probe can create a directory or send a
// request merely because an agent checked its arguments.
export function validateDownloadMedia(urls, opts = {}) {
  if (!Array.isArray(urls) || urls.length === 0) throw new MediaError('downloadMedia requires a non-empty array of urls', 'EBADVAL');
  if (!opts.outDir) throw new MediaError('downloadMedia requires { outDir }', 'EBADVAL');
}

export function createDownloadMedia({ fetchImpl, assertInside, deps = {} } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);

  // Stop reading at the cap rather than after it. A body with no content-length, or one
  // that lies about it, is the case this exists for.
  async function readCapped(res, maxBytes) {
    const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
    if (!reader) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new MediaError(`image is ${buf.length} bytes, over the ${maxBytes} cap`, 'ETOOBIG');
      return buf;
    }
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch (_) { /* the socket is going away either way */ }
        throw new MediaError(`the download passed the ${maxBytes} byte cap and was stopped`, 'ETOOBIG');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  }

  async function one(url, outDir, maxBytes) {
    if (typeof url !== 'string' || !/^https?:/i.test(url)) throw new MediaError('media urls must be http(s)', 'EBADVAL');
    const res = await doFetch(url, { redirect: 'follow' });
    if (!res.ok) throw new MediaError(`the server returned ${res.status}`, 'EUPSTREAM');
    const declared = String(res.headers && res.headers.get ? res.headers.get('content-type') || '' : '');
    // The cap has to bite before the bytes are in memory. Reading the whole body and then
    // measuring it protected the disk and nothing else: a multi-gigabyte response was
    // already resident by the time we refused it.
    const declaredLength = Number((res.headers && res.headers.get && res.headers.get('content-length')) || 0);
    if (declaredLength && declaredLength > maxBytes) {
      throw new MediaError(`the server declared ${declaredLength} bytes, over the ${maxBytes} cap`, 'ETOOBIG');
    }
    const buf = await readCapped(res, maxBytes);

    const sniffed = mimeOf(buf);
    if (!EXT[sniffed]) {
      // The decisive check. Nothing is written.
      throw new MediaError(`the response is not a PNG or JPEG (server said "${declared || 'nothing'}"); refusing to save it as an image`, 'ENOTIMAGE');
    }
    const dims = imageDimensions(buf);
    const name = `img-${randomUUID()}.${EXT[sniffed]}`;
    const dest = assertInside ? assertInside(path.join(outDir, name)) : path.join(outDir, name);
    await (deps.writeFileImpl || writeFile)(dest, buf);
    return { url, ok: true, path: dest, bytes: buf.length, mime: sniffed, declaredMime: declared || null, width: dims ? dims.width : null, height: dims ? dims.height : null };
  }

  return async function downloadMedia(urls, opts = {}) {
    validateDownloadMedia(urls, opts);
    if (!doFetch) throw new MediaError('no fetch implementation is available', 'ENOTSUP');
    const outDir = assertInside ? assertInside(opts.outDir) : opts.outDir;
    await (deps.mkdirImpl || mkdir)(outDir, { recursive: true });
    const maxBytes = Number.isSafeInteger(opts.maxBytes) ? opts.maxBytes : DEFAULT_MAX_BYTES;
    const settled = await Promise.allSettled(urls.map((u) => one(u, outDir, maxBytes)));
    const items = settled.map((s, i) => (s.status === 'fulfilled' ? s.value : { url: urls[i], ok: false, code: s.reason && s.reason.code, error: String(s.reason && s.reason.message ? s.reason.message : s.reason) }));
    return { items, ok: items.every((i) => i.ok), partial: items.some((i) => !i.ok) ? ['item-failure'] : [] };
  };
}
