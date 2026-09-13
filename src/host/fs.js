// Guest global `fs` (A-D5). Root-scoped via assertInside.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';

const READ_CAP = 256 * 1024;

export function createFs({ assertInside }) {
  return Object.freeze({
    async read(p, { maxBytes = READ_CAP } = {}) {
      const target = assertInside(p);
      const s = await stat(target);
      if (s.isDirectory()) throw new Error(`fs.read: ${p} is a directory; use fs.list`);
      const buf = await readFile(target);
      if (buf.length > maxBytes) {
        return buf.subarray(0, maxBytes).toString('utf8') + `\n[truncated: ${buf.length} bytes total]`;
      }
      return buf.toString('utf8');
    },
    async write(p, content) {
      if (typeof content !== 'string') throw new Error('fs.write: content (string) is required');
      const target = assertInside(p);
      await writeFile(target, content, 'utf8');
      return { wrote: target, bytes: Buffer.byteLength(content) };
    },
    async list(p, { max = 1000 } = {}) {
      const target = assertInside(p);
      const entries = await readdir(target, { withFileTypes: true });
      const out = [];
      for (const e of entries.slice(0, max)) {
        let size = null;
        try {
          size = e.isFile() ? (await stat(target + '/' + e.name)).size : null;
        } catch {
          size = null;
        }
        out.push({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other', size });
      }
      return out;
    },
  });
}
