# Benchmark protocol

Written before the numbers, so the design cannot be fitted to the result.

## What went wrong in the first attempt

The first pass (2026-09-18, superseded) measured the **CLI** path and compared a
single `search.content` call against a single `rg` invocation. Both choices were wrong.

1. **Wrong transport.** The product is an MCP server that stays resident. The CLI spawns a
   fresh node process per call. Measured separately: empty node process 40 ms, minimal CLI
   run 80 ms, full search 100 ms, while the guest-side timer inside the same run reported
   34-39 ms. So roughly **60-70 ms of every CLI number was process startup that the MCP path
   does not pay.** Reporting that as tool latency measures the harness, not the tool.
2. **Wrong unit of work.** A single grep is the case this tool explicitly tells you not to
   use it for. Its claim is search -> read -> filter in one round trip. Measuring only the
   search step removes the thing being claimed.

Both superseded tables are kept in `local-search.md` and marked as such. They are still
valid as a statement about the CLI path.

## Claims under test

Each is falsifiable and has a stated direction.

| ID | Claim | Falsified if |
|---|---|---|
| C1 | For a single grep, `rg` is faster than codemode on the MCP path. | codemode is faster or equal |
| C2 | For search -> read -> filter, codemode uses fewer round trips at comparable wall time. | round trips are equal, or wall time is far worse |
| C3 | Codemode returns fewer bytes to the model for the same question. | returned bytes are equal or larger |
| C4 | Browser batching is faster than sequential native page reads. | batch is slower |
| C5 | Batch returns fewer bytes to the model than native snapshots. | batch returns more |
| C6 | `complete: false` fires when a search is cut short. | it stays true after a truncation or a skipped symlink |
| C7 | `complete: true` means every matching file was returned. | a default search misses files and still reports true |

C1 is expected to fail for codemode. It is included because a benchmark that only tests
claims the author expects to win is not a benchmark.

## Method

**Transport.** All primary numbers come from the resident MCP server, the path the product
documents and the one the user prefers. CLI numbers are reported separately and labelled.

**Repetition.** One discarded warm-up, then N=7 timed runs. Report median with min/max.
No outlier removal.

**Fairness.** Both sides must do identical work and return identical counts. Where codemode
prunes directories by default (`excludeGlobs`), either the `rg` side gets equivalent
`-g '!dir'` exclusions or codemode runs with `includeExcluded: true`. Result counts are
printed for every cell; a mismatch invalidates that cell.

**Round trips.** Counted as separate agent tool calls, because that is the unit an agent
actually pays. A shell pipeline that a human writes in one line is several calls for an
agent, and is counted that way.

**Bytes to model.** The serialized payload that would enter an LLM context: captured stdout
for `rg`, the returned JSON for codemode, the accessibility tree for native page reads.
Not internal buffers.

**Ground truth.** The completeness fixture has a known sentinel count, so found-versus-missed
is checked against a number fixed before the run, not against another tool's output.

**Negative control.** A string that exists nowhere is searched, to prove `complete` can be
true for an honest empty result rather than being constant.

## Environment

Recorded once, applies to every table.

| | |
|---|---|
| Machine | Apple silicon, arm64, 12 cores, 24 GiB |
| OS | macOS 27.0 |
| Node | v26.5.0 |
| ripgrep | 15.2.0 (`<aside-home>/runtime/bin/rg`) |
| codemode | 0.8.1 |
| Filesystem cache | warm |

## Known limits

- One machine, one OS, one filesystem. No cross-platform claim.
- Warm cache throughout. Cold-start numbers would differ and are not measured.
- Network pages vary run to run; browser numbers carry that variance and the URL set is fixed
  to reduce it.
- Wall-clock comparisons against `rg` describe this tree, not all trees.
