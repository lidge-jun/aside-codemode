# Local search: codemode vs ripgrep (2026-09-18)

Repeated wall-clock comparison of `node bin/codemode.mjs --code-file …` against the same machine's ripgrep on four workloads. Produced for a public benchmark document. Raw timings: [`local-search.raw.json`](local-search.raw.json).

This run does **not** show a speedup for the wrapper. On three workloads ripgrep is clearly faster. On the large count they are within a few percent, with ripgrep still slightly ahead on median.

## Environment

Recorded 2026-09-18, local clock Asia/Seoul. Timed window (ISO): `2026-09-18T03:32:25Z` (first W1 timed set) through `2026-09-18T03:41:15Z` (W2 finished). The tree was not frozen; counts below were stable across the seven timed runs of each cell.

| item | value |
|---|---|
| CPU | Apple M4 Pro (`machdep.cpu.brand_string`) |
| arch | arm64 |
| cores | 12 (`hw.ncpu`) |
| RAM | 25,769,803,776 bytes = 24 GiB (`hw.memsize`) |
| OS | macOS 27.0 (build 26A5353q) |
| node | v26.5.0 |
| ripgrep | 15.2.0 (`features:+pcre2`, NEON, PCRE2 10.45 JIT) |
| rg binary timed | `<aside-home>/runtime/bin/rg` (bash wrapper that `exec`s `<aside-home>/runtime/native/bin/rg`) |
| rg binary inside codemode | `<aside-home>/runtime/native/bin/rg` (`--doctor`: `resolvedSource: aside-bundled`) |
| codemode CLI | `node <repo>/bin/codemode.mjs --code-file <guest> --timeout-ms 120000` |
| config roots | `<home>` |
| `excludeGlobs` | `Library`, `node_modules`, `.Trash`, `.cache`, `.npm`, `.gradle`, `Caches`, `chrome-debug-profile*`, `Pictures`, `Movies`, `Music` |
| guest output budget | `CODEMODE_OUTPUT_BYTES=16777216` (16 MiB). Default `maxResultBytes` is 64 KiB and would have truncated W3 JSON. |

The operator brief said 26 GB RAM. This machine reports 24 GiB via `sysctl hw.memsize`. The table uses the measured figure.

## Method

- **Warm-up discarded.** Each (workload × alignment) cell ran **1 discarded warm-up + 7 timed runs**. Only the seven timed runs enter the tables. The warm-up is the first pair, with ripgrep first; after that the start order **alternates** so neither side always runs second on a hot cache.
- **Timing.** `process.hrtime.bigint()` around `spawnSync`. Codemode time **includes node process startup**, CLI load, guest VM, ripgrep, JSON serialize, and process exit. Ripgrep time is the rg process (or, for W4, a `bash -lc` that runs rg plus three `wc -c`). Inner guest `elapsedMs` is reported separately and is **not** the headline number.
- **Same work.** Both sides use ripgrep's default gitignore / hidden / no-follow behaviour (`--no-ignore`, `--hidden`, `--follow` are off). Both pass `--no-config --path-separator=/` (codemode `BASE_ARGS`). Guest searches pass `timeoutMs: 120000` so the inner 30 s rg default cannot cut W2 short.
- **Two alignments**, both reported:

  | alignment | codemode | ripgrep |
  |---|---|---|
  | **pruned** | default `excludeGlobs` (`includeExcluded` omitted / false) | matching `-g '!<glob>'` for each exclude |
  | **unpruned** | `includeExcluded: true` | no exclude globs |

  An unaligned comparison (default-pruned codemode vs bare rg) is not used as a speed claim.
- **Result counts** are recorded every timed run. If they differ, the cell says so and the reason is in that workload's notes.
- **Output bytes** = actual stdout of the timed process. For ripgrep that is the bytes a caller would capture. For codemode that is `JSON.stringify` of the CLI envelope (`{ok, result, logs, elapsedMs}`), which itself JSON-serializes search results as `{rows, complete, truncated, partial, scope}` (or `{matches, files, …}` for counts).
- **Caps raised to make the work the same.** Default `searchCaps.content = 500` and `searchCaps.files = 5000`. W1 sets `max: 100000` (287 hits, so the default 500 would have been enough). W3 sets `max: 1000000`; **without that, codemode returns 5000 rows and `truncated: true` against rg's 19,690 paths.** That default-cap contrast is in a probe, not in the N=7 table.
- Median of 7 is the 4th value of the sorted times. Min/max are the extremes of those seven. No outlier drop.

Harness (not part of the product): `<tmp>/local-search-bench.mjs`.

## W1. Content search, scoped repo

Query `export` in `<repo>`, glob `**/*.js`. Both sides return every matching line (287 < default content cap).

### Pruned

| side | process invocations | result count (matching lines) | stdout bytes | median ms | min ms | max ms |
|---|---:|---:|---:|---:|---:|---:|
| rg | 1 | 287 / 287 / 287 | 34,828 | **16.7** | 16.1 | 20.1 |
| codemode | 1 | 287 / 287 / 287 | 44,119 | **93.8** | 92.2 | 97.4 |

Timed ms: rg `[16.5, 18.2, 16.7, 16.1, 20.1, 16.2, 16.7]`; codemode `[93.8, 95.1, 93.5, 93.3, 97.4, 92.2, 95.5]`.

Guest `elapsedMs` (inside the already-started node process): 34–36. The other ~60 ms is node + CLI + JSON.

`complete: true`, `truncated: false` on every timed run. Symlink scan of this repo: 305 entries, 0 skipped.

### Unpruned

| side | process invocations | result count | stdout bytes | median ms | min ms | max ms |
|---|---:|---:|---:|---:|---:|---:|
| rg | 1 | 287 / 287 / 287 | 34,828 | **16.4** | 13.9 | 17.3 |
| codemode | 1 | 287 / 287 / 287 | 43,998 | **91.8** | 90.6 | 93.2 |

Timed ms: rg `[15.0, 17.2, 17.3, 17.2, 13.9, 16.0, 16.4]`; codemode `[90.6, 91.8, 93.0, 93.1, 91.7, 91.3, 93.2]`.

Pruned vs unpruned counts are identical: this checkout has no `node_modules` (and none of the other exclude names) under the glob. The 121-byte JSON difference is the serialized `scope.excludeGlobs` list, present only when pruning is on.

**W1: ripgrep is faster.** Median ratio (codemode / rg) ≈ **5.6×** both alignments. Counts match. Codemode JSON is ~27% larger than rg line output because it wraps each hit as `{file, line, text}` plus the envelope.

## W2. Content count, large tree

Query `function` in `<devroot>`, `ignoreCase: false`. No glob.

**Comparable count is matched lines, not submatches.** `search.count` streams `rg --json` and increments once per `type=match` event (one per matching line). `rg --stats` reports both `matches` (submatches) and `matched lines`. The tables use matched lines. Submatches on this tree were 653,480 every run.

The rg side is `rg --stats --quiet` so stdout is the stats block, not half a million lines. That is the honest count-to-count comparison. Dumping every match from rg would be a different, much larger output and was not timed into the N=7 table.

### Pruned

| side | process invocations | matched lines | files with matches | files searched | stdout bytes | median ms | min ms | max ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rg `--stats --quiet` | 1 | 502,963 | 57,403 | 127,177 | 187 | **3637** | 3473 | 4054 |
| `search.count` | 1 | 502,963 | 57,403 | (not a public field; see files searched on rg) | 827 | **3796** | 3392 | 4160 |

Timed ms: rg `[4054, 3951, 3707, 3637, 3473, 3573, 3581]`; codemode `[4160, 4067, 3813, 3704, 3392, 3774, 3796]`.

Guest `elapsedMs`: 3317–4093. Bytes searched (rg stats): 1,517,761,326. Submatches: 653,480.

### Unpruned

| side | process invocations | matched lines | files with matches | files searched | stdout bytes | median ms | min ms | max ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rg `--stats --quiet` | 1 | 502,963 | 57,403 | 127,178 | 187 | **3745** | 3695 | 3921 |
| `search.count` | 1 | 502,963 | 57,403 | — | 706 | **3781** | 3668 | 3865 |

Timed ms: rg `[3856, 3921, 3714, 3695, 3716, 3745, 3801]`; codemode `[3865, 3747, 3668, 3853, 3741, 3800, 3781]`.

Bytes searched (rg stats): 1,517,761,328.

**Count mismatch, explained.** Match totals are equal. Files *searched* differ by **one**: unpruned sees

`<devroot>/codex/152_antigravity/_legacy/upstream-vscode/extensions/css-language-features/server/test/linksTestFixtures/node_modules/foo/package.json`

which default gitignore did **not** hide (it is a test fixture named `node_modules` inside a searched tree) and which `excludeGlobs: node_modules` **does** hide. That file contains no `function`, so matched-line and file-with-match totals stay 502,963 / 57,403.

On this Developer tree, gitignore already drops the heavy `node_modules` directories, so pruned vs unpruned is almost the same walk. That is a property of this root, not a general claim about `excludeGlobs`. A home-directory walk is a different measurement ([exclude-pruning-260918.md](../exclude-pruning-260918.md)).

`search.count` reports `complete: false`, `truncated: false` on every run. The completeness flag is lowered by the skipped-symlink scan: 1 directory symlink (`kim_wiki`) plus 4 file symlinks, scan `capped: true` at 4,000 entries. Ripgrep does not follow those links either; it just does not spend the extra walk or set a completeness bit.

**W2: approximately tied; ripgrep still slightly ahead on median** (pruned ≈ 1.04×, unpruned ≈ 1.01×). Codemode's extra work here is parsing `--json` match events in JS, the capped symlink scan, and node startup. Node startup is a small fraction of a ~3.7 s walk. Output bytes: rg's stats block is 187 B; codemode's count envelope is 706–827 B. Both are small enough to put in an LLM context; the product difference is the envelope, not a row dump.

## W3. File listing

All `**/*.md` under `<devroot>`. Timed cells use `search.files({ max: 1_000_000 })` so the default 5,000-row cap does not fire.

### Pruned

| side | process invocations | paths | stdout bytes | median ms | min ms | max ms |
|---|---:|---:|---:|---:|---:|---:|
| rg `--files -g '**/*.md'` | 1 | 19,690 / 19,690 / 19,690 | 1,865,946 | **189.0** | 186.8 | 190.3 |
| `search.files` max=1e6 | 1 | 19,690 / 19,690 / 19,690 | 1,906,065 | **297.7** | 293.8 | 307.4 |

Timed ms: rg `[189.1, 187.0, 189.7, 189.0, 186.8, 190.3, 188.9]`; codemode `[298.9, 297.6, 307.4, 293.8, 298.5, 297.7, 297.0]`.

Guest `elapsedMs`: 230–241.

### Unpruned

| side | process invocations | paths | stdout bytes | median ms | min ms | max ms |
|---|---:|---:|---:|---:|---:|---:|
| rg `--files -g '**/*.md'` | 1 | 19,690 | 1,865,946 | **184.6** | 181.7 | 190.9 |
| `search.files` max=1e6 | 1 | 19,690 | 1,905,944 | **287.1** | 279.2 | 294.8 |

Timed ms: rg `[190.9, 181.7, 186.3, 182.4, 184.6, 183.8, 185.2]`; codemode `[287.9, 294.8, 279.2, 283.3, 281.4, 290.3, 287.1]`.

Counts match. The extra ~40 KiB on the codemode side is the JSON envelope (`rows` + `scope` + completeness fields), not extra paths.

`complete: false` for the same skipped-directory-symlink reason as W2 (`kim_wiki`), with the scan again capped at 4,000 entries. `truncated: false`.

### Default cap (probe, not in the N=7 table)

One extra pair with **default** `search.files` (no `max`, so `searchCaps.files = 5000`) against uncapped `rg --files`:

| side | paths | truncated | stdout bytes | wall ms (1 run) |
|---|---:|---|---:|---:|
| rg uncapped | 19,690 | n/a | 1,865,946 | 369 |
| `search.files` default max | 5,000 | true | 461,684 | 182 |

A caller that does not raise `max` is **not doing the same work**. Codemode is then faster and silently incomplete unless the caller reads `truncated` / `complete`. The N=7 table above is the aligned comparison (full 19,690 paths).

**W3: ripgrep is faster** at the full listing (median ≈ **1.56–1.58×**). Output bytes are in the same ballpark once both sides return every path. The default 5,000 cap is a real product behaviour and would make an unaligned “codemode is faster” sentence false.

## W4. Search-then-read composite

Find files containing `TODO` under `<repo>`, read the first 3 matching files, return total byte count.

Process-invocation accounting (the honest comparison this workload exists for):

| side | outer processes timed | inner process invocations | what they are |
|---|---:|---:|---|
| rg | 1 (`bash -lc`) | **4** | `rg -l --sort path` + 3× `wc -c` |
| codemode | 1 (`node … --code-file`) | 1 node CLI; internally 1 rg plus in-process `fs.read` / `fs.stat` | guest sorts unique hit paths and reads the first 3 |

An earlier pass **without** `--sort path` showed rg's first-3 set was not stable across runs on this tree (README.md / README.ko.md / AGENTS.codemode.md / SKILL.md permuting, and totalBytes jumping between 50,781 / 76,548 / 81,874). That is rg walk order, not a count bug. The timed table below **sorts paths on both sides** so the three files are the same work. Unsorted walk-order instability is a real caveat for “first N” composites and is not hidden.

Both sides then read, every timed run:

1. `<repo>/README.ko.md`
2. `<repo>/README.md`
3. `<repo>/templates/AGENTS.codemode.md`

`search.content` hit rows: 12 every run. Total bytes: **76,548** every run on both sides.

### Pruned

| side | inner process invocations | total bytes of first 3 | stdout bytes | median ms | min ms | max ms |
|---|---:|---:|---:|---:|---:|---:|
| rg + 3× `wc -c` | 4 | 76,548 | 204 | **30.9** | 29.6 | 32.5 |
| codemode | 1 CLI | 76,548 | 399 | **96.1** | 94.8 | 97.2 |

Timed ms: rg `[31.1, 30.9, 29.6, 32.5, 31.5, 30.7, 30.1]`; codemode `[95.9, 94.8, 95.7, 97.2, 96.4, 96.3, 96.1]`.

Guest `elapsedMs`: 35–38.

### Unpruned

| side | inner process invocations | total bytes of first 3 | stdout bytes | median ms | min ms | max ms |
|---|---:|---:|---:|---:|---:|---:|
| rg + 3× `wc -c` | 4 | 76,548 | 204 | **30.2** | 29.1 | 32.9 |
| codemode | 1 CLI | 76,548 | 399 | **93.7** | 91.3 | 124.3 |

Timed ms: rg `[29.9, 30.1, 29.1, 32.5, 30.2, 32.9, 31.2]`; codemode `[92.9, 91.3, 94.8, 93.3, 96.0, 124.3, 93.7]`. One 124 ms guest run is the max; median is still 93.7.

**W4: ripgrep is faster on wall-clock** (median ≈ **3.1×**). Codemode uses **one** CLI process instead of four; that is the invocation win, not a time win, on a tree this small. Stdout is a tiny summary on both sides (rg prints `TOTAL`/`FILES`/`DETAIL`; codemode returns JSON `{totalBytes, files, hitRows, …}`).

## Across workloads (pruned medians)

| workload | rg median ms | codemode median ms | ratio (cm / rg) | counts | who is faster |
|---|---:|---:|---:|---|---|
| W1 scoped content | 16.7 | 93.8 | 5.6× | 287 = 287 | rg |
| W2 large count | 3637 | 3796 | 1.04× | 502,963 = 502,963 matched lines | rg, barely |
| W3 md listing (uncapped) | 189.0 | 297.7 | 1.58× | 19,690 = 19,690 | rg |
| W4 search then read 3 | 30.9 | 96.1 | 3.1× | 76,548 = 76,548 bytes | rg wall-clock; cm fewer processes |

Unpruned ratios are the same story (5.6× / 1.01× / 1.56× / 3.1×).

## What this does and does not show

Does show, on this machine, this tree, this day:

- Ripgrep wins the aligned comparison on every workload. The large count is close. The small searches are not: node CLI startup is larger than the search itself.
- Result counts can be made equal when the caller raises `max` and compares matched lines to `search.count.matches`. They are **not** equal if you compare rg submatches (653,480) to `search.count` (502,963), or default-capped `search.files` (5,000) to `rg --files` (19,690).
- `excludeGlobs` barely moved `<devroot>` because gitignore already hides the heavy directories. The only extra unpruned path was a test-fixture `node_modules/foo/package.json`. Do not cite this run as evidence that pruning is cheap or expensive in general.
- Output bytes for a **count** or a **three-file summary** are small on both sides. Output bytes for a **full listing** are ~1.9 MB either way; the JSON envelope adds tens of kilobytes, not a different order of magnitude. Output bytes for a **full content dump** (W1) are ~27% higher as JSON than as rg lines.
- Codemode's `complete: false` on Developer-wide walks is a skipped directory symlink (`kim_wiki`) plus a capped symlink scan, not a missed match in the counts we compared.

Does not show:

- A 51× (or any other large) speedup versus ripgrep. That operator figure was `find`+`grep` on a development folder ([dev-folder-51x.md](../dev-folder-51x.md)), a different baseline.
- Cold-cache behaviour. Warm-up was discarded; the filesystem cache was hot.
- Another OS, another disk, another root (`$HOME`, a monorepo with unignored `node_modules`, a network FS).
- MCP / Aside-turn overhead, model time, or “one tool card vs N `read_file` cards.” This is local CLI vs local rg.
- What happens at the default 64 KiB `maxResultBytes` (W3 JSON would truncate) or the default `searchCaps.files = 5000` (W3 would be a different, incomplete job).
- Statistical significance in the inference sense. N=7 on one host. Min/max are reported so the spread is visible; W2's range is hundreds of milliseconds on both sides.
- That `search.count` is implemented as `rg --count`. It is implemented as `rg --json` plus a JS tally, which is why it can stay close to `--stats` on a large tree and still lose to `--stats` by the cost of parsing every match event.

If a later write-up needs a single sentence: **on this host, wrapping ripgrep in the codemode CLI does not beat ripgrep on wall-clock for aligned search work; it adds node startup and a JSON envelope, which dominate small jobs and nearly vanish on a multi-second count.**
