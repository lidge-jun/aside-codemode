# wp8 — Fleet deploy path

## Why this exists

The browse build is on origin/dev but the fleet does not actually run it. Three
separate defects, each measured on 2026-09-14, not assumed:

1. `applyRegister()` hardcodes the account root to `<asideHome>/u/0`.
   macmini's `~/.aside/accounts.json` has `currentAccountId: 1` and account 1 is the
   real cloud account (bitkyc07, 179M profile). Account 0 there is an anonymous
   Local Account. So on macmini the registration landed on a profile Aside is not
   running as, and the live profile's AGENTS.md is 77 bytes with no codemode block.
   macbookpro-2 happens to have bitkyc07 as id 0, which is why it worked there.
   One machine working was luck, not design.

2. Two clones per mac. `~/Developer/aside-codemode` is main @ 8223264 with no
   `src/host/browse`, and `~/aside-codemode` is dev with browse. Verified by grep
   that nothing references the stale path: not the registered AGENTS.md, not
   .zshrc/.zprofile/.bashrc, not ~/.config, not LaunchAgents, not crontab. Both
   stale clones have a clean worktree and no unpushed commits, but each holds one
   `git stash` entry, which a plain delete would destroy.

3. Both macs sit at b7d15a3. The two fixes the user actually hit are in b4706b6:
   `--code-file`/`--code -` (the cause of the reported hang: guest code contains
   quotes, the URL's inner quote closes the agent's outer quote and bash waits
   forever) and the actions registry (the cause of the unreadable job shape:
   `browse.*`/`report.*`/`api.*`/`recipes.*` were absent from `actions.list()`).

## Scope

IN: src/register.js, scripts/register-aside.mjs, test/register-accounts.test.js,
evidence/. Remote: update the three machines, remove the stale mac clone after
archiving its stash, re-register, probe.

OUT: merging dev into main. No edits to ~/.aside settings beyond the managed
AGENTS block and the existing MCP server entry. No deletion of anything outside
the two named stale clone paths.

## Docs

- 010_register_accounts.md — the code change, diff level
- 020_fleet_rollout.md — the remote procedure and its proofs

## Done means

- register writes the managed block into every real Aside account root, current
  account first, and reports per-root results
- `node scripts/run-tests.mjs` green on Windows
- both macs and Windows on the pushed origin/dev head, with browse present
- `~/Developer/aside-codemode` gone on both macs, its stash archived as a patch
  file first, and the removal recoverable (Trash, not rm -rf)
- a live `browse.probe()` on each mac returning enabled:true from the registered
  absolute node + CLI pair, captured under evidence/
