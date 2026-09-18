# Benchmarks

Measured 2026-09-18 on codemode 0.8.1. Method and environment: [PROTOCOL.md](evidence/bench-260918/PROTOCOL.md),
written before the numbers so the design could not be fitted to the result.

## The baseline is `grep` and `find`, not ripgrep

Aside ships a real ripgrep — `runtime/native/bin/rg`, 6,476,288 bytes, 15.2.0 with pcre2,
first on the agent PATH — and exposes **no harness tool that calls it**. A search of the
installed app bundle finds no `Grep`, `Glob`, `ripgrep`, `search_files`, `grep_search`, or
`codebase_search` tool. The engine is installed; nothing is wired to it.

So an agent's actual options are POSIX `grep` and `find` through bash, or codemode. Comparing
against `rg` would measure a route the agent cannot take. Ripgrep numbers are kept below as a
**ceiling**, not a baseline.

All codemode numbers are from the resident MCP server. The CLI spawns a node process per call
and pays 60–70 ms of startup that the MCP path does not; CLI figures are in
[evidence/bench-260918/local-search.md](evidence/bench-260918/local-search.md) and are not
product numbers.

N=7 after one discarded warm-up. Median with range. Result counts matched on every cell.

## Against what an agent actually has

| workload | POSIX | codemode | bytes into model | round trips |
|---|---:|---:|---|---|
| find `export` in `*.js` | grep 21.0 ms | **19 ms** | 43,948 vs 35,750 | 1 = 1 |
| list every `*.md` under a 39,831-file tree | find 5,467 ms | **2,063 ms** | 3.96 MB vs 4.02 MB | 1 = 1 |
| count `function` across `~/Developer` | **could not finish** | 2,966 ms | — | — |
| find files, read three, return a total | grep+cat 20.3 ms | **19 ms** | **39,154 vs 90** | **2 vs 1** |

### The composite task is the one that matters

Find `.js` files containing `throw new`, take the first three by path, read them, return the
names and total size. Both sides resolve to the same three files and the same 36,497
characters.

Wall clock is a tie. The difference is what lands in the transcript:

- `grep -rl` then `cat`: **39,154 bytes** across **2 round trips**
- codemode: **90 bytes** in **1 round trip**

**435×.** Not compression — placement. The shell pipeline puts the file list and the full
contents of three files into the model's context, because reading a file is how an agent
reads a file. Codemode does the same reads inside the sandbox and returns only the answer.

### The question POSIX cannot ask

Counting `function` across `~/Developer` is the interesting failure. `grep -r -I` did not run
slowly; it ran past **128 seconds having emitted 3.23 GB and 3.7 million lines, still
incomplete**, and was aborted. Even `grep -r -I -c` reached 78 MB of per-file counts before
the cap.

codemode answers the same question in **2,966 ms** and returns **778 bytes**: 502,963 matching
lines across 57,403 files.

An agent holding only POSIX tools cannot ask this question at all. The output would bury the
conversation before the answer arrived.

## Against ripgrep, as a ceiling

What a native engine does on the same tree, for reference. Not available to an Aside agent
without shelling out.

| workload | rg | codemode (MCP) |
|---|---:|---:|
| content search | 18.0 ms | **12 ms** |
| count over `~/Developer` | 3,047 ms | **2,966 ms** |
| file listing | **183.5 ms** | 188 ms |
| composite | 18.6 ms (2 trips) | **12 ms** (1 trip) |

Level, because `search.*` shells out to that same ripgrep. codemode is not a faster search
engine; it is the same engine with the result filtered before it reaches the model.

## Browser batching

Eight fixed URLs, three runs.

| | native sequential | `browse.exec` |
|---|---:|---:|
| wall clock | 7,567 ms | **2,935 ms** |
| bytes into model | 116,234 | **356** |
| round trips | 24 | **1** |
| tabs leaked | — | 0 |

Parallel gain 2.69–2.87× across runs, against 8,354 ms of summed navigation. Native cost is
three calls per page (open, snapshot, close); the accessibility trees are what a reading agent
actually receives.

## Tool schema

The MCP server exposes one tool. Its full definition is **2,418 bytes** (2,019 description,
274 input schema) and covers **34 guest actions** whose own descriptions total **42,506
bytes** — **17.6×**. `browse.exec` alone is 8,131 bytes described, more than three times the
entire resident tool surface. Schema is paid every turn; action descriptions are fetched only
when `actions.describe` is called.

## Where codemode loses

- **Single small grep.** Roughly a tie on time and **larger** on bytes: 43,948 against
  grep's 35,750, because rows carry structure and a completeness envelope. If one line
  answers the question, one line is the right tool.
- **Plain file listing** against ripgrep directly — 188 ms vs 183.5 ms. Against `find` it
  wins by 2.6×, but that is `find` losing, not codemode winning.
- **Unpruned counting** against ripgrep: 3,483 ms vs 3,045 ms.
- **CLI transport**: 93.8 ms for a search the MCP path serves in 12 ms. Use the MCP route.

## What these numbers do not show

One machine (Apple silicon, 12 cores, 24 GiB, macOS 27.0, node v26.5.0), warm filesystem
cache, one repository, one network location. Different trees and cold caches will differ.
Round trips are counted as agent tool calls, which is the unit an agent pays; a human writing
one shell pipeline pays one.

`complete: true` is **not** a guarantee that every matching file was returned — see
[issue #41](https://github.com/lidge-jun/aside-codemode/issues/41) and
[evidence/bench-260918/mcp-completeness.md](evidence/bench-260918/mcp-completeness.md).
A default search on the fixture returned 8 of 15 known matches and still reported complete.
