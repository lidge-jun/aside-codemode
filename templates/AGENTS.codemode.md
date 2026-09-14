# aside-codemode (CLI)

For local search and multi-file reads, do not call `rg`, `find`, `grep`, or
`Get-ChildItem -Recurse` directly. Batch the work into one call:
`{{NODE}} {{CLI}} --code '...'`
Use this absolute node/CLI pair. Do not look up `node` or `codemode` on PATH.
Do not invoke `src/cli.js`. The CLI path above is `bin/codemode.mjs`.

Code is an async function body. Use `await` for tool operations and `return` for
the answer. Available tools: `search.files|content|count`,
`read_file({path, offset?, limit?})` (1-indexed lines),
`write_file({file_path, content})` (create-only),
`edit_file({path, edits, appendText?})`, and compound `fs.*` helpers.
`apply_patch(text)` is a guest helper, not a separate AGENTS command.
Update hunks match whole lines (not substrings), delete lines without leaving a
blank, and keep the file's original newline (LF or CRLF).

Search arrays support iteration in guest code. Return the search result directly
or preserve its `complete`, `truncated`, `partial`, and `scope` metadata when
projecting it. A partial or truncated search is not proof that a file is absent.
`noIgnore`, `hidden`, and `includeExcluded` select different scope controls.
`followSymlinks: true` is unsupported and rejected.
Search honors `.gitignore` unless `noIgnore: true`. A parent ignore can hide a
whole project directory. If a file should exist, compare `search.count` with and
without `noIgnore` (use `hidden: true` for dotfiles) before concluding it is absent.
Default home-wide roots prune `Library`, `node_modules`, and caches. Use
`includeExcluded: true` only when you need those paths. If resolution looks wrong,
run `{{NODE}} {{CLI}} --doctor`.

For visible single-file cards use Aside's native `read_file`, `write_file`, or
`edit_file`. CLI calls render as bash cards. Do not claim a guest write made a
native file card. File locks coordinate codemode writers, not arbitrary editors.
A failed patch may have applied earlier files; inspect `applied` and `failedFile`.

Resolve project-relative paths with `{{CWD_HINT}}` or run in that directory.

On Windows, Aside's default shell is Git Bash. PowerShell is allowed for the same absolute `{{NODE}} {{CLI}} --code` call. Do not recurse with `Get-ChildItem`. On macOS, use the default bash/zsh card the same way. Aside has no Linux install path.
