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

    mac u/1, u/2 backups:  ~/aside-codemode-backup-260915/mac-u{1,2}/codemode/cm.js
                           sha256 63562408f207da2b...

Those two are the only copies on disk. The bytes are not a git object: rebuild them from
`c7bef2a:templates/native-helper/cm.js` with `__CM_VERSION__` replaced by `1.0.0`. Taking
today's template and substituting `1.0.0` produces different bytes and is not that artifact.

## Removing the install entirely

    node scripts/install-codemode.mjs uninstall --account <id> --json

It deletes only the files whose hashes still match the manifest, keeps anything you edited,
removes the markered block from `AGENTS.md` and leaves the rest of that file, then deletes
the manifest. **The manifest is where `previous` lives**, so after an uninstall there is no
installer-side way back: use the backup above.

## Re-verifying after any of this

    node scripts/install-codemode.mjs doctor --account <id> --json    # upToDate, per-file reason
    node scripts/verify-loader.mjs --account <id>                     # the documented line, actually run
    node scripts/probe-g3.mjs --label <host>                          # the four live fixtures
    node scripts/rehearse-install.mjs                                 # the whole lifecycle, on a copy

`verify-loader` only means something for the account the CLI is signed in as; for any other
account it reports `skipped`.
