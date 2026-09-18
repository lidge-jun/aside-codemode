# Local search on the MCP path (2026-09-18)

Primary numbers for product claims. Method and environment: [PROTOCOL.md](PROTOCOL.md).
Raw timings: [`mcp-local-search.raw.json`](mcp-local-search.raw.json).

The CLI-path tables in [local-search.md](local-search.md) remain valid as a statement about the CLI. They are not the product numbers. An earlier MCP sketch in [mcp-path.md](mcp-path.md) covered only W1 and W4; this file is the full four-workload rerun.

## Transport comparison

The CLI spawns a node process per call. The MCP server is resident and runs guest code in a worker. Guest-side `Date.now()` around each `search.*` call is the unit here. That is tool time, not transport time and not process startup.

| | median, this machine |
|---|---:|
| empty `node -e ""` (CLI-path note, not remeasured here) | ~40 ms |
| CLI full search (from the superseded CLI pass) | ~100 ms |
| guest-side timer inside that CLI run | 34–39 ms |
| **this pass, MCP guest-side W1** | **12 ms** |

So 60–70 ms of every CLI number was process startup the MCP path does not pay. Reporting CLI wall-clock as tool latency measured the harness.

Round trips below are agent tool calls: one `mcp__aside-codemode__execute_code` versus one `rg` invocation (W4 rg is two: `rg -lF` then `cat`). Bytes into the model are captured stdout for rg and `JSON.stringify` of the guest return value for codemode.

Recorded 2026-09-18, Asia/Seoul. Sequential N=7 after one discarded warm-up; filesystem cache warm. An earlier parallel pass of W2/W3 (MCP and rg overlapping) produced contended outliers and is discarded; the tables use the sequential rerun.

| | |
|---|---|
| Machine | Apple M4 Pro, arm64, 12 cores, 24 GiB |
| OS | macOS 27.0 (26A5353q) |
| Node | v26.5.0 |
| ripgrep | 15.2.0 (`<aside-home>/runtime/bin/rg`) |
| MCP timing | `Date.now()` inside guest |
| rg timing | `python3 time.time_ns()` around `subprocess.run` |

Two alignments, as the protocol requires:

| alignment | codemode | ripgrep |
|---|---|---|
| **pruned** | default `excludeGlobs` | matching `-g '!<glob>'` for each |
| **unpruned** | `includeExcluded: true` | no exclude globs |

On this `<devroot>` tree, gitignore already hides the heavy `node_modules` directories, so pruned vs unpruned counts are almost identical. The only extra unpruned file searched in W2 is a test-fixture `node_modules/foo/package.json` (files searched 127,178 vs 127,177). Match totals stay equal.

## W1. Content search

`search.content({query:'export', path: aside-codemode, glob:'**/*.js', max:100000})`
against `rg --no-config --path-separator=/ -g '**/*.js' export <repo>`.

Same 287 matching lines every timed run, both alignments. `complete: true`, `truncated: false`.

### Pruned

| side | transport | round trips | results | bytes into model | median | min | max |
|---|---|---:|---:|---:|---:|---:|---:|
| ripgrep | process | 1 | 287 | 34,828 | **18.0 ms** | 17.3 | 19.4 |
| codemode | **MCP** | 1 | 287 | 44,071 | **12 ms** | 11 | 14 |

Raw MCP: 12, 14, 11, 12, 11, 13, 13. Raw rg: 18.009, 18.020, 19.075, 17.337, 19.033, 19.441, 17.847.

### Unpruned

| side | transport | round trips | results | bytes into model | median | min | max |
|---|---|---:|---:|---:|---:|---:|---:|
| ripgrep | process | 1 | 287 | 34,828 | **17.9 ms** | 17.2 | 19.2 |
| codemode | **MCP** | 1 | 287 | 43,950 | **11 ms** | 10 | 14 |

Raw MCP: 11, 14, 10, 11, 11, 10, 13. Raw rg: 17.184, 17.827, 17.956, 18.151, 19.179, 17.936, 17.637.

**C1 did not hold as stated.** The claim was that rg wins a single grep. On the MCP path, guest-side search is slightly faster here (12 ms vs 18 ms). The gap is a few milliseconds on a tiny repo, inside `Date.now()` 1 ms quantization on the MCP side. This is not a general “codemode is faster than rg” claim; it is “startup-free, this tree, this day.” Codemode still returns **more bytes** (typed rows plus completeness envelope): 44,071 vs 34,828.

Parent cross-check: parent MCP median 13 ms (12–15), 287, 44,071 bytes; parent rg 16.7 ms, 34,828 bytes. Counts and MCP bytes agree. This pass’s MCP 12 ms (11–14) is within 1 ms of the parent. This pass’s rg 18.0 ms is ~1 ms slower than the parent’s 16.7 ms; same 34,828 byte stdout.

## W2. Content count, large tree

`search.count({query:'function', path:<devroot>})`
against `rg --stats --quiet function <devroot>`.

Comparable count is **matched lines**, not submatches. `search.count` increments once per matching line. rg `--stats` reports 653,480 submatches and 502,963 matched lines every run. Tables use matched lines.

### Pruned

| side | round trips | matched lines | files with matches | bytes into model | median | min | max |
|---|---:|---:|---:|---:|---:|---:|---:|
| rg `--stats --quiet` | 1 | 502,963 | 57,403 | 187 | **3047 ms** | 2727 | 3294 |
| `search.count` MCP | 1 | 502,963 | 57,403 | 778 | **2966 ms** | 2812 | 3591 |

Raw MCP: 2867, 2966, 2812, 3019, 2949, 3327, 3591.
Raw rg: 2726.779, 2944.153, 3062.213, 3293.809, 2969.981, 3163.052, 3046.738.

rg files searched: 127,177. Bytes searched: 1,517,761,326.

### Unpruned

| side | round trips | matched lines | files with matches | bytes into model | median | min | max |
|---|---:|---:|---:|---:|---:|---:|---:|
| rg `--stats --quiet` | 1 | 502,963 | 57,403 | 187 | **3045 ms** | 3009 | 3356 |
| `search.count` MCP | 1 | 502,963 | 57,403 | 657 | **3483 ms** | 3300 | 3845 |

Raw MCP: 3784, 3343, 3845, 3300, 3388, 3483, 3554.
Raw rg: 3019.925, 3112.281, 3016.431, 3008.661, 3045.421, 3356.253, 3158.908.

rg files searched: 127,178. Bytes searched: 1,517,761,328.

Match totals equal. Files *searched* differ by one (the unpruned test-fixture `node_modules` path). That file contains no `function`, so matched-line and file-with-match totals stay 502,963 / 57,403. Cell is valid.

`search.count` reports `complete: false`, `truncated: false` on every run. Completeness is lowered by the skipped-symlink scan (`kim_wiki` directory symlink plus 4 file symlinks, scan capped at 4,000). Ripgrep does not follow those links either; it just does not spend the extra walk or set a completeness bit.

**W2: approximately tied on pruned; rg wins unpruned.** Pruned medians 2966 vs 3047 ms are within run-to-run noise (~3%). Unpruned, rg is ahead (3045 vs 3483 ms, about 1.14×). Codemode’s extra work is parsing `--json` match events in JS plus the capped symlink scan. Output bytes: rg stats block 187 B; count envelope 657–778 B. Both fit in a prompt; the product difference is the envelope, not a row dump.

## W3. File listing

`search.files({path:<devroot>, glob:'**/*.md', max:1000000})`
against `rg --files -g '**/*.md' <devroot>`.

Cap is raised so the default 5,000-row `search.files` limit does not fire. Both sides return 19,690 paths every timed run.

### Pruned

| side | round trips | paths | bytes into model | median | min | max |
|---|---:|---:|---:|---:|---:|---:|
| rg `--files` | 1 | 19,690 | 1,865,946 | **183.5 ms** | 178.5 | 188.5 |
| `search.files` MCP | 1 | 19,690 | 1,900,559 | **188 ms** | 180 | 191 |

Raw MCP: 188, 188, 191, 180, 189, 185, 190.
Raw rg: 183.453, 178.540, 183.272, 185.159, 180.982, 188.517, 184.935.

### Unpruned

| side | round trips | paths | bytes into model | median | min | max |
|---|---:|---:|---:|---:|---:|---:|
| rg `--files` | 1 | 19,690 | 1,865,946 | **188.7 ms** | 178.9 | 200.3 |
| `search.files` MCP | 1 | 19,690 | 1,900,438 | **177 ms** | 175 | 182 |

Raw MCP: 176, 181, 175, 175, 182, 180, 177.
Raw rg: 188.733, 179.518, 191.997, 178.878, 187.115, 199.119, 200.277.

Counts match. Extra ~35 KiB on the codemode side is the JSON envelope (`rows` + `scope` + completeness), not extra paths. `complete: false` for the same skipped-directory-symlink reason as W2; `truncated: false`.

**W3: tied for practical purposes.** Pruned, rg is 5 ms ahead (183.5 vs 188). Unpruned, MCP is 12 ms ahead (177 vs 188.7). Neither gap survives a claim of a clear winner. Bytes are the same order of magnitude (~1.87 MB vs ~1.90 MB). A caller that does **not** raise `max` is not doing the same work: default `search.files` returns 5,000 rows and `truncated: true` against rg’s 19,690. That default-cap contrast is a product behaviour, not this table.

## W4. Search then read then filter

Find `.js` files containing the literal `throw new`, take the first three by path, return filenames and total character count.

Codemode does it in one guest body (`search.content` + `fs.read` of three files) and returns `{files, totalChars}`.
rg is two agent round trips: `rg -lF --sort path -g '**/*.js'` then `cat` of the first three.

Both sides resolve to the same three files and the same content size every timed run:

1. `src/activate.js`
2. `src/config.js`
3. `src/execution-output.js`

Hit files: 44. Hit rows: 212. Total chars of the three files: **36,497**. Cat stdout of those three: 36,511 bytes (UTF-8 vs JS string length).

### Pruned

| side | round trips | wall time | bytes into model |
|---|---:|---:|---:|
| ripgrep + cat | **2** | 16.0 + 2.6 = **18.6 ms** | 2,643 + 36,511 = **39,154** |
| codemode (MCP) | **1** | **12 ms** | **90** |

MCP raw: 13, 12, 12, 12, 11, 13, 10 (median 12, min 10, max 13).
rg list: 15.963, 15.787, 16.426, 16.039, 15.704, 16.029, 17.373.
rg cat: 2.639, 2.495, 2.646, 2.336, 2.652, 2.932, 2.669.

### Unpruned

| side | round trips | wall time | bytes into model |
|---|---:|---:|---:|
| ripgrep + cat | **2** | 17.1 + 2.5 = **19.7 ms** | **39,154** |
| codemode (MCP) | **1** | **11 ms** | **90** |

MCP raw: 12, 11, 10, 10, 11, 10, 11 (median 11, min 10, max 12).
rg list: 16.605, 17.275, 15.739, 17.099, 17.283, 15.963, 17.764.
rg cat: 2.597, 2.430, 2.540, 2.954, 2.504, 2.545, 3.221.

**C2 holds on round trips** (1 vs 2) and this run is also faster in wall time, not merely comparable. The wall-time gap is small (12 vs 19 ms) because the tree is tiny and the cache is hot.

**C3 holds, and this is the largest effect measured.** 90 bytes against 39,154, a factor of **435**. The mechanism is not compression. The shell path puts the file list and the full contents of three files into the transcript, because that is how an agent reads a file. Codemode does the same reads inside the sandbox and returns only the answer.

Parent cross-check: parent MCP 15 ms (13–23), 93 bytes; parent rg 40 + 28 = 68 ms, 39,154 bytes. Counts and rg bytes agree (same three files, same 39,154). Compact JSON here is 90 bytes (`JSON.stringify({files, totalChars})` with no spaces); parent 93 is the same payload with slightly different serialization, not a different answer. **I disagree with the parent’s rg W4 wall time of 68 ms.** Sequential `rg -lF --sort path` on this hot tree is ~16 ms, and `cat` of three already-open files is ~2.6 ms, not 40 + 28. The parent figure should not be copied. MCP 12 ms vs parent 15 ms is the same 1 ms clock plus a quieter machine.

## Across workloads (pruned medians)

| workload | rg median | MCP median | ratio (MCP / rg) | counts | bytes (MCP vs rg) | round trips | who wins |
|---|---:|---:|---:|---|---|---|---|
| W1 scoped content | 18.0 ms | 12 ms | 0.67× | 287 = 287 | 44,071 vs 34,828 | 1 = 1 | MCP time; rg bytes |
| W2 large count | 3047 ms | 2966 ms | 0.97× | 502,963 = 502,963 | 778 vs 187 | 1 = 1 | tie (noise) |
| W3 md listing | 183.5 ms | 188 ms | 1.02× | 19,690 = 19,690 | 1,900,559 vs 1,865,946 | 1 = 1 | rg, barely |
| W4 search then read 3 | 18.6 ms (2 RT) | 12 ms (1 RT) | 0.65× | 36,497 chars = 36,497 | **90 vs 39,154** | **1 vs 2** | MCP RT + bytes |

Unpruned is the same story except W2, where rg is clearly ahead (3045 vs 3483 ms).

## Where codemode loses

Do not overclaim. Cells rg wins, or where the wrapper is the wrong tool:

- **Bytes on a single grep (W1).** For the same 287 lines, MCP returns 44,071 bytes of `{file,line,text}` rows plus a completeness envelope; rg returns 34,828 bytes of text. If the model needs the lines, rg is the cheaper payload. C3 is about *filtered* answers, not about dumping search hits.
- **W3 listing, pruned.** rg median 183.5 ms vs MCP 188 ms. Tiny, but rg is not slower. Both dump ~1.9 MB of paths into the model. Codemode is not a better lister; it is a worse one once you actually return every path.
- **W2 unpruned count.** rg 3045 ms vs MCP 3483 ms. On a half-million-line walk the JS `--json` parse and the symlink scan show up. Reach for `rg --stats --quiet` when the question is a count.
- **Default caps.** This table raises `max` so the work is the same. Default `search.files` (5,000) and default `search.content` (500) are not the same work as uncapped rg. An unaligned “faster” sentence that silently truncated would be false.
- **`complete: false` on Developer-wide walks.** MCP reports incomplete because of a skipped directory symlink, even when the compared match counts equal rg. Treat `complete` as a search-scope flag, not as “fewer hits than rg.”
- **A human one-liner is not two round trips.** Round trips are the agent unit. A person typing `rg -lF … \| head \| xargs cat` pays one shell. The W4 byte win is real for agents; it is not a win against a human pipeline.
- **CLI path still loses badly.** Guest-side MCP time is 12 ms; CLI wall-clock for the same search was ~94 ms. Do not quote CLI numbers as product latency.

## What these numbers do not say

- One machine, warm cache, one repository. Different trees will differ.
- The MCP server must already be running. Server start is paid once per session and is not in these numbers.
- C1 as originally stated (rg faster on a single grep) failed on this MCP pass. That failure is specific to a 287-hit repo search with a resident server. It is not a reason to prefer MCP for every grep.
- Date.now() is 1 ms resolution. W1/W4 MCP values are quantized; do not pretend 12 vs 13 is a measured 8% effect.
