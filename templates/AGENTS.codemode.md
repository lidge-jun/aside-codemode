# code mode

Stay native for one unfamiliar first-look page, one known file, one visible click, or a fresh
visual judgement. Also stay native for file-card delivery, watch-me work, accounts,
sign-in/SSO/MFA/CAPTCHA/approval, an uncertain side effect, or dependent wizard/cart/form steps.
Code mode is the default for ANY directory- or project-scoped content or filename search before
the hit count is known. Treat find, search, locate, grep, count, occurrences, references, usages,
TODO, all, every, each, across, repository and project as multi-file.
Also use code mode for 2+ independent files, URLs, pages, queries, API lookups or captures.
For browsing, inspect one unfamiliar page natively first. Then use `browse.exec` for rendered
extraction, `browse.readText` for bodies, `browse.captureMany` for artifacts, `browse.searchMany`
for queries, and `browse.attach` for "this page" or an open tab.
Losing moves are a native `read_file` loop, a bash `find`/`grep` pipeline, or repeated grep calls.
Replace them with one `search.content`, `search.files` or `search.count` call, filter, then read
only the hits in the same body; `fs.stat` and `fs.grepFile` cover metadata and one-file matching.
Never call `find`, `grep` or `Get-ChildItem -Recurse`; shell out anyway and it is `rg`, whose rows carry no completeness signal, so an empty rg result is not absence.
A signed-in batch shares one session: sign in natively first, pass its `loggedInMarker`, then
batch. If it expires partway the rest read a login page; a missing marker is `needs_input`.
`ok`, `completed`, HTTP 200 and `contentVerified` say the call worked. None of them says
the page holds what you asked for. Name the content you expect, or you have not checked it.
A search says it the same way: `complete:false`, `truncated` or a `skippedSymlinks` count
means rows are missing, so an empty result is not evidence of absence; project those out too.

An open API or a server-rendered page is a fetch; an SPA whose HTML arrives empty needs rendered
browsing. The test is whether the expected text survives deleting the script tags.

    {{NODE}} {{CLI}} --code-file /abs/script.js      # quoting-proof; prefer this
    {{NODE}} {{CLI}} --code "return actions.describe('browse.exec')"

Use that absolute pair; do not look up `node` or `codemode` on PATH. Do not invoke `src/cli.js`;
the entry point is `bin/codemode.mjs`. Read `actions.describe` before the first call, not after
a refusal: the option you needed is usually in it, and `actions.check` validates a call without
making it. `actions` only describes. Run the action by its own name, `browse.exec({ urls })`.
Resolve project-relative paths with `{{CWD_HINT}}`; if it looks wrong, run `--doctor`.
Procedure, failure codes and resuming: `skills/user/aside-codemode/SKILL.md`.

Batch helper, inside a REPL session:

    const src = await fs.readFile({{HELPER}}, 'utf8'); (0, eval)(src);

That code is a vm guest. No `import`, `require`, `process`, `fetch`, `setTimeout` or `Buffer`;
a dynamic import answers `EGUESTIMPORT`. What you get instead: `search fs actions browse report
api recipes read_file write_file edit_file apply_patch console`. The line above is the REPL's
`fs`; the guest reads with `fs.read` and `fs.list`, not `readFile`/`readdir`. `browse` works out
of the box; a machine that turned it off answers `EDISABLED` with the command that restores it.

Aside's default shell on Windows is Git Bash; PowerShell runs the same absolute call. macOS
uses its default bash or zsh card. There is no Linux install path.

Do not: drive one tab from two places at once, reuse a ref from an older observation, or
retry a side effect whose outcome you do not know. A result that says `partial`,
`indeterminate` or `needs_input` is an answer; report it rather than rerunning it.
`needs_input` means a person has to sign in, clear a challenge, or approve a write. Anything
that can change something says so first: every browse action verb but `waitFor`,
`waitForLoadState` and `sleepMs` needs `approveWrites: true`, on `browse.exec` and on
`browse.attach` alike, and a ref-aimed one needs `refsFingerprint` too.
