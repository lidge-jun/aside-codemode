// Guest global `fs` (A-D5). Root-scoped via assertInside.
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';

const READ_CAP = 256 * 1024;

function truncNote(total, kept) {
  return `\n[truncated: kept ${kept} of ${total} bytes — re-read with a larger maxBytes, a byte range, or use fs.grepFile]`;
}

export function createFs({ assertInside }) {
  const api = {
    async read(p, { maxBytes = READ_CAP, offset = 0 } = {}) {
      const target = assertInside(p);
      const s = await stat(target);
      if (s.isDirectory()) throw new Error(`fs.read: ${p} is a directory; use fs.list`);
      const buf = await readFile(target);
      const slice = offset > 0 ? buf.subarray(offset) : buf;
      if (slice.length > maxBytes) {
        // Truncation used to be silent about how much was lost and what to do
        // next; a 224 KB memory page read as "complete" is a correctness bug
        // for anything that then claims a fact is absent.
        return slice.subarray(0, maxBytes).toString('utf8') + truncNote(buf.length, maxBytes);
      }
      return slice.toString('utf8');
    },

    // Read many files in one call. The whole point of code mode is avoiding
    // one round trip per file; doing it here also lets us bound total bytes.
    async readMany(paths, { maxBytes = 32 * 1024, totalBytes = 512 * 1024 } = {}) {
      if (!Array.isArray(paths)) throw new Error('fs.readMany: paths (array of strings) is required');
      const out = [];
      let spent = 0;
      for (const p of paths) {
        if (spent >= totalBytes) {
          out.push({ path: p, skipped: 'total byte budget exhausted' });
          continue;
        }
        try {
          const budget = Math.min(maxBytes, totalBytes - spent);
          const text = await api.read(p, { maxBytes: budget });
          spent += Buffer.byteLength(text);
          out.push({ path: p, text });
        } catch (e) {
          out.push({ path: p, error: e.message });
        }
      }
      return out;
    },

    // Pull only matching lines out of one big file, with context. Avoids
    // spending the whole result budget on a file to find three lines.
    async grepFile(p, pattern, { context = 0, max = 100, ignoreCase = false } = {}) {
      const target = assertInside(p);
      const buf = await readFile(target);
      const lines = buf.toString('utf8').split(/\r?\n/);
      const re = pattern instanceof RegExp
        ? pattern
        : new RegExp(String(pattern), ignoreCase ? 'i' : '');
      const hits = [];
      for (let i = 0; i < lines.length && hits.length < max; i += 1) {
        if (!re.test(lines[i])) continue;
        const from = Math.max(0, i - context);
        const to = Math.min(lines.length - 1, i + context);
        hits.push({
          line: i + 1,
          text: lines[i],
          ...(context > 0 ? { context: lines.slice(from, to + 1).join('\n') } : {}),
        });
      }
      return hits;
    },

    async write(p, content) {
      if (typeof content !== 'string') throw new Error('fs.write: content (string) is required');
      const target = assertInside(p);
      await writeFile(target, content, 'utf8');
      return { wrote: target, bytes: Buffer.byteLength(content) };
    },

    async mkdir(p) {
      const target = assertInside(p);
      await mkdir(target, { recursive: true });
      return { created: target };
    },

    async stat(p) {
      const target = assertInside(p);
      const s = await stat(target);
      return {
        path: target,
        type: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other',
        size: s.size,
        mtimeMs: s.mtimeMs,
      };
    },

    async exists(p) {
      try {
        const target = assertInside(p);
        await stat(target);
        return true;
      } catch {
        return false;
      }
    },

    async list(p, { max = 1000, recursive = false, depth = 3 } = {}) {
      const target = assertInside(p);
      if (!recursive) {
        const entries = await readdir(target, { withFileTypes: true });
        const out = [];
        for (const e of entries.slice(0, max)) {
          let size = null;
          try {
            size = e.isFile() ? (await stat(path.join(target, e.name))).size : null;
          } catch {
            size = null;
          }
          out.push({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other', size });
        }
        return out;
      }
      const out = [];
      const walk = async (dir, rel, d) => {
        if (out.length >= max || d > depth) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (out.length >= max) return;
          const name = rel ? `${rel}/${e.name}` : e.name;
          const abs = path.join(dir, e.name);
          if (e.isDirectory()) {
            out.push({ name, type: 'dir', size: null });
            await walk(abs, name, d + 1);
          } else {
            let size = null;
            try { size = (await stat(abs)).size; } catch {}
            out.push({ name, type: e.isFile() ? 'file' : 'other', size });
          }
        }
      };
      await walk(target, '', 1);
      return out;
    },

    async read_file({ path: p, offset, limit } = {}) {
      if (typeof p !== 'string' || !p) throw new Error('read_file: path (non-empty string) is required');
      for (const [name, v] of [['offset', offset], ['limit', limit]]) {
        if (v === undefined) continue;
        if (!Number.isInteger(v) || v < 1) throw new Error('read_file: offset/limit must be a positive integer');
      }
      const target = assertInside(p);
      const s = await stat(target);
      if (s.isDirectory()) throw new Error(`read_file: ${p} is a directory`);
      const buf = await readFile(target);
      if (offset === undefined && limit === undefined && buf.length > READ_CAP) {
        throw new Error('read_file: file exceeds 262144 bytes; pass offset/limit');
      }
      const text = buf.toString('utf8');
      if (offset === undefined && limit === undefined) return text;
      const lines = text.split(/\r?\n/);
      const start = (offset ?? 1) - 1;
      const end = limit === undefined ? lines.length : start + limit;
      return lines.slice(start, end).join('\n');
    },

    async write_file({ file_path, content } = {}) {
      if (typeof file_path !== 'string' || !file_path) throw new Error('write_file: file_path (non-empty string) is required');
      if (typeof content !== 'string') throw new Error('write_file: content (string) is required');
      const target = assertInside(file_path);
      try {
        await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
      } catch (e) {
        if (e && e.code === 'EEXIST') throw new Error(`write_file: already exists: ${file_path}`);
        throw e;
      }
      return { wrote: target, bytes: Buffer.byteLength(content) };
    },

    async edit_file({ path: p, appendText, edits = [] } = {}) {
      if (typeof p !== 'string' || !p) throw new Error('edit_file: path (non-empty string) is required');
      if (!Array.isArray(edits)) throw new Error('edit_file: edits must be an array');
      if (edits.length === 0 && (typeof appendText !== 'string' || appendText.length === 0)) {
        throw new Error('edit_file: empty edits only allowed with appendText');
      }
      const target = assertInside(p);
      const original = (await readFile(target)).toString('utf8');
      const ranges = [];
      for (const ed of edits) {
        if (!ed || typeof ed.oldText !== 'string' || typeof ed.newText !== 'string') {
          throw new Error('edit_file: each edit needs oldText and newText strings');
        }
        const first = original.indexOf(ed.oldText);
        if (first === -1) throw new Error(`edit_file: oldText not found: ${ed.oldText.slice(0, 80)}`);
        if (original.indexOf(ed.oldText, first + 1) !== -1) {
          throw new Error(`edit_file: oldText not unique: ${ed.oldText.slice(0, 80)}`);
        }
        ranges.push({ start: first, end: first + ed.oldText.length, newText: ed.newText });
      }
      ranges.sort((a, b) => a.start - b.start);
      for (let i = 1; i < ranges.length; i += 1) {
        if (ranges[i].start < ranges[i - 1].end) throw new Error('edit_file: overlapping edits');
      }
      let next = original;
      for (let i = ranges.length - 1; i >= 0; i -= 1) {
        const r = ranges[i];
        next = next.slice(0, r.start) + r.newText + next.slice(r.end);
      }
      if (typeof appendText === 'string' && appendText.length) next += appendText;
      await writeFile(target, next, 'utf8');
      const diff = `--- a/${p}\n+++ b/${p}\n@@\n${original}\n→\n${next}`;
      return {
        path: target,
        replacements: edits.length,
        appended: typeof appendText === 'string' && appendText.length > 0,
        diff,
      };
    },
  };
  return Object.freeze(api);
}
