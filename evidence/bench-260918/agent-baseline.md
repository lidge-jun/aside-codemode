# Agent baseline: POSIX grep/find vs MCP codemode (2026-09-18)

Method: [PROTOCOL.md](PROTOCOL.md). Raw timings: [`agent-baseline.raw.json`](agent-baseline.raw.json). Harness used to collect them: [`run-agent-baseline.py`](run-agent-baseline.py).

This is the comparison that previous local-search passes did not make. Those tables timed `<aside-home>/runtime/bin/rg` against MCP `search.*`. Ripgrep is on the agent PATH. It is **not** a harness tool.

## Why grep/find is the correct baseline

An Aside agent in this environment has two search surfaces:

1. **bash**, with `PATH=<aside-home>/runtime/bin:/usr/bin:/bin:/usr/sbin:/sbin`, a non-login shell.
2. **`mcp__aside-codemode__execute_code`**, which can call `search.content` / `search.files` / `search.count` and then `fs.read` in one guest body.

The harness does not expose Grep, Glob, ripgrep, `search_files`, or `codebase_search`. There is no tool whose job is “run rg and return the hits.” The rg binary is present because Aside bundles it for the product (codemode’s own backend). An agent that types `rg` in bash is using an undocumented implementation detail, not a provided tool.

So the competent-agent baseline is BSD grep and BSD find:

```
/usr/bin/grep   grep (BSD grep, GNU compatible) 2.6.0-FreeBSD
/usr/bin/find   BSD find
```

No `timeout`, no `gdate`. Wall time is `python3 -c "import time;print(int(time.time()*1e9))"` around `subprocess.run`. MCP time is `Date.now()` inside the guest around the `search.*` / `fs.read` calls.

This pass never invoked `rg`. It is on PATH; it was not used.

## Alignment

grep and find respect **no** `.gitignore` and apply **no** `excludeGlobs`. A default `search.*` call is therefore a different walk: on `<devroot>` it hides about half the markdown files (19,690 vs 39,831).

The comparison tables below use the **unpruned** alignment:

| side | flags |
|---|---|
| grep / find | none (native behaviour) |
| MCP `search.*` | `noIgnore: true`, `hidden: true`, `includeExcluded: true` |

That is the fair cell. Pruned MCP numbers (gitignore + `excludeGlobs`) are recorded as a cross-check against the earlier MCP-vs-rg pass; they are **not** compared to grep/find, because the counts would not match.

Result counts are printed in every cell. A mismatch would invalidate the cell. None of the completed cells mismatch.

## Environment

Recorded 2026-09-18, Asia/Seoul. Sequential N=7 after one discarded warm-up; filesystem cache warm. MCP numbers for W1/W4/W3 unpruned are a **quiet rerun** after the 3.2 GiB W2 grep had finished; a concurrent-with-baseline MCP sample was discarded as contended.

| | |
|---|---|
| Machine | Apple M4 Pro, arm64, 12 cores, 24 GiB |
| OS | macOS 27.0 (26A5353q) |
| Node | v26.5.0 (MCP server already resident) |
| grep | BSD grep 2.6.0-FreeBSD (`/usr/bin/grep`) |
| find | BSD find (`/usr/bin/find`) |
| python3 | 3.9.6 (`/usr/bin/python3`) |
| MCP timing | `Date.now()` inside guest (1 ms quantization) |
| grep/find timing | `time.time_ns()` around `subprocess.run` |
| Round trips | separate agent tool calls |
| Bytes into model | captured stdout for grep/find; `JSON.stringify` of the guest return value for MCP |

Parent MCP-vs-rg cross-check on this machine (pruned, medians): W1 12 ms, W3 188 ms, W4 12 ms / 90 bytes / 1 round trip. A quiet re-run here was W1 11 ms, W3 194 ms, W4 11 ms / 90 bytes. Same work, within noise. Those pruned numbers are **not** the grep comparison.

## W1. Content search

Query `export` in `<repo>`, only `*.js` files.

Two POSIX spellings, plus the find alternative. The idiomatic agent command is `grep -rn --include='*.js'`: `-n` is what you write when you will later open a hit. The no-`-n` spelling is included because it is what a “just dump the lines” call looks like, and its stdout is byte-identical to the earlier rg pass (34,828).

All three POSIX commands and unpruned MCP return **287 matching lines in 58 files** on every timed run.

### Unpruned (the comparison)

| side | spelling | round trips | matches / files | bytes into model | median | min | max |
|---|---|---:|---|---:|---:|---:|---:|
| grep `-r --include='*.js'` (no `-n`) | alternative | 1 | 287 / 58 | 34,828 | **21.7 ms** | 20.4 | 23.4 |
| grep `-rn --include='*.js'` | **idiomatic** | 1 | 287 / 58 | 35,750 | **21.0 ms** | 19.9 | 23.0 |
| find `-name '*.js' -type f -exec grep -n {} +` | alternative | 1 | 287 / 58 | 35,750 | **26.5 ms** | 25.0 | 27.3 |
| MCP `search.content` unpruned | | 1 | 287 / 58 | 43,948 | **19 ms** | 18 | 21 |

Raw grep `-rn`: 22.215, 20.290, 20.512, 23.015, 19.862, 21.001, 21.486.
Raw grep no `-n`: 22.944, 20.417, 20.485, 20.642, 21.898, 23.417, 21.707.
Raw find -exec: 25.007, 27.255, 26.206, 26.757, 26.141, 26.938, 26.524.
Raw MCP unpruned: 19, 21, 19, 19, 18, 18, 18.

Counts match. `complete: true`, `truncated: false` on the MCP side. This repo has no `node_modules` under the glob, so pruned MCP is the same 287 / 58 (median 11 ms, 44,071 bytes; parent 12 ms). Pruned is faster because it skips the ignore-file walk, not because it finds fewer hits.

**W1 wall clock: roughly tied; MCP is a few milliseconds ahead of idiomatic grep (19 vs 21).** `Date.now()` is 1 ms; do not read 19 vs 21 as a deep effect. **W1 bytes: grep wins.** Typed `{file,line,text}` rows plus the completeness envelope are 43,948 bytes against 34,828–35,750 of grep text. If the model needs the lines, grep is the cheaper payload.

The find -exec spelling is a real alternative a competent agent would write when `--include` is forgotten or mistrusted. It is slower here (~26 ms) because it is two processes and a file list, not because it was crippled.

## W2. Content search over `<devroot>`

**Skipped.** A full POSIX `grep -r` over Developer does not finish inside the 120 s cap. That is the result.

One-shot, 120 s cap, then abort:

| spelling | outcome |
|---|---|
| `/usr/bin/grep -r -I function <devroot>` | **>120 s (aborted)** at 128.5 s. Partial stdout **3,234,758,656 bytes** (3.01 GiB), 3,723,306 lines, still incomplete. |
| `/usr/bin/grep -r -I -c function <devroot>` (count per file, no line dump) | **>120 s (aborted)** at 120.0 s. Partial stdout 78,282,752 bytes, 616,458 file-count lines, still incomplete. |

`-I` (skip binary) is already the strong spelling. There is no `timeout` binary to wrap it. N=7 was not started.

This is not a measurement failure. It is what the baseline actually does on a tree this size. The earlier rg `--stats --quiet` pass finished the same question in ~3 s and reported 502,963 matched lines / 57,403 files. An agent that only has POSIX grep cannot usefully ask W2. Codemode `search.count` can; that number lives in [mcp-local-search.md](mcp-local-search.md) and is **not** re-derived here, because there is no grep cell to put it next to.

## W3. File listing

All `*.md` under `<devroot>`.

Idiomatic: `find <devroot> -name '*.md' -type f`. Without `-type f`, BSD find also emits directories whose names end in `.md` (45 extra paths on this tree). Both were timed.

MCP is `search.files({ path, glob: '**/*.md', max: 1_000_000, noIgnore: true, hidden: true, includeExcluded: true })`. `max` is raised so the default 5,000-row cap does not fire; a default call would be different work.

### Unpruned (the comparison)

| side | spelling | round trips | paths | bytes into model | median | min | max |
|---|---|---:|---:|---:|---:|---:|---:|
| find `-name '*.md'` (no `-type f`) | alternative | 1 | 39,876 | 4,022,429 | **5379 ms** | 5364 | 5634 |
| find `-name '*.md' -type f` | **idiomatic** | 1 | **39,831** | 4,019,241 | **5467 ms** | 5437 | 5800 |
| MCP `search.files` unpruned | | 1 | **39,831** | 3,962,414 | **2063 ms** | 1894 | 2135 |

Raw find `-type f`: 5507.578, 5495.189, 5467.435, 5450.627, 5436.696, 5800.290, 5457.759.
Raw find no `-type f`: 5399.211, 5378.836, 5365.876, 5377.880, 5364.399, 5414.739, 5634.353.
Raw MCP unpruned: 1894, 2113, 2097, 2135, 2035, 2063, 2061.

Counts match on the idiomatic cell (39,831 = 39,831). The no-`-type f` row is 45 paths larger; it is reported so the spelling difference is visible, and it is **not** compared to MCP.

MCP reports `complete: false`, `truncated: false`, one skipped directory symlink (`kim_wiki`). find does not follow that link either and does not set a completeness bit.

**W3: MCP is faster, about 2.6× (2063 vs 5467 ms).** Bytes are the same order of magnitude (~4.0 MB of paths vs ~4.0 MB of JSON paths plus envelope). Neither side is a good thing to dump into a prompt; the listing itself is the payload. Codemode is not a better lister in the “return every path” sense. It is a faster walker than BSD find on this tree, because the backend is still ripgrep `--files` even when ignore rules are off.

Pruned MCP on the same glob is a different question (19,690 paths, parent 188 ms / this rerun 194 ms, 1,900,558 bytes). Do not line that up with find’s 39,831.

## W4. Search, then read, then filter

Find `*.js` files under `<repo>` containing the literal `throw new`, take the first 3 sorted by path, read them, produce total character count.

Codemode: one guest body (`search.content` + `fs.read` of three files) returning `{files, totalChars}`.
grep/find: **two agent round trips** — list files, then `cat` the first three. A human pipeline is one shell. Round trips are the agent unit.

Both POSIX spellings and unpruned MCP resolve to the same three files and the same content size on every timed run:

1. `src/activate.js`
2. `src/config.js`
3. `src/execution-output.js`

Hit files: 44. Hit rows (line matches): 212. Total chars of the three files: **36,497**. Cat stdout of those three: 36,511 bytes (UTF-8 vs JS string length).

### Unpruned (the comparison)

| side | spelling | round trips | wall time | bytes into model |
|---|---|---:|---:|---:|
| grep `-rl -F --include='*.js'` + cat | **idiomatic** | **2** | 17.7 + 2.6 = **20.3 ms** | 2,643 + 36,511 = **39,154** |
| find `-name '*.js' -exec grep -l -F {} +` + cat | alternative | **2** | 22.4 + 2.7 = **25.1 ms** | **39,154** |
| MCP `search.content` + `fs.read` | | **1** | **19 ms** | **90** |

MCP payload, 90 bytes: `{"files":["src/activate.js","src/config.js","src/execution-output.js"],"totalChars":36497}`.

Raw grep list: 16.829, 16.777, 16.765, 17.708, 18.638, 19.839, 17.720 (median 17.708).
Raw grep cat: 3.014, 2.505, 2.635, 2.633, 2.948, 2.635, 2.840 (median 2.635).
Raw grep totals: 19.843, 19.282, 19.400, 20.341, 21.586, 22.474, 20.560 (median 20.341).
Raw find totals: 25.217, 25.230, 24.348, 25.028, 24.530, 25.277, 25.127 (median 25.127).
Raw MCP unpruned: 18, 19, 19, 19, 19, 19, 19 (median 19).

Counts match (44 files, same three paths, 36,497 chars). Pruned MCP on this repo is the same answer (parent 12 ms / 90 bytes; this rerun 11 ms / 90 bytes) because ignore rules do not hide these hits.

**C2 holds on round trips (1 vs 2).** Wall time is a near-tie (19 vs 20.3 ms) on a tiny hot tree; the find spelling is a few milliseconds behind.

**C3 holds, and this is still the largest effect.** 90 bytes against 39,154, a factor of **435**. The shell path puts the file list and the full contents of three files into the transcript, because that is how an agent reads a file. Codemode does the same reads inside the sandbox and returns only the answer.

## Across workloads (unpruned, idiomatic POSIX vs MCP)

| workload | POSIX median | MCP median | ratio (MCP / POSIX) | counts | bytes (MCP vs POSIX) | round trips | who wins |
|---|---:|---:|---:|---|---|---|---|
| W1 scoped content | 21.0 ms (grep `-rn`) | 19 ms | 0.90× | 287 = 287 | 43,948 vs 35,750 | 1 = 1 | MCP time, barely; **grep bytes** |
| W2 Developer-wide content | **>120 s (aborted)** | — (no grep cell) | — | grep did not finish | 3.01 GiB partial vs n/a | 1 | **POSIX cannot complete** |
| W3 md listing | 5467 ms (find `-type f`) | 2063 ms | 0.38× | 39,831 = 39,831 | 3,962,414 vs 4,019,241 | 1 = 1 | **MCP time** |
| W4 search then read 3 | 20.3 ms (2 RT) | 19 ms (1 RT) | 0.94× | 36,497 chars = 36,497 | **90 vs 39,154** | **1 vs 2** | MCP RT + bytes; time tied |

## Where codemode loses

One completed cell, reported plainly:

- **W1 bytes.** For the same 287 lines, MCP returns 43,948 bytes of typed rows plus envelope; idiomatic grep returns 35,750 (no-`-n` grep 34,828). If the question is “give me the matching lines,” grep is the cheaper payload. C3 is about *filtered* answers, not about dumping search hits.

Wall clock, unpruned, this tree, this day: MCP does not lose W1, W3, or W4. The W1 and W4 gaps are a few milliseconds on a hot cache and a 1 ms guest clock. The W3 gap is real (find is a 5.5 s walk; MCP is a 2.1 s walk).

Cells that look like MCP losses if you mix alignments, and are not:

- **Pruned MCP W3 (188–194 ms, 19,690 paths) vs unpruned find (5467 ms, 39,831 paths).** Invalid. Different work. The fair cell is 2063 vs 5467, same 39,831 paths.
- **Parent MCP-vs-rg W1 (12 vs 18 ms).** That was rg, not grep, and pruned. Idiomatic grep on the same repo is 21 ms; unpruned MCP is 19 ms.

## Limits

- One machine, warm cache, one Developer tree. Cold-start find is worse (W3 warmup was 11.9 s before settling at 5.5 s); those warm-ups are discarded per protocol.
- The MCP server is already running. Server start is not in these numbers.
- `Date.now()` is 1 ms. W1/W4 MCP values are quantized.
- grep/find were not given hand-written `-prune` / `--exclude-dir` lists to fake gitignore. A human can write those. A typical agent does not, and this baseline is “what a competent agent actually types,” not “the fastest POSIX program that reproduces rg’s ignore graph.”
- rg remains on PATH. An agent that types `rg` in bash is outside this table; that comparison is [mcp-local-search.md](mcp-local-search.md).
- W2 has no MCP number in this file. Measuring `search.count` again would not create a grep cell.
- Default MCP caps (`search.content` 500, `search.files` 5,000) were raised so the work matched. An unaligned “faster” sentence that silently truncated would be false. W3 without `max: 1_000_000` returns 5,000 of 39,831.
- Round trips are the agent unit. A person typing `grep -rl … | sort | head | xargs cat` pays one shell. The W4 byte win is real for agents.
- Bytes into the model for MCP are the guest *return value*, not the MCP JSON envelope (`{ok, result, logs, elapsedMs}`). The envelope is harness overhead the previous CLI pass paid and this MCP path still serializes to the client; it is not what `search.*` itself hands the guest.

## What these numbers do not say

- They do not say MCP is faster than ripgrep. The rg tables already exist and are a different question.
- They do not say MCP is a better file lister. W3 still dumps ~4 MB of paths. The win is walk time against BSD find, not a smaller answer.
- They do not say a 19 ms grep is a problem. W1 is a tiny repo. The baseline’s actual failure mode is W2: POSIX grep over Developer produces gigabytes and does not finish.
