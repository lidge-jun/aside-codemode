# wp2 — Aside-shaped guest file API (CLI sandbox)

The agent writes the same objects the Aside UI already shows. Cards still come
only from native tools. This phase changes **guest JS**, not MCP tool names.

## IN / OUT

IN: `src/host/fs.js`, `src/sandbox.js`, `src/cli.js`, `src/server.js` (same globals so the unused MCP process does not drift — not a success gate), `src/tools.js` (GUEST_API_DOC), `src/host/actions.js`, `test/fs.test.js` (keep deprecated aliases), `test/aside-files.test.js` (NEW), `test/actions.test.js` if it asserts catalog paths.
OUT: MCP `tools/list` new tools, AGENTS.md (wp4), apply_patch (wp3), README body (wp5).

## MODIFY `src/host/fs.js`

Keep compound helpers: `readMany`, `grepFile`, `mkdir`, `stat`, `exists`, `list`.

### NEW methods (Aside shapes)

`read_file({ path, offset, limit })`
- `path` required string. Resolve via `assertInside` (cwd from wp1).
- `offset` / `limit` are 1-indexed **line** numbers, not bytes. If present they must be finite integers ≥ 1. `0`, negative, fractional, `NaN` → throw `read_file: offset/limit must be a positive integer`.
- Split on `/\r?\n/` (preserve by joining with `\n` on return; do not rewrite the file).
- If both omitted: read whole file, cap **262144 bytes** (same as Aside / current `READ_CAP`).
- If `offset` set: start at that line (1 = first line).
- If `limit` set: at most that many lines.
- Directory → throw `read_file: … is a directory`.
- Return `string`.

`write_file({ file_path, content })`
- Param is `file_path`, not `path`.
- `content` string required.
- Create-only via `writeFile(target, content, { encoding: 'utf8', flag: 'wx' })`. Do **not** `exists` then write (TOCTOU). `EEXIST` → throw `write_file: already exists: <path>`.
- Parent must exist (`ENOENT` on parent → throw). No auto-mkdir.
- Return `{ wrote, bytes }`.

`edit_file({ path, appendText, edits })`
- `edits` default `[]`. Empty `edits` allowed only when `appendText` is a non-empty string.
- Apply each `{oldText,newText}` against the **original** file text (not incremental). Each `oldText` must occur exactly once in that original; 0 or 2+ → throw naming the snippet. Overlapping ranges: if two edits' `oldText` spans share characters in the original, throw `edit_file: overlapping edits`.
- Then append `appendText` if provided.
- Return `{ path, replacements, appended, diff }` (`diff` is a unified string for the CLI JSON; not an Aside UI card).

### Field chain — `read_file.offset` / `limit` (lines, not bytes)

| Stage | Path |
| --- | --- |
| Creation | guest arg `{ offset?, limit? }` from `--code` JS |
| Serialization | N/A in-process; CLI result JSON is the file text, not the args |
| Deserialization | N/A + reason: numbers already JS numbers |
| Consumers | `read_file` only. `fs.read({ offset })` stays **bytes**. Do not share the name on one function |

### RETIRE as the file contract (locked, not optional)

- `fs.read` / `fs.write` **remain** as deprecated aliases with **old** byte/overwrite semantics so `test/fs.test.js` stays green.
- `GUEST_API_DOC` and `actions` registry **do not** list `fs.read` / `fs.write` as the file API. They list `read_file` / `write_file` / `edit_file`.
- `fs.read` / `fs.write` **stay** in the actions registry with `notes: 'deprecated; use read_file (line offset)'` / `'deprecated; use write_file (create-only)'`. Do not delete those rows.

Do **not** reuse `offset` on `fs.read` as lines. Two functions, two meanings.

`createFs({ assertInside })` returns **one** object that **is** the existing `fs` API
(`read`, `write`, `readMany`, `grepFile`, `mkdir`, `stat`, `exists`, `list`) **plus**
`read_file`, `write_file`, `edit_file` on the same object. `test/fs.test.js` and
`test/regressions.test.js` keep calling `createFs(...).read` — do not migrate them
to `.fs`.

```js
const host = createFs({ assertInside }); // host.read === deprecated byte read
const globals = {
  search: createSearch(...),
  fs: host,
  read_file: host.read_file,
  write_file: host.write_file,
  edit_file: host.edit_file,
  actions: createActions(),
};
```

## MODIFY `src/sandbox.js`

`sandboxGlobal` (`src/sandbox.js:57-62`) after:

```js
  const sandboxGlobal = {
    search: globals.search,
    fs: globals.fs,
    actions: globals.actions,
    read_file: globals.read_file,
    write_file: globals.write_file,
    edit_file: globals.edit_file,
    console: consoleShim,
  };
```

`server.js` uses the same `globals` object. Required for one sandbox contract. Not an MCP product gate.

## MODIFY `src/cli.js` and `src/server.js`

Build globals as above. `server.js` change is contract-sync only.

## MODIFY `src/tools.js` GUEST_API_DOC

Replace fs.read/write bullets with Aside-shaped names. Keep search.* and compound fs.*.

## MODIFY `src/host/actions.js`

Add registry rows `read_file`, `write_file`, `edit_file` with Aside input names/types.
Keep `fs.read` / `fs.write` rows; set `notes` to the deprecated strings above. Do not remove them.
`actions.find('edit')` should hit `edit_file`.

## NEW `test/aside-files.test.js`

1. `read_file({path})` full small file.
2. `read_file({path, offset:2, limit:1})` returns only line 2 (fixture `"a\\nb\\nc"`).
3. `write_file` create then second call throws.
4. `edit_file` unique oldText → newText; file contents match.
5. `edit_file` duplicate oldText throws.
6. `edit_file` empty edits without appendText throws.
7. `edit_file` appendText only.
8. Guest `--code "return await read_file({path: 'x'})"` with `--cwd` (spawn cli).
9. `read_file` on a directory throws.
10. `write_file` into a missing parent throws.
11. Two overlapping `oldText` ranges throw `overlapping`.
12. `read_file` without paging on a file > 262144 bytes is capped (length ≤ 262144 or includes truncation — lock: throw `read_file: file exceeds 262144 bytes; pass offset/limit` so the agent pages. Do not silently truncate like `fs.read`.)

Existing `test/fs.test.js` keeps `fs.read` byte tests until aliases die.

Verifier: `npm test` exit 0. Observes `src/host/fs.js` via `test/aside-files.test.js` and `test/fs.test.js`.

Conditional: create-only collision — activate by writing twice; observe thrown error string containing `exists` or `already`.
