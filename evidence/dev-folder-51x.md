# Development-folder wall-clock (operator)

This is the operator-measured pair cited by the README lead. It is not a
re-run of `eval/compare.mjs`, and it is not a promise that every machine
or every task is 51x.

## Operator pair (not independently re-run here)

| Pair | Wall-clock |
| --- | ---: |
| `find` + `grep` on a local development folder | 55s |
| one `codemode --code` search on the same folder | 1s |

Ratio ≈ **51x**.

Exact host folder, unrounded clocks, and rg/find options for the 55s/1s pair were not recorded. Treat those integers as the operator report.

UI: finding 50 files used to stack 50 `read_file` cards. The same job is
one bash card.

The older Aside-turn table in [summary.md](summary.md) (1.05–1.81x / 1.13x,
model + daemon overhead) is a separate historical pair. It does not cancel
this folder wall-clock.

## Companion pair (this repo)

```sh
node eval/make-corpus.mjs /tmp/cm-corpus
node eval/bench-search.mjs --dir /tmp/cm-corpus --query NEEDLE-A1 --repeats 3 --json
node eval/bench-search.mjs --self-check
```

The companion builds a synthetic tree, runs a recorded baseline (`grep -R -n -- query root` when `grep` exists, otherwise a labeled `node-walk`) vs one `codemode --code` `search.content`, checks that the match sets are equal (`equality`), and prints unrounded `performance.now()` milliseconds for each repeat. Its ratio is not the README 51x claim. Do not write `find`+`grep` as the companion baseline.

See also [synthetic-search-bench.md](synthetic-search-bench.md).
