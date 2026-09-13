// Guest global `fs` (A-D5). Root-scoped via assertInside.
//
// Two hardening passes live here (slice 030):
//   * Cooperating writers serialize on a cross-process lock keyed by the
//     canonical resolved path, and the lock is held across the whole
//     read -> validate -> atomic replacement. Atomic replacement alone does not
//     prevent a lost update: two writers can each read the same original, each
//     rename their own complete file, and the second silently erases the first.
//   * Reads are bounded at the descriptor. The cap used to be applied after
//     readFile() had already pulled the whole file into memory.
import { readdir, stat, mkdir, writeFile, rename, chmod, unlink, open } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withFileLock, DEFAULT_LOCK_TIMEOUT_MS } from './file-lock.js';
import { readBounded, readLines, eachLine, READ_CAP } from './file-read.js';

// A single returned line is bounded so one pathological minified file cannot
// blow the result budget. The bound is the same 256 KB read cap rather than a
// small value, so ordinary long lines survive intact and only genuinely
// excessive ones are cut.
const MAX_LINE_BYTES = READ_CAP;
const MAX_GREP_LINE_BYTES = 1024 * 1024;

function truncNote(total, kept) {
  return `\n[truncated: kept ${kept} of ${total} bytes — re-read with a larger maxBytes, a byte range, or use fs.grepFile]`;
}

// `instanceof RegExp` is false for a RegExp built in another realm, which is
// exactly what a vm guest hands us. The old check silently fell through to
// String(pattern) and compiled "/^## /" as a LITERAL, so a guest regex matched
// nothing. util.types.isRegExp is realm-independent.
function toMatcher(pattern, ignoreCase) {
  if (utilTypes.isRegExp(pattern)) {
    // Strip g/y: a sticky or global regex carries lastIndex between .test()
    // calls, so scanning line by line skipped every other match.
    const flags = pattern.flags.replace(/[gy]/g, '') + (ignoreCase && !pattern.flags.includes('i') ? 'i' : '');
    return new RegExp(pattern.source, flags);
  }
  return new RegExp(String(pattern), ignoreCase ? 'i' : '');
}

function boundLine(text, maxLineBytes) {
  if (maxLineBytes === Infinity) return text;
  const bytes = Buffer.byteLength(text);
  if (bytes <= maxLineBytes) return text;
  // Slice on a CHARACTER boundary. Cutting the buffer at an arbitrary byte
  // splits a multibyte character and yields U+FFFD at the seam.
  const buf = Buffer.from(text, 'utf8');
  let end = maxLineBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  const kept = buf.subarray(0, end).toString('utf8');
  return `${kept}…[line truncated: kept ${Buffer.byteLength(kept)} of ${bytes} bytes]`;
}

export function createFs({ assertInside, signal, lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {}) {
  const lockOpts = { timeoutMs: lockTimeoutMs, signal };

  // Atomic replacement that preserves the existing mode. The temporary file is
  // created in the target's own directory because rename() is only atomic
  // within one filesystem, and it is renamed away before this resolves, so it
  // never lingers in the user's tree. Only this task-owned temp file is ever
  // removed — no broad cleanup of user files happens anywhere in this module.
  async function replaceAtomically(target, content) {
    signal?.throwIfAborted();
    let mode;
    try { mode = (await stat(target)).mode & 0o777; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const tmp = path.join(path.dirname(target), `.codemode-${randomUUID()}.tmp`);
    let owned = false;
    try {
      signal?.throwIfAborted();
      const handle = await open(tmp, 'wx', mode ?? 0o666);
      owned = true;
      try { await handle.writeFile(content, { encoding: 'utf8', signal }); }
      finally { await handle.close(); }
      if (mode !== undefined) await chmod(tmp, mode);
      signal?.throwIfAborted();
      await rename(tmp, target);
      owned = false;
    } finally {
      if (owned) await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
    return { bytes: Buffer.byteLength(content) };
  }

  const api = {
    async read(p, { maxBytes = READ_CAP, offset = 0 } = {}) {
      const target = assertInside(p);
      const s = await stat(target);
      if (s.isDirectory()) throw new Error(`fs.read: ${p} is a directory; use fs.list`);
      const out = await readBounded(target, { maxBytes, offset, signal });
      if (out.truncated) {
        // Truncation used to be silent about how much was lost and what to do
        // next; a 224 KB memory page read as "complete" is a correctness bug
        // for anything that then claims a fact is absent.
        return out.text + truncNote(out.totalBytes, maxBytes);
      }
      return out.text;
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
    // spending the whole result budget on a file to find three lines. Streams,
    // so a 2 GB log does not become a 2 GB allocation, and stops at `max`.
    async grepFile(p, pattern, { context = 0, max = 100, ignoreCase = false, maxLineBytes = MAX_LINE_BYTES } = {}) {
      const target = assertInside(p);
      const re = toMatcher(pattern, ignoreCase);
      const hits = [];
      const before = [];
      let pendingAfter = [];

      await eachLine(target, (line, lineNo) => {
        // Finish the trailing context of the previous hit first.
        for (const open of pendingAfter) {
          if (open.remaining > 0) {
            open.lines.push(line);
            open.remaining -= 1;
          }
        }
        pendingAfter = pendingAfter.filter((o) => o.remaining > 0);

        if (hits.length < max && re.test(line)) {
          const hit = { line: lineNo, text: boundLine(line, maxLineBytes) };
          if (context > 0) {
            const open = {
              lines: [...before.slice(-context), line],
              remaining: context,
              hit,
            };
            pendingAfter.push(open);
            hit._open = open;
          }
          hits.push(hit);
        }

        if (context > 0) {
          before.push(line);
          if (before.length > context) before.shift();
        }
        return hits.length < max || pendingAfter.length > 0;
      }, { signal, maxLineBytes: MAX_GREP_LINE_BYTES });

      for (const hit of hits) {
        if (hit._open) {
          hit.context = hit._open.lines.map((l) => boundLine(l, maxLineBytes)).join('\n');
          delete hit._open;
        }
      }
      return hits.slice(0, max);
    },

    async write(p, content) {
      if (typeof content !== 'string') throw new Error('fs.write: content (string) is required');
      const target = assertInside(p);
      // Locked even though this is a whole-file overwrite: a concurrent
      // edit_file must not read the original while this replacement lands.
      return withFileLock(target, lockOpts, async () => {
        const { bytes } = await replaceAtomically(target, content);
        return { wrote: target, bytes };
      });
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
      if (offset === undefined && limit === undefined) {
        // The unpaged contract is unchanged: over 262144 bytes it refuses and
        // tells the caller to page, rather than returning a silent prefix.
        if (s.size > READ_CAP) {
          throw new Error('read_file: file exceeds 262144 bytes; pass offset/limit');
        }
        const out = await readBounded(target, { maxBytes: READ_CAP, signal });
        return out.text;
      }
      const out = await readLines(target, { offset: offset ?? 1, limit, signal });
      return out.text;
    },

    async write_file({ file_path, content } = {}) {
      if (typeof file_path !== 'string' || !file_path) throw new Error('write_file: file_path (non-empty string) is required');
      if (typeof content !== 'string') throw new Error('write_file: content (string) is required');
      const target = assertInside(file_path);
      // Create-only stays `wx` — that flag IS the atomic create check. The lock
      // only coordinates it with edit_file/fs.write on the same path.
      return withFileLock(target, lockOpts, async () => {
        try {
          await writeFile(target, content, { encoding: 'utf8', flag: 'wx', signal });
        } catch (e) {
          if (e && e.code === 'EEXIST') throw new Error(`write_file: already exists: ${file_path}`);
          throw e;
        }
        return { wrote: target, bytes: Buffer.byteLength(content) };
      });
    },

    // `eof` is an INTERNAL opt-in used only by apply_patch's *** End of File
    // marker. The public plain schema ({ path, edits, appendText }) is
    // unchanged: without an explicit eof:true every edit keeps the strict
    // unique-match contract.
    async edit_file({ path: p, appendText, edits = [], eof = false } = {}) {
      if (typeof p !== 'string' || !p) throw new Error('edit_file: path (non-empty string) is required');
      if (!Array.isArray(edits)) throw new Error('edit_file: edits must be an array');
      if (edits.length === 0 && (typeof appendText !== 'string' || appendText.length === 0)) {
        throw new Error('edit_file: empty edits only allowed with appendText');
      }
      const target = assertInside(p);

      // The lock spans read -> validate -> replace. Reading outside it would
      // reintroduce the lost update: the uniqueness check and the offsets are
      // computed against an original that another writer may already have
      // replaced by the time we write.
      return withFileLock(target, lockOpts, async () => {
        const original = (await readBounded(target, { maxBytes: Infinity, signal })).text;
        const ranges = [];
        for (const ed of edits) {
          if (!ed || typeof ed.oldText !== 'string' || typeof ed.newText !== 'string') {
            throw new Error('edit_file: each edit needs oldText and newText strings');
          }
          if (ed.oldText === '') {
            // An empty oldText matches at every position, so "not unique" was a
            // confusing way to report what is really a malformed edit.
            throw new Error('edit_file: oldText must not be empty (use appendText to add text without an anchor)');
          }
          const anchorEof = eof === true && ed.atEof === true;
          const first = anchorEof ? original.lastIndexOf(ed.oldText) : original.indexOf(ed.oldText);
          if (first === -1) throw new Error(`edit_file: oldText not found: ${ed.oldText.slice(0, 80)}`);
          if (anchorEof) {
            // The EOF marker means "this chunk sits at the end of the file". If
            // the last occurrence is in the middle, the patch is describing a
            // file that is not the one on disk, so applying it anyway would
            // edit the wrong place while claiming an EOF anchor.
            const tail = original.slice(first + ed.oldText.length);
            if (tail.replace(/\r?\n$/, '') !== '') {
              throw new Error(
                'edit_file: *** End of File anchor does not reach the end of the file; ' +
                `${JSON.stringify(tail.slice(0, 40))} follows the last match`,
              );
            }
          }
          if (!anchorEof && original.indexOf(ed.oldText, first + 1) !== -1) {
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
        await replaceAtomically(target, next);
        const diff = `--- a/${p}\n+++ b/${p}\n@@\n${original}\n→\n${next}`;
        return {
          path: target,
          replacements: edits.length,
          appended: typeof appendText === 'string' && appendText.length > 0,
          diff,
        };
      });
    },
  };
  return Object.freeze(api);
}
