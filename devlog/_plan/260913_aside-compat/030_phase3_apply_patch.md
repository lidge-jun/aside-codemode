# wp3 — apply_patch guest helper

Codex freeform patch text, executed inside `--code`, implemented by calling
wp2 `write_file` / `edit_file`. Not an AGENTS.md verb. Not an MCP tool.

## Loop-spec (this cycle)

| Field | Content |
| --- | --- |
| Loop archetype | satisfy-spec |
| Trigger | Previous D (wp2): guest `read_file`/`write_file`/`edit_file` match Aside schemas; 68 tests. Direction unchanged: CLI `--code` is the product. This cycle adds the locked `apply_patch` translator. |
| Goal | Guest `apply_patch("*** Begin Patch…")` via `codemode --code` returns `{}` and writes through wp2 host helpers. |
| Non-goals | MCP tool / `tools/list` / `execute_code` as success; Delete/Move/Env apply; Codex exec/wait; AGENTS.md (wp4); README rewrite (wp5) |
| Verifier | `npm test` (`package.json` script `node --test "test/*.test.js"` — observes `test/patch.test.js`). Conditional: Delete File patch throws; existing file unchanged. |
| Stop | 030 tests 1–9 + CLI spawn of apply_patch green |
| Memory | this file + 000 attestation |
| Terminal | DONE=guest helper shipped on CLI / BLOCKED=parser vs host uniqueness deadlock |
| Escalation | two dispatch fails → main implements |

HOTL bounds: this repo only. No token/time cap.

## Stale check (2026-09-13 P)

- `src/host/patch.js` does not exist.
- `src/sandbox.js:64` already forwards `globals.apply_patch`; `src/cli.js:56-63` and leftover `src/server.js:45-52` do not set it (guest sees `undefined`).
- `src/tools.js` GUEST_API_DOC and `src/host/actions.js` REGISTRY have no `apply_patch` row.
- wp2 `write_file`/`edit_file` at `src/host/fs.js:172-222` match 030 mapping.
- Prose vs locked JS in this file: follow the **JS block** (space context into both old/new; delete throw string `apply_patch: delete/move/environment not supported`; first/last lines after whole-string trim).
- Leftover `server.js` gets the same one-line wire so the unused process does not drift. **Not a product gate.** Do not open MCP tests as wp3 success.

## Architect dispositions (wp3)

Source: [architect](bd91e923-9500-457b-896d-4e67606ff9ed). Main accepts WP3-D1–D9.

| ID | Decision | Main |
| --- | --- | --- |
| WP3-D1 | New `src/host/patch.js` (`parseApplyPatch` + `createApplyPatch`) | Accept |
| WP3-D2 | Copy locked 030 parser; do not invent a second protocol | Accept |
| WP3-D3 | Add→`write_file`; Update→one `edit_file` | Accept |
| WP3-D4 | Parse-all then apply-in-order; no rollback | Accept |
| WP3-D5 | Success `{}` | Accept |
| WP3-D6 | Product wire in `cli.js`; leftover `server.js` one-line sync only | Accept |
| WP3-D7 | GUEST_API_DOC + actions row; not an AGENTS verb | Accept |
| WP3-D8 | Roots/uniqueness stay on host fs | Accept |
| WP3-D9 | No Delete/Move/Env apply | Accept |

A1: actions input key `text`; guest call stays `apply_patch(string)`. A2: in-process `runCode` for test 5; add one CLI spawn as product proof. A6: catalog assert in `test/patch.test.js`.

## IN / OUT

IN: `src/host/patch.js` (NEW), `src/sandbox.js`, `src/cli.js` / `src/server.js` globals, `src/tools.js` doc line, `src/host/actions.js` row, `test/patch.test.js` (NEW).
OUT: shell intercept of `apply_patch <<EOF`, delete/move hunks, Lark grammar file, MCP schema.

## Protocol (subset)

From `121_openai-codex/codex-rs/apply-patch/src/parser.rs` markers we implement:

```
*** Begin Patch
*** Add File: <rel-or-abs>
+lines
*** Update File: <path>
@@
-old
+new
*** End Patch
```

First/last non-empty lines must be Begin/End (trim).
`*** Delete File:` / `*** Move to:` → throw `apply_patch: delete/move not supported; use native tools or bash`.
Optional `*** Environment ID:` → throw (single cwd only).

`*** Add File:` → `write_file({ file_path, content })` (create-only / `wx`).
`*** Update File:` → one `edit_file({ path, edits })` after parsing hunks to exact unique `oldText`/`newText` pairs (context lines starting with ` ` are part of `oldText`/`newText` only when they appear on `-`/`+` lines; space-only context is **not** required for v1 — we match the `-`/`+` block as `oldText`/`newText`).
If an update has no exact unique `oldText` → throw before any write of that file.

Success `{}`. Apply hunks **in order**. On first error throw; earlier hunks stay applied (no rollback). Document that in GUEST_API_DOC. Tests: two Add Files, second path invalid → first file exists, second does not.

Lenient: if the string starts with ` ``` ` and ends with ` ``` `, strip one fence.

## NEW `src/host/patch.js` — parser locked (not “implement later”)

```js
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
      else await edit_file({ path: h.path, edits: h.edits }); // parseApplyPatch only emits add|update
    }
    return {};
  };
}
```

Windows paths: pass through as the guest wrote them; host `path` + cwd from wp1 resolve them. No slash rewriting.

## MODIFY wiring (not a second protocol)

- `src/sandbox.js` — already forwards `globals.apply_patch` (`sandbox.js:64`). Do not re-inject.
- `src/cli.js` — product wire: `globals.apply_patch = createApplyPatch({ write_file: hostFs.write_file, edit_file: hostFs.edit_file })`.
- leftover `src/server.js` — same one-line wire only. Not a success gate. No MCP schema / tools/list.
- `src/tools.js` GUEST_API_DOC — one bullet: freeform string, Add/Update only, success `{}`, no rollback, delete/move/environment throw.
- `src/host/actions.js` — `path: 'apply_patch'`, `signature: 'apply_patch(text) => Promise<{}>'`, `inputs.text` required (docs). Guest call stays positional `apply_patch(string)`.

Follow the **JS block** in this file wherever protocol prose disagrees (space context into both old/new; throw `apply_patch: delete/move/environment not supported`; exact Begin/End after whole-string trim).

## Field chain (PLAN-FIELD-CHAIN-01)

| Value | Create | Serialize | Deserialize | Consumers |
| --- | --- | --- | --- | --- |
| guest `apply_patch(string)` | guest JS / CLI `--code` | N/A in-process | N/A | `createApplyPatch`, `sandbox.js:64`, `cli.js`/`server.js` globals, GUEST_API_DOC |
| `actions` `inputs.text` | catalog docs only | N/A | N/A | `actions.list\|find\|describe\|check` — **not** the runtime call shape. Do not implement `apply_patch({text})`. |
| `hunk.type` `add`\|`update` | `parseApplyPatch` only | N/A | N/A | apply loop `if add else update`. No other producer. Delete the unreachable `else throw ${h.type}`. |

## Tests `test/patch.test.js`

1. Add File then read back.
2. Update File unique line.
3. Delete File throws; existing file unchanged.
4. Missing Begin/End throws.
5. `runCode` apply_patch returns `{}` (in-process factory).
6. Two Add Files, second path outside roots → first file exists, second does not (partial apply).
7. `*** Begin Patch extra` suffix on the first line throws (exact marker, not startsWith).
8. **CLI product proof:** `spawnSync(process.execPath, [cli, '--cwd', root, '--code', 'return await apply_patch(`*** Begin Patch\\n*** Add File: n.txt\\n+hi\\n*** End Patch`)'], { env: { ...process.env, CODEMODE_ROOTS: root } })`. `status === 0`. `JSON.parse(stdout).result` deepEqual `{}` (CLI envelope is `{ok,result,logs,…}`; do not assert raw stdout `{}`). File `n.txt` exists with `hi`. Same activation as `test/aside-files.test.js` CLI spawn.
9. `actions.find('patch')[0].path === 'apply_patch'`.

Verifier: `npm test` (`package.json` → `node --test "test/*.test.js"`). This file is in that glob.

Conditional: delete hunk — activate with a Delete File patch; observe throw, file still present if it existed (do not delete).
Fence strip — activate with a fenced patch; observe same as unfenced Add.
Empty input — activate `apply_patch('')`; observe throw; no write.
