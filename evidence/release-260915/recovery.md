# Recovery — code mode, 2026-09-15

## What was backed up, and where

Outside the checkout, because `evidence/` is tracked and account documents are not ours to
commit:

    ~/aside-codemode-backup-260915/mac-u0/    AGENTS.md, codemode/, skill/
    ~/aside-codemode-backup-260915/mac-u1/    same
    ~/aside-codemode-backup-260915/mac-u2/    same
    ~/aside-codemode-backup-260915/MANIFEST.sha256
    mini:~/aside-codemode-backup-260915/mini-u0/   same three
    macmini-cf:~/aside-codemode-backup-260915/AGENTS.md   (u/1, before the first install)

Only files the installer owns were copied. `settings.json`, `credentials.json`, `sessions/`,
`memory/`, other skills and `state.db` were not touched by this release and were not backed
up. This is a backup of our own footprint, not of an account.

## Going back one generation

    node scripts/install-codemode.mjs rollback --account <id> --json

This restores what the manifest's `previous` holds. Two warnings that matter:

1. **It does not inspect the disk.** A file you edited after the upgrade is overwritten.
2. **On two roots the previous generation is not what its name says.** On mac `u/0` and mini
   `u/0`, `previous.files[codemode/cm.js]` was recorded while a probe had already replaced
   the helper on disk, so the stored content is the 1.1.0 bytes even though the entry
   declared the 1.0.0 hash. Rolling back there returns 1.1.0, not 1.0.0. The installer now
   hashes what it actually holds and records `disagreedWithManifest` when the two differ, but
   the two entries written before that fix stay as they are.

## Getting the 1.0.0 helper back

Three places hold those bytes:

    backups            ~/aside-codemode-backup-260915/mac-u{1,2}/codemode/cm.js
    live manifests     mac u/1 and u/2: codemode/manifest.json -> previous.files[cm.js].content
    rebuilt from git   c7bef2a:templates/native-helper/cm.js with __CM_VERSION__ -> 1.0.0

All three are `63562408f207da2bdaa88a289a3f547e63718178c435c9cfc151e39f47cb11f9`, 6317 bytes.
On mac u/1 and u/2, `rollback` really does return 1.0.0. On mac u/0 and mini u/0 it does not,
for the reason in the previous section.

The bytes are not a git object of their own. Taking today's template and substituting
`1.0.0` produces `f90180f9…`, which is a different file.

The backup keeps the skill under `skill/`; the live path is
`skills/user/aside-codemode/`. Copy accordingly:

    cp -R ~/aside-codemode-backup-260915/mac-u1/skill/. ~/.aside/u/1/skills/user/aside-codemode/
    cp -R ~/aside-codemode-backup-260915/mac-u1/codemode/. ~/.aside/u/1/codemode/
    cp    ~/aside-codemode-backup-260915/mac-u1/AGENTS.md ~/.aside/u/1/AGENTS.md

## Removing the install entirely

    node scripts/install-codemode.mjs uninstall --account <id> --json

It deletes only the files whose hashes still match the manifest, keeps anything you edited,
removes the markered block from `AGENTS.md` and leaves the rest of that file, then deletes
the manifest. **The manifest is where `previous` lives**, so after an uninstall there is no
installer-side way back: use the backup above.

## Re-verifying after any of this

**Read the next paragraph before running anything here.** Two of these commands are not
read-only.

`probe-g3.mjs` writes the **current** helper into the account root before it starts, because
it is testing the real load path. Run it against a restored 1.0.0 account and it will replace
that file with 1.1.0 - the same move that left two accounts ahead of their own manifest. Use
`--no-install` there:

    node scripts/probe-g3.mjs --label <host> --no-install

`verify-loader.mjs` compares what it loaded against the `HELPER_VERSION` of the **checkout**
it runs from. On an account you deliberately rolled back to 1.0.0, a checkout at 1.1.0 will
report failure, and that failure is correct: the account is not running this build.

    node scripts/install-codemode.mjs doctor --account <id> --json   # read-only: upToDate, per-file reason
    node scripts/verify-loader.mjs --account <id>                    # reads the account, runs one REPL line
    node scripts/probe-g3.mjs --label <host> --no-install            # live fixtures, without reinstalling
    node scripts/rehearse-install.mjs                                # a throwaway account root; touches nothing real

`verify-loader` only means something for the account the CLI is signed in as; for any other
account it reports `skipped`.

## One more thing about macmini-cf

Accounts `u/0` and `u/2`–`u/6` there still carry the older managed block that
`register-aside.mjs` wrote on 2026-09-14. This release installed into `u/1` only. Those six
report `installed: false` and `agentsBlock: stale` from doctor, which is accurate: they have
guidance text but no install.
