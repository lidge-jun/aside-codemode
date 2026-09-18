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
import { open, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';
import path from 'node:path';
import { replaceAtomically } from './file-write.js';
import { withFileLock, DEFAULT_LOCK_TIMEOUT_MS } from './file-lock.js';
import { readBounded, readLines, eachLine, READ_CAP } from './file-read.js';
import { applyLineEdits } from './line-edit.js';
import { decorateSearchResult } from '../result-envelope.js';
import { hasNonAscii, nfc } from '../unicode.js';

// A single returned line is bounded so one pathological minified file cannot
// blow the result budget. The bound is the same 256 KB read cap rather than a
// small value, so ordinary long lines survive intact and only genuinely
// excessive ones are cut.
const MAX_LINE_BYTES = READ_CAP;
const MAX_GREP_LINE_BYTES = 1024 * 1024;

function truncNote(total, kept) {
  return `\n[truncated: kept ${kept} of ${total} bytes — re-read with a larger maxBytes, a byte range, or use fs.grepFile]`;
}

function rangeStartNote(skipped) {
  return `\n[range began mid-character: skipped ${skipped} bytes]`;
}

async function alignUtf8Offset(target, offset, totalBytes, signal) {
  if (offset === 0 || offset >= totalBytes) return { offset, skipped: 0 };
  const fh = await open(target, 'r');
  try {
    const bytes = Buffer.allocUnsafe(Math.min(3, totalBytes - offset));
    signal?.throwIfAborted();
    const { bytesRead } = await fh.read(bytes, 0, bytes.length, offset);
    let skipped = 0;
    // Valid UTF-8 has at most three continuation bytes. Advancing over them
    // preserves the caller's byte-range end without decoding a partial scalar.
    while (skipped < bytesRead && (bytes[skipped] & 0xc0) === 0x80) skipped += 1;
    return { offset: offset + skipped, skipped };
  } finally {
    await fh.close();
  }
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

  const api = {
    async read(p, { maxBytes = READ_CAP, offset = 0 } = {}) {
      const target = assertInside(p);
      const s = await stat(target);
      if (s.isDirectory()) throw new Error(`fs.read: ${p} is a directory; use fs.list`);
      const aligned = Number.isSafeInteger(offset) && offset >= 0
        ? await alignUtf8Offset(target, offset, s.size, signal)
        : { offset, skipped: 0 };
      const alignedMaxBytes = maxBytes === Infinity ? Infinity : Math.max(0, maxBytes - aligned.skipped);
      const out = await readBounded(target, { maxBytes: alignedMaxBytes, offset: aligned.offset, signal });
      const startNote = aligned.skipped ? rangeStartNote(aligned.skipped) : '';
      if (out.truncated) {
        // Truncation used to be silent about how much was lost and what to do
        // next; a 224 KB memory page read as "complete" is a correctness bug
        // for anything that then claims a fact is absent.
        return out.text + startNote + truncNote(out.totalBytes, alignedMaxBytes);
      }
      return out.text + startNote;
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
    async grepFile(p, pattern, { context = 0, max = 100, ignoreCase = false, normalize = true, maxLineBytes = MAX_LINE_BYTES } = {}) {
      if (!Number.isSafeInteger(max) || max <= 0) {
        throw new Error(`fs.grepFile: max must be a positive integer (got ${JSON.stringify(max)})`);
      }
      if (!Number.isSafeInteger(context) || context < 0) {
        throw new Error(`fs.grepFile: context must be a non-negative integer (got ${JSON.stringify(context)})`);
      }
      const target = assertInside(p);
      const re = toMatcher(pattern, ignoreCase);
      // A regex typed in one normalization form never matches a line stored in
      // the other, even though both render identically. Fold BOTH sides into a
      // second matcher and consult it only after the raw one misses, gated on a
      // non-ASCII matcher so an ASCII grep over a 2 GB log pays nothing.
      // toMatcher already stripped g/y, so neither regex carries lastIndex
      // between lines. The hit text below is always the RAW line: boundLine's
      // byte accounting has to describe what is actually on disk.
      //
      // FILE CONTENT is a different contract from a filename, so this is
      // disclosed and reversible rather than silently global: folding can only
      // ADD a match, never move a line number or change a returned byte, the
      // effective policy is reported on .scope, and normalize:false restores
      // byte-exact matching for a caller who is deliberately searching for one
      // normalization form.
      const folded = normalize && hasNonAscii(re.source) ? new RegExp(nfc(re.source), re.flags) : null;
      const matches = (line) => re.test(line) || (folded !== null && folded.test(nfc(line)));
      const hits = [];
      const before = [];
      let pendingAfter = [];
      let extraMatch = false;

      await eachLine(target, (line, lineNo) => {
        // Finish the trailing context of the previous hit first.
        for (const open of pendingAfter) {
          if (open.remaining > 0) {
            open.lines.push(line);
            open.remaining -= 1;
          }
        }
        pendingAfter = pendingAfter.filter((o) => o.remaining > 0);

        if (hits.length < max && matches(line)) {
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
        } else if (hits.length >= max && !extraMatch && matches(line)) {
          extraMatch = true;
          return pendingAfter.length > 0;
        }

        if (context > 0) {
          before.push(line);
          if (before.length > context) before.shift();
        }
        return !extraMatch || pendingAfter.length > 0;
      }, { signal, maxLineBytes: MAX_GREP_LINE_BYTES });

      for (const hit of hits) {
        if (hit._open) {
          hit.context = hit._open.lines.map((l) => boundLine(l, maxLineBytes)).join('\n');
          delete hit._open;
        }
      }
      return decorateSearchResult(hits.slice(0, max), {
        truncated: extraMatch,
        complete: !extraMatch,
        scope: { kind: 'grepFile', max, context, ignoreCase, normalize: folded !== null },
      });
    },

    async write(p, content) {
      if (typeof content !== 'string') throw new Error('fs.write: content (string) is required');
      const target = assertInside(p);
      // Locked even though this is a whole-file overwrite: a concurrent
      // edit_file must not read the original while this replacement lands.
      return withFileLock(target, lockOpts, async () => {
        const { bytes } = await replaceAtomically(target, content, { signal });
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
        // max+1 is what distinguishes "more existed" from a complete answer exactly max
        // long. src/rg-stream.js:10-14 already owns that rule for search; issue #37 was
        // this method slicing at max and returning a bare array, so 18 of 21 entries
        // vanished with nothing in the value saying so.
        for (const e of entries.slice(0, max + 1)) {
          let size = null;
          try {
            size = e.isFile() ? (await stat(path.join(target, e.name))).size : null;
          } catch {
            size = null;
          }
          out.push({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other', size });
        }
        const truncated = out.length > max;
        if (truncated) out.length = max;
        return decorateSearchResult(out, {
          truncated,
          partial: [],
          scope: { kind: 'list', path: target, max, recursive: false },
        });
      }
      const out = [];
      const unreadable = [];
      const walk = async (dir, rel, d) => {
        if (out.length > max || d > depth) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          // An unreadable directory may hide a whole subtree, so coverage is no longer
          // provable. Swallowing it returned a short list that called itself complete.
          unreadable.push(rel || '.');
          return;
        }
        for (const e of entries) {
          if (out.length > max) return;
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
      const truncated = out.length > max;
      if (truncated) out.length = max;
      return decorateSearchResult(out, {
        truncated,
        partial: unreadable.length ? ['unreadable-dirs'] : [],
        // depth is a SELECTOR: asking for depth 3 defines the request and does not make the
        // answer incomplete. max and an unreadable directory are losses.
        scope: { kind: 'list', path: target, max, recursive: true, depth, unreadableDirs: unreadable.slice(0, 10) },
      });
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

    // `eof` and `lineMatch` are INTERNAL opt-ins used only by apply_patch.
    // The public plain schema ({ path, edits, appendText }) is unchanged:
    // without eof:true every substring edit stays unique-match; without
    // lineMatch:true mid-line oldText still matches.
    async edit_file({ path: p, appendText, edits = [], eof = false, lineMatch = false } = {}) {
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
        if (lineMatch === true) {
          if (typeof appendText === 'string' && appendText.length) {
            throw new Error('edit_file: appendText is not supported with lineMatch');
          }
          const next = applyLineEdits(original, edits, { eof });
          await replaceAtomically(target, next, { signal });
          return {
            path: target,
            replacements: edits.length,
            appended: false,
            diff: `--- a/${p}\n+++ b/${p}\n@@\n${original}\n→\n${next}`,
          };
        }
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
        await replaceAtomically(target, next, { signal });
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
