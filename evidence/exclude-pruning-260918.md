# What excludeGlobs prunes: measured, on one machine

Date: 2026-09-18. Produced by `node scripts/measure-excludes.mjs --runs 2` in this checkout,
which resolves the same ripgrep the host resolves and passes the same discovery arguments
`createRgRunner` builds, then counts the paths ripgrep lists. Two runs, alternating pruned and
unpruned, on one macOS home directory with ripgrep's default ignore rules in force.

## Measured result

| walk | files | run 1 | run 2 |
|---|---:|---:|---:|
| default `excludeGlobs` | 348,353 | 0.69 s | 1.24 s |
| `includeExcluded: true` | 756,239 | 1.22 s | 1.42 s |

Pruning removed **2.2x** the paths from the walk. The wall-clock difference was **1.7x** on the
first pair and **1.1x** on the second.

## What this does not claim

- It is one machine's home directory, and the figure is a property of what is stored there.
  The README sentence this replaces quoted 331,709 files in 0.77 s against 1,565,078 in 7.37 s;
  nothing in this repository records how those were produced, and this run does not reproduce
  them. A home directory with a large `~/Library` and a cold cache is a different measurement,
  not a wrong one.
- The two timings for the same walk differ by nearly a factor of two between runs, so the
  timing is cache state as much as work. The file counts are the stable part.
- Both walks respect ripgrep's default ignore rules, which is what the host does unless a call
  passes `noIgnore`. An unignored walk is a larger number that was not measured here.
- Nothing here measures whether pruning changes an answer. It measures how many paths were
  walked and how long the walk took.
