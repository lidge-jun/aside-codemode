# 020 — Fleet rollout

## Per mac (macmini as junny, macbookpro-2 as jun), in this order

1. archive the stale clone's stash before touching it:
   `git -C ~/Developer/aside-codemode stash show -p stash@{0}` into
   `~/aside-codemode-stale-stash-<host>.patch`, and print its byte count. If the
   export is empty, stop and report instead of deleting.
2. move, do not shred: `mv ~/Developer/aside-codemode ~/.Trash/aside-codemode-stale-<stamp>`.
   Recoverable. Never `rm -rf` a computed path.
3. `cd ~/aside-codemode && git fetch origin && git reset --hard origin/dev`.
   Assert `src/host/browse` exists and HEAD matches the origin/dev SHA.
4. `node scripts/register-aside.mjs` with nvm sourced, so `process.execPath` is a
   real absolute node. Assert every live account root now has marker=1 browse=1.
5. launcher: write `~/.local/bin/codemode` as an exec shim with the same absolute
   node + CLI pair, so `codemode` resolves without a global npm prefix. macmini has
   no npm on the non-login PATH, which is why `npm install -g .` silently did
   nothing there.
6. live proof: run the registered pair with `--code-file` on a probe script and
   record `browse.probe()` plus `actions.find('browse')` output under evidence/.

## Windows

Durable clone `C:\Users\super\Developers\aside-codemode` (NOT the managed
worktree, which the app deletes). Same fetch/reset, same register.

## Proof, not vibes

- `git rev-parse HEAD` on each machine equals `git ls-remote origin dev`
- `grep -c 'browse.probe'` is 1 in every live account root's AGENTS.md
- the stale path no longer exists and the archived patch file does
- probe output shows `enabled: true` and a non-empty capability map
