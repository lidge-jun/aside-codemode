# code mode

Native is the default. A page you have not seen, a single click, a fresh visual
judgement: work the way you normally do and ignore this block.

Batch when the structure repeats and the items do not depend on each other's state. A
signed-in site is the exception that looks like the rule: every item shares one session,
so when it expires partway the rest quietly read a login page and report success. Sign in
natively first, pass the text that proves you are signed in as `loggedInMarker`, then batch.
A missing marker is `needs_input`, not a failure: someone can sign in again.

`ok`, `completed`, HTTP 200 and `contentVerified` say the call worked. None of them says
the page holds what you asked for. Name the content you expect, or you have not checked it.

An open API or a server-rendered page is a fetch, where a tab is pure overhead; an SPA
whose HTML arrives empty is a batch. The test is whether the text you expect survives
deleting the script tags.

File trees, metadata and structured results are this path whether or not the work repeats.
Do not call `rg`, `find`, `grep` or `Get-ChildItem -Recurse`; `search.content`, `fs.stat`
and `fs.grepFile` answer the same question in one call instead of fifty.

    {{NODE}} {{CLI}} --code-file /abs/script.js      # quoting-proof; prefer this
    {{NODE}} {{CLI}} --code "return actions.describe('browse.exec')"

Use that absolute pair; do not look up `node` or `codemode` on PATH. Do not invoke `src/cli.js`;
the entry point is `bin/codemode.mjs`. Read `actions.describe` before the first call, not after
a refusal: the option you needed is usually in it, and `actions.check` validates a call without
making it. Resolve project-relative paths with `{{CWD_HINT}}`; if it looks wrong, run `--doctor`.
Procedure, failure codes and resuming: `skills/user/aside-codemode/SKILL.md`.

Batch helper, inside a REPL session:

    const src = await fs.readFile({{HELPER}}, 'utf8'); (0, eval)(src);

That code is a vm guest. No `import`, `require`, `process`, `fetch`, `setTimeout` or `Buffer`;
a dynamic import answers `EGUESTIMPORT`. What you get instead: `search fs actions browse report
api recipes read_file write_file edit_file apply_patch console`. `browse` works out of the box;
a machine that turned it off answers `EDISABLED` with the command that restores it.

Aside's default shell on Windows is Git Bash; PowerShell runs the same absolute call. macOS
uses its default bash or zsh card. There is no Linux install path.

Do not: drive one tab from two places at once, reuse a ref from an older observation, or
retry a side effect whose outcome you do not know. A result that says `partial`,
`indeterminate` or `needs_input` is an answer; report it rather than rerunning it.
`needs_input` means a person has to sign in, clear a challenge, or approve a write. A batch
that can change something says so first: any `actions` verb but `waitFor`,
`waitForLoadState` and `sleepMs` needs `approveWrites: true`, or nothing opens and the
answer is `needs_input` with `wants` naming the verbs.
