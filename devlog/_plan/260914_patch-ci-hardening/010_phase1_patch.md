# WP1 — Line-based apply_patch, line delete, EOL preserve

Execute only after WP0 D. Re-read this file at the next P and amend if lines drifted.

## Loop spec (this cycle)

- Archetype: satisfy-spec.
- Trigger: previous D (WP0) locks the roadmap; direction unchanged — mutation contract before search/docs/CI.
- Goal: `apply_patch` matches **whole lines**, deletes lines without leaving a blank, applies the same logical hunk on LF and CRLF, and rewrites with the file’s original newline.
- Non-goals: public `edit_file` substring semantics; Delete/Move/Environment hunks; multi-file transactions; sandbox changes.
- Verifier: `npm test` (preflight 208/208; glob `test/*.test.js` includes `test/patch.test.js`, `test/write-hardening.test.js`, and the NEW `test/patch-line.test.js`).
- Stop: c-1 observable cases green; existing 030 patch tests still pass.
- Memory: this doc; amend before coding past a drift.
- Outcomes: DONE = red-then-green line tests. UNSAFE = root/lock loosened.
- Escalation: do not change public `edit_file` call shape.

## IN / OUT

IN: `src/host/patch.js`, NEW `src/host/line-edit.js`, `src/host/fs.js` (`edit_file` only), `src/tools.js` (one GUEST_API_DOC line), `src/host/actions.js` (apply_patch notes), `README.md` / `README.ko.md` Writes-and-patches paragraph, NEW `test/patch-line.test.js`.  
OUT: `grepFile`, LICENSE, CI, 51x numbers, `edit_file` public schema.

## D1–D4 recap

Internal `lineMatch: true` on `edit_file` (architect name; same opt-in style as `eof`), used only by `createApplyPatch`. Extract line split/match/join so `fs.js` stays under the 400-line DEFAULT. Keep `{oldText,newText}` as `oldLines.join('\n')` for errors; matching uses `oldLines`. Parser also emits `ops` (`keep`/`del`/`add`). `newLines: []` deletes the block; `['']` is one empty line. Untouched spans stay byte-for-byte. Reconstruction **walks `ops`**, not `newLines[j] → records[start+j]` (A FAIL #2).

## NEW `src/host/line-edit.js`

Split into `{start,end,text,eol}[]` so untouched spans are copied as original bytes (D4). `eol` is `'\r\n'`, `'\n'`, or `''` (last line, no terminator).

```js
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
```

Keep error prefixes `edit_file: oldText not found` / `oldText not unique` so `test/write-hardening.test.js:419` `/not unique/` still matches in line mode.

## MODIFY `src/host/patch.js`

**Parse split** (`:25`):

```diff
-  const lines = text.split(/\n/);
+  const lines = text.split(/\r?\n/);
```

**Flush** (`:71`):

```diff
-        edits.push({ oldText: olds.join('\n'), newText: news.join('\n'), atEof });
+        edits.push({
          oldLines: olds.slice(),
          newLines: news.slice(),
          oldText: olds.join('\n'),
          newText: news.join('\n'),
          atEof,
          ops: ops.slice(),
        });
```

`olds.length === 0` rejection stays (anchor required).

While reading update lines, also fill `ops`:

```js
if (L.startsWith('-')) { olds.push(L.slice(1)); ops.push({ op: 'del', text: L.slice(1) }); }
else if (L.startsWith('+')) { news.push(L.slice(1)); ops.push({ op: 'add', text: L.slice(1) }); }
else if (L.startsWith(' ')) {
  const t = L.slice(1);
  olds.push(t); news.push(t); ops.push({ op: 'keep', text: t });
}
```

Reset `ops = []` in the same place `olds`/`news` reset. `@@` flush must reset `ops` too.

**createApplyPatch** (`:132`):

```diff
-          const out = await edit_file({ path: h.path, edits: h.edits, eof: h.edits.some((e) => e.atEof) });
+          const out = await edit_file({
+            path: h.path,
+            edits: h.edits,
+            eof: h.edits.some((e) => e.atEof),
+            lineMatch: true,
+          });
```

Add File still `body.join('\n')` + POSIX trailing newline (`:45-46`). No change.

## MODIFY `src/host/fs.js` `edit_file` (`:271-335`)

Import `applyLineEdits` from `./line-edit.js`.

Inside the lock, after `original` is read:

```diff
+        if (eof === true && lineMatch !== true) {
+          // existing substring + atEof path unchanged
+        }
+        if (lineMatch === true) {
+          const next = applyLineEdits(original, edits, { eof });
+          if (typeof appendText === 'string' && appendText.length) {
+            throw new Error('edit_file: appendText is not supported with lineMatch');
+          }
+          await replaceAtomically(target, next, { signal });
+          return { path: target, replacements: edits.length, appended: false, diff: `--- a/${p}\n+++ b/${p}\n@@\n${original}\n→\n${next}` };
+        }
```

Signature becomes `{ path, appendText, edits = [], eof = false, lineMatch = false }`. Default `lineMatch` false. Document in the existing `eof` comment (`:267-270`) that `lineMatch` is apply_patch-only.

Substring path (`:286-324`) stays for public `edit_file`. Do not CRLF-normalize that path.

`src/host/globals.js:17` stays `createApplyPatch({ write_file, edit_file })` — no change.

## MODIFY docs (contract sentence only)

`src/tools.js:17`:

```diff
-  '- apply_patch(text) => {} — Codex-shaped *** Begin Patch / *** End Patch. Add File → write_file, Update File → edit_file. ...
+  '- apply_patch(text) => {} — Codex-shaped *** Begin Patch / *** End Patch. Add File → write_file. Update File matches whole lines (not substrings), deletes lines, and preserves the file newline (LF or CRLF). ...
```

`src/host/actions.js` apply_patch `notes` (`:45`): append `Update hunks are line-based; a substring that is not a whole line does not match. CRLF files keep CRLF.`

`README.md:84` and `README.ko.md:84` after the Add/Update sentence, add one sentence: line match / line delete / original newline preserved. Do not mention 51x here.

## NEW `test/patch-line.test.js`

Edge-first (write these before changing production code; they must fail on `8223264`):

1. **foobar substring** — file `foobar`; hunk `-foo`/`+bar` → rejects `/not found/`; file still `foobar`.
2. **delete line** — `alpha\nbeta\ngamma\n`; `-beta` → `alpha\ngamma\n` (not `alpha\n\ngamma\n`).
3. **CRLF context** — `alpha\r\nbeta\r\ngamma\r\n`; ` alpha` / `-beta` / `+BETA` → `alpha\r\nBETA\r\ngamma\r\n`.
4. **LF context** — same hunk on LF file → `alpha\nBETA\ngamma\n`.
5. **CRLF patch text** — LF file, patch joined with `\r\n`, hunk `-beta`/`+BETA` → success.
6. **ambiguous + EOF** — reuse write-hardening fixtures; still `/not unique/` without EOF; last line with EOF.
7. **guest** — `runCode` apply_patch foobar case → `ok:false` or thrown error, not `barbar`.
8. **mixed-EOL replace** — file `alpha\r\nbeta\ngamma\r\n`; hunk ` alpha` / `-beta` / `+BETA` / ` gamma` → exactly `alpha\r\nBETA\ngamma\r\n`.
9. **mixed-EOL delete + context** — same file; hunk ` alpha` / `-beta` / ` gamma` → exactly `alpha\r\ngamma\r\n` (gamma must **not** inherit beta’s LF). Must fail on positional `start+j`.
10. **mixed-EOL insert** — file `alpha\r\nbeta\n`; hunk ` alpha` / `+NEW` / ` beta` → exactly `alpha\r\nNEW\nbeta\n` (NEW takes the following old line’s LF).

Keep existing `test/patch.test.js` and `test/write-hardening.test.js` cases. Multi-hunk `alpha\nmiddle\nomega\n` remains line-accurate.

## Field chain (PLAN-FIELD-CHAIN-01)

`lineMatch` and `oldLines`/`newLines`:

| Stage | Path |
| --- | --- |
| Create | `parseApplyPatch` flush → `{oldLines,newLines,oldText,newText,atEof,ops}`; `createApplyPatch` passes `lineMatch:true` |
| Serialize | not on the wire; in-process host call only |
| Deserialize | N/A (same process) |
| Consume | `edit_file` branch; `applyLineEdits` → `reconstructFromOps` |

Public catalog does not list `lineMatch` (internal, like `eof`).

## Activation / proof

| Case | Command | Observe |
| --- | --- | --- |
| Red then green | `node --test test/patch-line.test.js` | fail on HEAD; pass after B |
| Full suite | `npm test` | 0 fail; previous 208 still present plus new cases |

## Residuals

Public `edit_file` with `oldText: "alpha\nbeta"` still fails on CRLF files. Documented: use `apply_patch` for line/EOL-accurate edits. Mixed-EOL files keep untouched spans byte-for-byte; surviving hunk lines keep their own EOL via `ops`. Two-or-more inserts at an unterminated tail are residual (follow `reconstructFromOps` as written).
