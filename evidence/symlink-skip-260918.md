# A directory that is mostly symlinks: measured

Date: 2026-09-18. Produced by `node scripts/measure-symlink-skip.mjs` in this checkout, which
builds a temporary directory of 37 entries where 35 are directory symlinks pointing at a tree
that contains a matching file, then runs the real `search.files` and `search.content` through
the host's own ripgrep runner.

## Measured result

Both searches returned **2 rows** - the two real files - with `complete: false` and
`scope.skippedSymlinks` reporting `dirs: 35`, `files: 0`, `capped: false` and `scanned: 37`.
The five example paths it lists are temporary directories on the machine that ran it.

The README quotes this shape as the case that motivated `scope.skippedSymlinks`: the same
directory used to answer with 2 rows and `complete: true`, which reads as "there are two
matching files here" rather than "there are two, and thirty-five doors I did not open".

## What this does not claim

- The 35 links all point at one target, so this measures the reporting, not a realistic tree.
- `complete: false` comes from a skipped **directory** link. A skipped file link is counted
  without lowering completeness, and that case is not in this run.
- The earlier `complete: true` behaviour is quoted from the change that replaced it; this run
  measures only the current behaviour.
- Nothing here measures whether following links would be safe. They are not followed, and
  `followSymlinks: true` is still refused.
