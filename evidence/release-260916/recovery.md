# Recovery — code mode, 2026-09-16 (0.3.0)

The 0.2.0 recovery note at `evidence/release-260915/recovery.md` still describes how to get
the 1.0.0 helper back and what the two disagreeing snapshots are. This file records what
this release backed up and what changed about going back.

## What was backed up, and where

Outside the checkout, because `evidence/` is tracked and account documents are not ours to
commit. Taken before anything was written, on each machine:

    ~/aside-codemode-backup-260915/            mac u/0, u/1, u/2 (this release re-ran it)
    macmini-cf:~/aside-codemode-backup-260915/ u/1
    mini:~/aside-codemode-backup-260915/       u/0

The backup script stamps its directory with the date it runs, so a second run on the same
day writes into the same tree. Only files the installer owns were copied: the managed
`AGENTS.md` block, `codemode/` and the user skill. Settings, credentials, sessions, memory,
other skills and `state.db` were not touched and were not copied. This is a backup of our
own footprint, not of an account.

## What 0.3.0 actually changed on a live account

The helper did not move: `cm.js` is the same 6456 bytes and the same
`f5584a8081bdd41f935d2ba156953b27e13606eea4ab680ed88387ad4b898f99` on all five accounts,
and `HELPER_VERSION` stays 1.1.0. What changed is the guidance: the AGENTS block, the skill,
the two existing references, and one new file:

    skills/user/aside-codemode/references/call-shapes.md

That file is why a rollback needed fixing. It did not exist in 0.2.0, so the previous
generation has no record of it.

## Going back one generation

    node scripts/install-codemode.mjs rollback --account <id> --json

Three things to know, the third of which is new:

1. **It does not inspect the disk.** A file you edited after the upgrade is overwritten.
2. **On two roots the previous generation is not what its name says.** On mac `u/0` and mini
   `u/0`, the entry for `codemode/cm.js` declares the 1.0.0 hash while holding the 1.1.0
   bytes, because a probe had replaced the helper before the snapshot was taken. Rolling
   back there returns 1.1.0. The two entries written before that fix stay as they are; the
   1.0.0 bytes and the three places that hold them are in the 0.2.0 recovery note.
3. **It now removes what the newer generation added.** Rolling 0.3.0 back to 0.2.0 deletes
   `references/call-shapes.md` and reports it in `dropped`. A copy you edited yourself is
   left alone and is not listed. Before this the file stayed behind under a 0.2.0 manifest
   that had never heard of it, and `doctor` reported our own file as `new`.

## Removing the install entirely

    node scripts/install-codemode.mjs uninstall --account <id> --json

Same rules as before — only matching hashes are deleted, edits are kept, the managed block
leaves `AGENTS.md` and the rest of that file stays. It now also removes `codemode/`, the
skill directory and its `references/` when it has emptied them; before 0.3.0 the empty
`references/` was left behind on every account.

**The manifest is where `previous` lives**, so after an uninstall there is no installer-side
way back: use the backup.

## Re-verifying after any of this

Two of these are not read-only. `probe-g3.mjs` writes the current helper into the account
root before it starts, so use `--no-install` on an account you deliberately rolled back.
`verify-loader.mjs` compares what it loaded against the `HELPER_VERSION` of the checkout it
runs from, and only means anything for the account the CLI is signed in as.

    node scripts/install-codemode.mjs doctor --account <id> --json   # read-only
    node scripts/verify-loader.mjs --account <id>
    node scripts/probe-g3.mjs --label <host> --no-install
    node scripts/rehearse-install.mjs                                # throwaway account root

Note that none of these four ship in the npm package any more; they are checkout tooling.

## What this release did not touch

macmini-cf `u/0` and `u/2`–`u/6` still carry the older managed block that
`register-aside.mjs` wrote on 2026-09-14 and have no install. Doctor reports
`installed: false` and `agentsBlock: stale` there, which is accurate. 0.3.0 installed into
`u/1` only, the same account 0.2.0 used.
