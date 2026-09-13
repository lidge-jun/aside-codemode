# Development-folder wall-clock (operator)

This is the operator-measured pair cited by the README lead. It is not a
re-run of `eval/compare.mjs`, and it is not a promise that every machine
or every task is 51x.

| Pair | Wall-clock |
| --- | ---: |
| `find` + `grep` on a local development folder | 55s |
| one `codemode --code` search on the same folder | 1s |

Ratio ≈ **51x**.

UI: finding 50 files used to stack 50 `read_file` cards. The same job is
one bash card.

The older Aside-turn table in [summary.md](summary.md) (1.05–1.81x / 1.13x,
model + daemon overhead) is a separate historical pair. It does not cancel
this folder wall-clock.
