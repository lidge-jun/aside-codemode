# aside-codemode (CLI)

For local search and multi-file reads, do not call `rg`, `find`, `grep`, or
`Get-ChildItem -Recurse` directly. Batch the work into one call:
`{{NODE}} {{CLI}} --code '...'`
Use this absolute node/CLI pair; do not look up `node` or `codemode` on PATH.

Code is an async function body. Use `await` for tool operations and `return` for
the answer. Available tools: `search.files|content|count`,
`read_file({path, offset?, limit?})` (1-indexed lines),
`write_file({file_path, content})` (create-only),
`edit_file({path, edits, appendText?})`, and compound `fs.*` helpers.
`apply_patch(text)` is a guest helper, not a separate AGENTS command.

Search arrays support iteration in guest code. Return the search result directly
or preserve its `complete`, `truncated`, `partial`, and `scope` metadata when
projecting it. A partial or truncated search is not proof that a file is absent.
`noIgnore`, `hidden`, and `includeExcluded` select different scope controls.
`followSymlinks: true` is unsupported and rejected.

For visible single-file cards use Aside's native `read_file`, `write_file`, or
`edit_file`. CLI calls render as bash cards. Do not claim a guest write made a
native file card. File locks coordinate codemode writers, not arbitrary editors.
A failed patch may have applied earlier files; inspect `applied` and `failedFile`.

Resolve project-relative paths with `{{CWD_HINT}}` or run in that directory.
