# aside-codemode (CLI)

For local search and multi-file reads, do not call `rg`, `find`, `grep`, or
`Get-ChildItem -Recurse` directly. Batch the work into one call:
`{{NODE}} {{CLI}} --code '...'`
Use this absolute node/CLI pair. Do not look up `node` or `codemode` on PATH.
Do not invoke `src/cli.js`. The CLI path above is `bin/codemode.mjs`.

## Passing code safely (read this before the first browse call)

`--code '<js>'` is only safe for a short one-liner with NO quotes of its own.
Guest code normally contains quotes — a url like `'https://example.com'` closes your
outer single quote early, and the shell then waits for a quote that never arrives, so
**the command hangs**. Under PowerShell it does not hang; it mangles the argument into
`Unexpected token '}'`. Both were observed from real agent runs.

So for anything longer than a trivial expression, write the script to a file and use:

`{{NODE}} {{CLI}} --code-file /abs/path/to/script.js`

or pipe it on stdin with `{{NODE}} {{CLI}} --code -`. Neither one has to survive quoting.

## Discovering a call shape

Do not guess arguments and do not grep the skills tree for them. Ask the sandbox:

`{{NODE}} {{CLI}} --code "return actions.find('browse')"`
`{{NODE}} {{CLI}} --code "return actions.describe('browse.exec')"`
`{{NODE}} {{CLI}} --code "return actions.check('browse.exec', { urls: ['https://x'] })"`

`describe` returns the full signature and every input; `check` validates a call without
making it. `browse.probe()` reports what the installed Aside build will actually do,
including why an option is refused.

Code is an async function body. Use `await` for tool operations and `return` for
the answer. Available tools: `browse.probe|exec|captureMany|readText|searchMany|downloadMedia|watch|prefetch`,
`report.build`, `api.batch`, `recipes.run`, `search.files|content|count`,
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
An inclusive `glob` can match gitignored or hidden files even when `noIgnore`
and `hidden` are false (ripgrep `-g` precedence, not `-uuu`). Do not treat
`glob: "**/*.js"` as an extension filter that still honors ignore.
`pattern` and `glob` are different things. `pattern` is a case-sensitive
SUBSTRING filter on the returned paths; `glob` is the glob. `pattern: "*.pdf"`
is refused (no path contains `*`), so use `glob: "**/*.pdf"` and filter the rows.
Filenames come back as the bytes on disk. macOS stores them decomposed while you
type them composed, so a composed needle is not found inside a decomposed name
even though both render identically, and the file looks absent when it is right
there. `pattern` and `fs.grepFile` fold that for you; when you filter rows
yourself, compare `p.normalize("NFC")` against a composed needle and still open
the ORIGINAL path. Return the candidates and a status, not a bare `.find()` —
`undefined` from `.find()` and "no such file" are not the same answer.
Directory listing is `fs.list`, not `fs.readdir`; `search.files` requires `path`.
Default home-wide roots prune `Library`, `node_modules`, and caches. Use
`includeExcluded: true` only when you need those paths. If resolution looks wrong,
run `{{NODE}} {{CLI}} --doctor`.

For visible single-file cards use Aside's native `read_file`, `write_file`, or
`edit_file`. CLI calls render as bash cards. Do not claim a guest write made a
native file card. File locks coordinate codemode writers, not arbitrary editors.
A failed patch may have applied earlier files; inspect `applied` and `failedFile`.

Resolve project-relative paths with `{{CWD_HINT}}` or run in that directory.

On Windows, Aside's default shell is Git Bash. PowerShell is allowed for the same absolute `{{NODE}} {{CLI}} --code` call. Do not recurse with `Get-ChildItem`. On macOS, use the default bash/zsh card the same way. Aside has no Linux install path.
