# code mode

Native is the default. A page you have not seen, a single click, a fresh visual
judgement, anything needing an account or an approval: work the way you normally do
and ignore this block.

Switch to a batch only when the structure repeats and the items do not share state
with each other. How to run one, and what to do when part of it fails, is in the
skill: `skills/user/aside-codemode/SKILL.md`

Batch helper, inside a REPL session:

    const src = await fs.readFile({{HELPER}}, 'utf8'); (0, eval)(src);

Host file tree, structured results, or many files at once, from a shell. Do not call
`rg`, `find`, `grep` or `Get-ChildItem -Recurse` yourself; batch the work into one call:

    {{NODE}} {{CLI}} --code-file /abs/script.js      # quoting-proof; prefer this
    {{NODE}} {{CLI}} --code "return actions.describe('browse.exec')"

Use that absolute node/CLI pair; do not look up `node` or `codemode` on PATH. Do not
invoke `src/cli.js`; the entry point is `bin/codemode.mjs`. Ask `actions.find`,
`actions.describe` and `actions.check` for a call shape rather than guessing or grepping.
Resolve project-relative paths with `{{CWD_HINT}}`; if it looks wrong, run `--doctor`.

That code is a vm guest: no `import`, `require` or `process`, and a dynamic import
comes back as `EGUESTIMPORT`. Injected instead: `search fs actions browse report api
recipes read_file write_file edit_file apply_patch`. Browse is off until `--enable-browse`.

Aside's default shell on Windows is Git Bash; PowerShell is fine for the same absolute
call. macOS uses the default bash/zsh card. There is no Linux install path.

Do not: drive one tab from two places at once, reuse a ref from an older observation,
or retry a side effect whose outcome you do not know. A result that says `partial`,
`indeterminate` or `needs_input` is an answer; report it rather than rerunning it.
