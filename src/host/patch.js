// Guest apply_patch: Codex-shaped freeform text → write_file / edit_file.
// Not an AGENTS verb. Not an MCP tool. Success is {}.

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
      hunks.push({ type: 'add', path: p, content: body.join('\n') });
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const p = line.slice('*** Update File: '.length).trim();
      i += 1;
      if (lines[i] === '@@' || lines[i].startsWith('@@ ')) i += 1;
      const olds = [];
      const news = [];
      while (i < lines.length - 1 && !lines[i].startsWith('*** ')) {
        const L = lines[i];
        if (L.startsWith('-')) olds.push(L.slice(1));
        else if (L.startsWith('+')) news.push(L.slice(1));
        else if (L.startsWith(' ')) { olds.push(L.slice(1)); news.push(L.slice(1)); }
        else throw new Error(`apply_patch: bad update line: ${L}`);
        i += 1;
      }
      hunks.push({ type: 'update', path: p, edits: [{ oldText: olds.join('\n'), newText: news.join('\n') }] });
      continue;
    }
    if (line.startsWith('*** Delete File:') || line.startsWith('*** Move to:') || line.startsWith('*** Environment ID:')) {
      throw new Error('apply_patch: delete/move/environment not supported');
    }
    if (line.trim() === '') { i += 1; continue; }
    throw new Error(`apply_patch: unexpected line: ${line}`);
  }
  return hunks;
}

export function createApplyPatch({ write_file, edit_file }) {
  return async function apply_patch(input) {
    if (typeof input !== 'string' || !input.trim()) throw new Error('apply_patch: freeform string required');
    const hunks = parseApplyPatch(input);
    for (const h of hunks) {
      if (h.type === 'add') await write_file({ file_path: h.path, content: h.content });
      else await edit_file({ path: h.path, edits: h.edits });
    }
    return {};
  };
}
