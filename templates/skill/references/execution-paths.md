# Execution paths

Three ways to run code, with different reach. Pick by what the work needs to touch.

## 1. Native tools

Aside's own `read_file`, `write_file`, `edit_file` and the browser verbs. These render as
visible single-file cards. Use them for a first look, for one file, and for anything the
user should see happen. A guest write from the CLI is not a native file card; do not claim
it is one.

## 2. The REPL, with cm

`aside repl` runs Playwright-style JavaScript in the browser, with top-level `await` and a
120 second ceiling. Globals: `fs path openTab closeTab tabs getTabByTargetId snapshot`
`annotatedScreenshot installPageScript page cua display sleep Buffer fetch`. There is no
`require`, no `process` and no `module`.

`fs` is root-guarded. It reads the account root and the session directory; a repository
path is refused with `Path escapes Project and session roots`. What a *relative* path is
relative to depends on which surface is running the code, and the two do not agree: under
`aside repl` it resolves from the session directory (two levels below the account root), so
`../../codemode/cm.js` reaches the helper; under the in-app agent REPL it resolves from the
account root, where that same line leaves the account root and is refused. Load the helper
by its absolute path, `{{HELPER}}`, which both surfaces read. That value is written as a
quoted JavaScript string so it stays valid code even when the path contains an apostrophe.

The browser cannot reach this machine's loopback, and the daemon refuses `file://` without
local file access. For a fixture page, use a `data:text/html` url: it is a real document
with a real DOM and `snapshot()` reads it normally.

## 3. The CLI

    {{NODE}} {{CLI}} --code-file /abs/script.js
    {{NODE}} {{CLI}} --code -            # same script on stdin
    {{NODE}} {{CLI}} --code "return 1+1" # only for a short expression with no quotes

`--code '<js>'` is safe only for a trivial one-liner with no quotes of its own. Guest code
normally contains quotes: a url like `'https://example.com'` closes the outer quote early
and the shell then waits for one that never arrives, so the command hangs. Under
PowerShell it does not hang, it mangles the argument into `Unexpected token '}'`. Both
were seen in real runs. `--code-file` and stdin do not have to survive quoting.

Use the absolute node/CLI pair the AGENTS block gives you. Do not resolve `node` or
`codemode` on PATH, and do not run `src/cli.js`; the entry point is `bin/codemode.mjs`.

## What the guest is allowed to reach

`--code` evaluates inside a vm context, not inside Node. There is no module loader, and the
two ways of asking for one fail differently: `await import('node:fs')` is translated to
`EGUESTIMPORT` and answered with the list of names you actually have, while `require` was
never defined and throws a plain `require is not defined`. The translation happens at the
edge, so a guest that catches its own rejection sees Node's words instead.

Also absent, and worth knowing before the first call: `process`, `fetch`, `setTimeout`,
`URL`, `Buffer`, and building code from a string. These are injected before your code runs:

    search  fs  actions  browse  report  api  recipes
    read_file  write_file  edit_file  apply_patch  console

Read a file with `read_file`, not with a module. Reach the network through `browse`,
not through `fetch` - and note that `browse` is injected whether or not it is allowed to run:
until `--enable-browse` has been run once, every call on it refuses with `EDISABLED`.
The sandbox is a shape, not a security boundary: it exists so a batch cannot quietly
depend on something the host never promised.

## Discovering a call shape

Ask the sandbox rather than guessing or grepping:

    actions.find('browse')
    actions.describe('browse.exec')
    actions.check('browse.exec', { urls: ['https://x'] })

`describe` returns the signature and every input. `check` validates a call without making
it, using the same validator the real call uses, so a combination it accepts is a
combination that runs. `browse.probe()` reports what the installed Aside build will
actually do, including why an option is refused.

## Guest code shape

Code is an async function body: `await` for tool operations, `return` for the answer.
Available: `browse.probe|exec|tabs|attach|captureMany|readText|searchMany|downloadMedia|watch|prefetch`,
`report.build`, `api.batch`, `recipes.run`, `search.files|content|count`,
`read_file({path, offset?, limit?})` with 1-indexed lines,
`write_file({file_path, content})` which is create-only,
`edit_file({path, edits, appendText?})`, and the compound `fs.*` helpers.
`apply_patch(text)` is a guest helper, not a separate command. Update hunks match whole
lines rather than substrings, delete lines without leaving a blank behind, and keep the
file's original newline. A failed patch may have applied earlier files: read `applied` and
`failedFile`. File locks coordinate codemode writers, not arbitrary editors.

## Search scope, which is where wrong answers come from

A partial or truncated search is not proof that a file is absent. Return the search result
directly, or keep its `complete`, `truncated`, `partial` and `scope` fields when you
project it.

`noIgnore`, `hidden` and `includeExcluded` are three different controls.
`followSymlinks: true` is refused. Search honours `.gitignore` unless `noIgnore: true`,
and a parent ignore can hide an entire project directory: if a file should exist, compare
`search.count` with and without `noIgnore`, using `hidden: true` for dotfiles, before
concluding it is not there. An inclusive `glob` can match ignored or hidden files even
when both flags are false, so `glob: "**/*.js"` is not an extension filter that still
honours ignore.

`pattern` and `glob` are different things. `pattern` is a case-sensitive SUBSTRING filter
on the returned paths; `glob` is the glob. `pattern: "*.pdf"` matches nothing because no
path contains `*` — use `glob: "**/*.pdf"` and filter the rows.

Filenames come back as the bytes on disk. macOS stores them decomposed while you type them
composed, so a composed needle is not found inside a decomposed name even though both
render identically and the file looks absent while it is sitting right there. `pattern`
and `fs.grepFile` fold that for you; when you filter rows yourself, compare
`p.normalize("NFC")` against a composed needle and still open the ORIGINAL path. Return
the candidates and a status rather than a bare `.find()`: `undefined` and "no such file"
are not the same answer.

Directory listing is `fs.list`, not `fs.readdir`. `search.files` requires `path`. The
default home-wide roots prune `Library`, `node_modules` and caches; use
`includeExcluded: true` only when you actually need those paths.
