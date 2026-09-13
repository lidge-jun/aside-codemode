// Guest apply_patch: Codex-shaped freeform text → write_file / edit_file.
// Not an AGENTS verb. Not an MCP tool. Success is {}.
//
// Slice 030 semantics:
//   * One `*** Update File:` section may carry several `@@` chunks. Each chunk
//     becomes one edit against the ORIGINAL file, and edit_file applies them in
//     a single locked read->replace, so a multi-hunk update is atomic per file.
//   * `@@ heading` text is context for a human reader, not an edit line.
//   * `*** End of File` anchors that chunk to the tail of the file, which is
//     the only way to disambiguate a repeated oldText. Without the marker a
//     repeated oldText is still refused, as before.
//   * `*** Add File:` writes the conventional POSIX trailing newline.
//   * The ENTIRE patch is parsed and validated before the first write.
//   * There is no cross-file transaction. When a later file fails, the error
//     keeps its original message/code and gains applied[] + failedFile so the
//     caller can see exactly what did land.

const EOF_MARKER = '*** End of File';

export function parseApplyPatch(input) {
  let text = input.replace(/^\uFEFF/, '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  }
  const lines = text.split(/\n/);
  if (lines[0].trim() !== '*** Begin Patch' || lines[lines.length - 1].trim() !== '*** End Patch') {
    throw new Error('apply_patch: first/last lines must be exactly *** Begin Patch / *** End Patch');
  }
  const hunks = [];
  let i = 1;
  while (i < lines.length - 1) {
    const line = lines[i];
    if (line.startsWith('*** Add File: ')) {
      const p = line.slice('*** Add File: '.length).trim();
      i += 1;
      const body = [];
      while (i < lines.length - 1 && !lines[i].startsWith('*** ')) {
        if (!lines[i].startsWith('+')) throw new Error('apply_patch: Add File lines must start with +');
        body.push(lines[i].slice(1));
        i += 1;
      }
      // A file that does not end in a newline is a diff-noise generator for
      // every later tool that touches it. Add the conventional terminator, but
      // never double one the patch already supplied.
      let content = body.join('\n');
      if (content.length && !content.endsWith('\n')) content += '\n';
      hunks.push({ type: 'add', path: p, content });
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const p = line.slice('*** Update File: '.length).trim();
      i += 1;
      const edits = [];
      let olds = [];
      let news = [];
      let atEof = false;
      let started = false;

      const flush = () => {
        if (!started) return;
        if (olds.length === 0 && news.length === 0) return;
        if (olds.length === 0) {
          // Pure-addition chunk with no '-' or ' ' line. There is nothing to
          // locate it by, so it would silently insert at the top of the file.
          // Reject during parse, before any earlier Add File has been written.
          throw new Error(
            `apply_patch: Update File ${p} has a chunk with no anchor — ` +
            'an oldText/context line ("-" or " ") is required to place the insertion',
          );
        }
        edits.push({ oldText: olds.join('\n'), newText: news.join('\n'), atEof });
        olds = [];
        news = [];
        atEof = false;
      };

      while (i < lines.length - 1 && !lines[i].startsWith('*** ')) {
        const L = lines[i];
        if (L === '@@' || L.startsWith('@@ ')) {
          // A new chunk begins. The text after `@@` is a human-facing heading,
          // never an edit line.
          flush();
          started = true;
          i += 1;
          continue;
        }
        started = true;
        if (L.startsWith('-')) olds.push(L.slice(1));
        else if (L.startsWith('+')) news.push(L.slice(1));
        else if (L.startsWith(' ')) { olds.push(L.slice(1)); news.push(L.slice(1)); }
        else throw new Error(`apply_patch: bad update line: ${L}`);
        i += 1;
      }
      if (i < lines.length - 1 && lines[i].trim() === EOF_MARKER) {
        atEof = true;
        i += 1;
      }
      flush();
      if (edits.length === 0) throw new Error(`apply_patch: Update File ${p} has no edits`);
      hunks.push({ type: 'update', path: p, edits });
      continue;
    }
    if (line.trim() === EOF_MARKER) {
      throw new Error('apply_patch: *** End of File must follow an *** Update File section');
    }
    if (line.startsWith('*** Delete File:') || line.startsWith('*** Move to:') || line.startsWith('*** Environment ID:')) {
      throw new Error('apply_patch: delete/move/environment not supported');
    }
    if (line.trim() === '') { i += 1; continue; }
    throw new Error(`apply_patch: unexpected line: ${line}`);
  }
  if (hunks.length === 0) throw new Error('apply_patch: patch contains no Add File or Update File section');
  return hunks;
}

export function createApplyPatch({ write_file, edit_file }) {
  return async function apply_patch(input) {
    if (typeof input !== 'string' || !input.trim()) throw new Error('apply_patch: freeform string required');
    // Parse and validate everything first; a malformed third hunk must not
    // leave the first two written.
    const hunks = parseApplyPatch(input);
    const applied = [];
    for (const h of hunks) {
      try {
        if (h.type === 'add') {
          const out = await write_file({ file_path: h.path, content: h.content });
          applied.push(out?.wrote ?? h.path);
        } else {
          // One file at a time, and edit_file releases its own lock before
          // returning — no call ever holds file A's lock while acquiring B's,
          // so the AB-BA deadlock is unreachable by construction.
          const out = await edit_file({ path: h.path, edits: h.edits, eof: h.edits.some((e) => e.atEof) });
          applied.push(out?.path ?? h.path);
        }
      } catch (e) {
        // Keep the original message and code; a caller matching on EROOT or on
        // "not unique" must keep working. Only add the progress detail.
        e.applied = applied;
        e.failedFile = h.path;
        throw e;
      }
    }
    return {};
  };
}
