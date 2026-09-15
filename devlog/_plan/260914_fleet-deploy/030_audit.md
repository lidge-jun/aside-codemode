# 030 — Audit of the wp8 plan

Five findings. Two changed the plan.

## A1 (CHANGES THE PLAN) — do not spray settings.json across every profile

The draft merged the MCP server entry into every account root and took a
timestamped backup each time. macmini's u/0 already carries seven
`settings.json.bak-*` files from earlier runs; multiplying that by seven profiles
is real clutter in a directory we do not own, and an MCP server pointing at a repo
is not something a profile silently benefits from.

Revised: the markered AGENTS.md block goes into **every** root — it is idempotent,
delimited, and trivially reversible. The settings.json MCP merge goes only into
the **primary** root plus any root that **already** has an `aside-codemode` server
entry (that is, somewhere a previous run touched). Everything else reports
`settingsSkipped` with the reason.

## A2 (CHANGES THE PLAN) — the stash export can legitimately be empty

`git stash show -p stash@{0}` prints nothing for a stash that only holds untracked
files. The draft said "if the export is empty, stop". That would block on a stash
that is genuinely empty of tracked changes. Revised: record `git stash list`,
`git rev-parse stash@{0}` and `git stash show --stat` alongside the patch. Since
step 2 moves the clone to Trash rather than deleting it, the stash commit objects
survive inside the trashed `.git` anyway. The patch export is a convenience copy,
not the only copy — so an empty patch is reported, not fatal.

## A3 — `~/.local/bin` is already on PATH, and may already hold a file

`command -v aside` resolves to `/Users/<u>/.local/bin/aside` on both macs, so the
directory is on PATH and the shim will be found. Guard: if `~/.local/bin/codemode`
exists and is not our shim, back it up before overwriting; never follow a symlink
blindly.

## A4 — back-compat of the existing register tests holds

`test/register.test.js` builds an empty `asideHome` with no `accounts.json` and no
`u/`, so the discovery union is empty and the fallback returns id `'0'`. The
"existing settings.json is retargeted" test pre-creates `u/0`, so the directory
scan finds exactly `['0']` and that root is primary. No existing assertion moves.

## A5 — breadth is the safe direction, but bound it

Seven AGENTS.md writes on macmini is fine. Unbounded is not: a machine with a
corrupt `accounts.json` listing hundreds of ids would fan out. Cap the resolved
root list (32) and report truncation rather than looping.

## Verdict

PASS with A1, A2 and A5 folded into 010/020. The measured basis — macmini
`currentAccountId: 1` with the 179M profile at `u/1` while the registration sits in
`u/0` — is the actual bug and the plan addresses it directly.
