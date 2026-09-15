# 010 — Register into every Aside account root

## MODIFY src/register.js

NEW exported `listAccountRoots({ asideHome, only })`:
- read `<asideHome>/accounts.json` if present; take `currentAccountId` and every
  `accounts[].id`. A malformed or missing file is not an error.
- union with every directory under `<asideHome>/u` whose name is all digits.
- order: current account id first, then the rest ascending.
- if the union is empty, return id `'0'` so a fresh machine and the existing tests
  keep the old behaviour.
- return `[{ id, root, current }]`.

MODIFY `applyRegister()`:
- resolve roots via `listAccountRoots`; `primary` = the current one.
- machine config `roots` keeps using `primary.root` (one search root, not seven).
- loop over every root: mkdir, render the template, `upsertAgents`, write
  AGENTS.md; then the settings.json MCP merge per root, backed up as today.
- per-root record: `{ id, root, agentsPath, agentsOk, agentsError, settingsOk,
  settingsError, current }`.
- return shape keeps the old top-level keys pointing at the primary root
  (`ok`, `agentsPath`, `node`, `cli`, `settingsOk`, `settingsError`,
  `userConfigPath`) and adds `accounts: [...]` plus `accountsWritten`.
  `ok` is true when the primary AGENTS write succeeded; a secondary root failing
  is reported, not fatal.
- honour an `asideAccounts` argument (from `ASIDE_ACCOUNT`) to narrow the set.

## MODIFY scripts/register-aside.mjs

Print one line per account root — id, current marker, bytes written, settings
result — before the JSON blob, so an ssh run is readable without jq. Pass
`ASIDE_ACCOUNT` through.

## NEW test/register-accounts.test.js

- no accounts.json and no u/ dir -> writes u/0 only (back-compat)
- accounts.json with currentAccountId 1 and ids [0,1,2] -> all three written,
  `accounts[0].id === '1'` and `current === true`
- extra numeric dirs not in accounts.json are still written
- non-numeric entries (`.DS_Store`) are skipped
- malformed accounts.json falls back to the directory scan
- `asideAccounts: ['1']` narrows to one root
- re-register does not duplicate the marker in any root
- settings.json present in only one root: that root reports settingsOk true and
  the others report the not-found reason, and `ok` stays true

## Risk

Writing into an account root the user never uses is harmless: an idempotent
markered block appended to AGENTS.md. Writing into none of the used roots is the
bug we have. Breadth is the safer error.
