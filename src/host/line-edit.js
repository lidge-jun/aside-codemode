// Line-accurate edit helper for apply_patch (internal lineMatch).
// Public edit_file stays unique-substring and does not import this for that path.

export function scanLines(text) {
  const records = [];
  let i = 0;
  while (i < text.length) {
    const n = text.indexOf('\n', i);
    if (n === -1) {
      records.push({ start: i, end: text.length, text: text.slice(i), eol: '' });
      break;
    }
    const hasCr = n > 0 && text[n - 1] === '\r';
    const textEnd = hasCr ? n - 1 : n;
    records.push({
      start: i,
      end: n + 1,
      text: text.slice(i, textEnd),
      eol: hasCr ? '\r\n' : '\n',
    });
    i = n + 1;
  }
  return records;
}

/** @returns {{start:number,end:number}} end is exclusive */
export function findUniqueLineRange(lines, oldLines, { atEof = false } = {}) {
  if (!Array.isArray(oldLines) || oldLines.length === 0) {
    throw new Error('edit_file: old lines must not be empty (use appendText to add text without an anchor)');
  }
  const hits = [];
  const last = lines.length - oldLines.length;
  for (let i = 0; i <= last; i += 1) {
    let ok = true;
    for (let j = 0; j < oldLines.length; j += 1) {
      if (lines[i + j] !== oldLines[j]) { ok = false; break; }
    }
    if (ok) hits.push(i);
  }
  if (hits.length === 0) {
    throw new Error(`edit_file: oldText not found: ${oldLines.join('\n').slice(0, 80)}`);
  }
  if (atEof) {
    const start = hits[hits.length - 1];
    const end = start + oldLines.length;
    if (end !== lines.length) {
      throw new Error('edit_file: *** End of File anchor does not reach the end of the file');
    }
    return { start, end };
  }
  if (hits.length > 1) {
    throw new Error(`edit_file: oldText not unique: ${oldLines.join('\n').slice(0, 80)}`);
  }
  return { start: hits[0], end: hits[0] + oldLines.length };
}

/** Walk keep/del/add. Do not map newLines[j] onto records[start+j]. */
function reconstructFromOps(records, start, ops) {
  let oldIdx = 0;
  let prevDel = false;
  const parts = [];
  const eols = [];
  for (const step of ops) {
    if (step.op === 'del') { oldIdx += 1; prevDel = true; continue; }
    if (step.op === 'keep') {
      parts.push(step.text);
      eols.push(records[start + oldIdx].eol);
      oldIdx += 1;
      prevDel = false;
      continue;
    }
    if (step.op === 'add') {
      const ahead = records[start + oldIdx];
      const behind = records[start + oldIdx - 1];
      parts.push(step.text);
      const raw = prevDel && behind
        ? behind.eol
        : (ahead ? ahead.eol : (behind ? behind.eol : '\n'));
      eols.push(raw === '' && ahead == null && !prevDel ? '\n' : raw);
      prevDel = false;
      continue;
    }
    throw new Error(`edit_file: unknown op ${step.op}`);
  }
  if (parts.length === 0) return '';
  return parts.map((line, j) => {
    if (j === parts.length - 1 && eols[j] === '') return line;
    return line + (eols[j] || '\n');
  }).join('');
}

export function applyLineEdits(original, edits, { eof = false } = {}) {
  const records = scanLines(original);
  const lines = records.map((r) => r.text);
  const ranges = [];
  for (const ed of edits) {
    const oldLines = Array.isArray(ed.oldLines) ? ed.oldLines : null;
    const newLines = Array.isArray(ed.newLines) ? ed.newLines : null;
    if (!oldLines || !newLines) throw new Error('edit_file: lineMatch edits need oldLines and newLines arrays');
    if (!Array.isArray(ed.ops)) throw new Error('edit_file: lineMatch edits need ops');
    const atEof = eof === true && ed.atEof === true;
    const { start, end } = findUniqueLineRange(lines, oldLines, { atEof });
    ranges.push({ start, end, ops: ed.ops });
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].start < ranges[i - 1].end) throw new Error('edit_file: overlapping edits');
  }
  let next = original;
  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    const r = ranges[i];
    const from = records[r.start].start;
    const to = records[r.end - 1].end;
    next = next.slice(0, from) + reconstructFromOps(records, r.start, r.ops) + next.slice(to);
  }
  return next;
}
