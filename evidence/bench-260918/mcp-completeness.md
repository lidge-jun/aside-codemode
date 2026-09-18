# Completeness signal on the MCP path

Date: 2026-09-18T03:58:25+09:00. Host: one macOS machine (Darwin 27.0.0 arm64). aside-codemode 0.8.1. ripgrep 15.2.0 (`<aside-home>/runtime/bin/rg`). Node v26.5.0.

Transport: resident MCP `execute_code` guest (`mcp__aside-codemode__execute_code`). Guest `search.content` returns a bare array; completeness metadata is non-enumerable. Every cell below was read via `JSON.parse(JSON.stringify(result))`, which yields `{rows, complete, truncated, partial, scope}`. Direct property access (`result.complete`) matches the envelope.

This re-verifies the CLI false-assurance finding in `completeness.md` on the product path. Protocol: `PROTOCOL.md` claims C6 (`complete: false` fires when a search is cut short) and C7 (`complete: true` means every matching file was returned).

**Verdict: C7 is falsified on MCP. C6 holds. The CLI finding is confirmed, not a CLI serialization artifact.**

## Fixture

Recreated immediately before the run with `make-completeness-fixture.sh`.

- Sentinel: `ZQXJ_SENTINEL_7741` (one line per file).
- Absent-control: `ZQXJ_ABSENT_0000_NEVER`.
- Root: `<tmp>/completeness-fixture`
- Corpus: `.../completeness-fixture/corpus` (no symlink door). Ground truth **15** files.
- Symlink target: `.../tmp/completeness-symlink-target` (3 files, outside the fixture, inside a configured root).
- On disk: **18**.

Buckets inside `corpus/`: visible 8, gitignored `ignored-dir/` 3, hidden `.secret/` 2, `node_modules/` (excludeGlobs, not gitignored) 2.

## 1. Reproduction of the six configurations (MCP)

Path = `corpus/`. Ground truth 15. Three runs each. Counts, `complete`, `truncated`, `partial`, and `skippedSymlinks.dirs` were identical across the three trials in every cell.

| # | config | found/15 | `complete` | `truncated` | `partial` | `skippedSymlinks` | verdict |
|---|---|---:|---|---|---|---|---|
| 1 | `search.content` defaults | **8** | **true** | false | `[]` | dirs 0, files 0, examples `[]`, capped false, scanned 17 | **FALSE ASSURANCE** |
| 2 | `noIgnore: true, hidden: true` | **13** | **true** | false | `[]` | dirs 0, scanned 20 | **FALSE ASSURANCE** |
| 3 | + `includeExcluded: true` | **15** | true | false | `[]` | dirs 0, scanned 23 | honest full |
| 4 | defaults + `max: 2` | **2** | **false** | **true** | `[]` | dirs 0, scanned 17 | honest cap |
| 5 | `rg` defaults | **10** | (none) | — | exit 0, empty stderr | — | silent miss |
| 6 | `rg --no-ignore --hidden` | **15** | (none) | — | exit 0, empty stderr | — | honest full |

Breakdown of what each miss set was (unique files):

| config | visible 8 | ignored 3 | hidden 2 | node_modules 2 |
|---|---|---|---|---|
| cm defaults | 8 | 0 | 0 | 0 |
| cm noIgnore+hidden | 8 | 3 | 2 | 0 |
| cm + includeExcluded | 8 | 3 | 2 | 2 |
| cm max=2 | 2 | 0 | 0 | 0 |
| rg defaults | 8 | 0 | 0 | 2 |
| rg --no-ignore --hidden | 8 | 3 | 2 | 2 |

Default ripgrep sees `node_modules` (it is not gitignored). Default codemode does not, because host `excludeGlobs` injects `-g '!node_modules'`. `noIgnore` + `hidden` is not enough to recover those two files; `includeExcluded: true` is a third independent switch. Completeness does not mention that third switch.

Config 4 files recovered on this host were `visible/v4.txt` and `visible/v5.txt` (walk order is not part of the contract).

C6 holds: `max: 2` flips `complete` to false and `truncated` to true on every trial.

C7 does not hold: default MCP search returns 8 of 15 and `complete: true`.

## 2. Negative control

Query `ZQXJ_ABSENT_0000_NEVER` (exists nowhere).

| path | flags | found | `complete` | signal |
|---|---|---:|---|---|
| corpus/ | defaults | 0 | **true** | truncated false, partial `[]`, dirs 0, scanned 17 |
| corpus/ | noIgnore+hidden+includeExcluded | 0 | **true** | dirs 0, scanned 23, excludeGlobs `[]` |
| corpus/visible/ | defaults | 0 | **true** | dirs 0 |
| symlink-target/ | defaults | 0 | **true** | dirs 0 |
| sym-area/ | defaults | 0 | **false** | dirs 1, example = `…/sym-area/link-door` |
| fixture root | defaults | 0 | **false** | dirs 1 (the door) |
| fixture root | all-flags | 0 | **false** | dirs 1 (the door) |

`complete` is not stuck on true or false. An honest empty search of a tree with no skipped directory returns `complete: true` and zero rows. That is why corpus defaults (8 rows, `complete: true`) cannot be dismissed as "the flag never goes true" or "the flag never goes false". It discriminates. It discriminates the wrong thing: walk-finished, not files-found.

ripgrep's negative control on corpus is exit 1, empty stderr — the same code it uses for the symlink-door search that missed three real files.

## 3. Per-mechanism boundary

Each concealment was tested **alone** on `corpus/` by recovering the other two policy axes, so a `complete: true` cannot be blamed on a second hide. Three runs each; identical.

| mechanism | how isolated | files hidden | found/15 | `complete` | `truncated` | scope field that hints | reported? |
|---|---|---:|---:|---|---|---|---|
| `.gitignore` | `hidden: true, includeExcluded: true, noIgnore: false` | 3 (`ignored-dir/`) | 12 | **true** | false | `noIgnore: false`. `excludeGlobs: []`. scanned 23 (same as full recovery). **No skip count.** | **silent** |
| hidden dotfile | `noIgnore: true, includeExcluded: true, hidden: false` | 2 (`.secret/`) | 13 | **true** | false | `hidden: false`. scanned 20 vs 23. **No skip count.** | **silent** |
| `excludeGlobs` | `noIgnore: true, hidden: true, includeExcluded: false` | 2 (`node_modules/`) | 13 | **true** | false | `includeExcluded: false` **and** `excludeGlobs` contains `"node_modules"`. scanned 20 vs 23. **No skip count.** | **silent** (policy echoed, miss not counted) |
| max cap | all-recover flags + `max: 2` | 13 (cap) | 2 | **false** | **true** | `truncated: true`, `max: 2` | **reported** |
| symlinked dir | path = `sym-area/` (door only) | 3 behind the door | 0 | **false** | false | `skippedSymlinks.dirs: 1`, `examples: ["…/sym-area/link-door"]` | **reported** |

Control: all three recovery flags on corpus found 15/15, `complete: true`, scanned 23.

Direct-path check (concealment as the search *root*, not a descendant): searching `ignored-dir/`, `.secret/`, or `node_modules/` as the path itself found every file in that directory even with defaults (`complete: true`). ripgrep and the exclude-glob `-g '!node_modules'` do not hide an explicit search root. Concealment only applies when the hidden content is a **descendant** of the search path.

Symlink door on the fixture root (not isolated from other hides, included for C6): defaults found 8, `complete: false`, dirs 1. All-flags found 15 of 18, `complete: false`, dirs 1. The `false` is about the door. Direct search of the real target found 3/3, `complete: true`; `max: 2` found 2, `complete: false`, `truncated: true`.

`followSymlinks: true` was not tested. The host rejects it with `ENOTSUP`.

## 4. Would any field let a careful caller detect the silent misses?

Envelope keys after `JSON.parse(JSON.stringify(result))`: `rows`, `complete`, `truncated`, `partial`, `scope`.

Guest live object own keys on the default corpus search: `0`–`7`, `length`, `truncated`, `partial`, `complete`, `scope`, `toJSON`. Enumerable keys are only the row indices. There is no other top-level field.

### Full `scope` object, default corpus search (verbatim)

```json
{
  "kind": "content",
  "path": "<tmp>/completeness-fixture/corpus",
  "query": "ZQXJ_SENTINEL_7741",
  "ignoreCase": false,
  "fixedStrings": false,
  "wordRegexp": false,
  "multiline": false,
  "timeoutMs": 30000,
  "max": 500,
  "noIgnore": false,
  "hidden": false,
  "followSymlinks": false,
  "includeExcluded": false,
  "excludeGlobs": [
    "Library",
    "node_modules",
    ".Trash",
    ".cache",
    ".npm",
    ".gradle",
    "Caches",
    "chrome-debug-profile*",
    "Pictures",
    "Movies",
    "Music"
  ],
  "skippedSymlinks": {
    "dirs": 0,
    "files": 0,
    "examples": [],
    "capped": false,
    "scanned": 17
  }
}
```

`scope` keys, in order: `kind`, `path`, `query`, `ignoreCase`, `fixedStrings`, `wordRegexp`, `multiline`, `timeoutMs`, `max`, `noIgnore`, `hidden`, `followSymlinks`, `includeExcluded`, `excludeGlobs`, `skippedSymlinks`.

`skippedSymlinks` keys: `dirs`, `files`, `examples`, `capped`, `scanned`.

`buildScope` (`src/search-schema.js` 367–403) is an echo of the **requested policy**, plus the symlink census. When `includeExcluded` is true it zeroes `excludeGlobs` to `[]` rather than listing what was opted back in.

### What a careful caller can and cannot see

| hide | present in envelope? | what it actually tells you |
|---|---|---|
| gitignore applied | `scope.noIgnore === false` | Policy was on. Not whether it hid any matching file, nor how many, nor which. There is no gitignore-pattern list and no skip count. |
| hidden skipped | `scope.hidden === false` | Same: policy echo only. |
| excludeGlobs applied | `scope.includeExcluded === false` **and** `scope.excludeGlobs` lists `node_modules` | Strongest of the three: the actual glob list is in the envelope. Still no "this glob hid N hits" count. |
| truncation | `complete: false` and `truncated: true` | Honest, in the field people check. |
| skipped dir symlink | `complete: false` and `skippedSymlinks.dirs > 0` plus `examples` | Honest, in the field people check. |
| whether any ignore/exclude/hidden miss happened | **nothing** | `skippedSymlinks.scanned` is a symlink-census size (17 / 20 / 23), not a miss flag. Gitignore-alone still reports scanned 23 — the same number as the 15/15 recovery — because `scanSkippedSymlinks` is not passed `noIgnore`. |

**Classification of the defect:** this is **not** "no signal anywhere in the result". A caller who inspects `scope` can see that gitignore, hidden, and excludeGlobs **policy** were in force. It **is** "signal not surfaced in the field people check": `complete` stays true. It is also "no outcome signal": nothing in the envelope says those rules actually dropped matching files.

So:

- `complete: true` on a default search is a **false assurance** if the caller reads it as "every matching file under this path was returned".
- `complete: true` is an **honest walk-finished bit** if the caller already knows to AND it with `noIgnore && hidden && includeExcluded && skippedSymlinks.dirs === 0 && !truncated`.
- Agents check `complete`. They do not reliably AND three policy flags. That is the bug that is worth filing.

## 5. Where `complete` is derived

The prior pass said `!truncated && partial.length === 0 && !killedBySignal`. That is **incomplete**. The live derivation also folds in skipped **directory** symlinks.

Search results pass an explicit `complete` into `decorateSearchResult`. The runner computes it here:

```227:232:src/rg.js
function completeness({ truncated, partial, killedBySignal, skippedSymlinks = null }) {
  return !truncated
    && partial.length === 0
    && !killedBySignal
    && !symlinkSkipLowersCompleteness(skippedSymlinks);
}
```

Comment immediately above (lines 225–226): "A search is only complete when nothing was cut short, nothing was unreadable and nothing killed the process from outside." The comment does not mention ignore/hidden/excludeGlobs, and the function does not consult them.

The symlink clause:

```105:107:src/symlink-scan.js
export function symlinkSkipLowersCompleteness(skipped) {
  return Boolean(skipped) && skipped.dirs > 0;
}
```

File-link skips and a capped census do **not** lower `complete` (documented in the same file, lines 94–104).

Fallback inside the decorator, used only when the runner does not pass `complete`:

```63:65:src/search-result.js
  const complete = typeof metadata.complete === 'boolean'
    ? metadata.complete
    : !truncated && partial.length === 0;
```

On the MCP search path the runner always passes `complete`, so lines 63–65 are not what a `search.content` call uses. The authoritative formula for this tool is `src/rg.js` 227–232.

Exact meaning, restated from the code: `complete === !truncated && partial.length === 0 && !killedBySignal && !(skippedSymlinks && skippedSymlinks.dirs > 0)`.

That is "the walk you asked for finished". It is not "every file under this path that contains the query was returned".

## 6. Recommendation

**Confirmed, not refuted.** Default MCP `search.content` on this fixture returns 8/15 with `complete: true`. `noIgnore+hidden` returns 13/15 with `complete: true`. Only adding `includeExcluded: true` reaches 15/15. Truncation and a skipped directory symlink do flip `complete` to false. Negative control on corpus is 0 rows, `complete: true`.

Honest fix: **(b) add a new explicit field.** Do not reuse `complete` for policy hides, and do not stop at documentation.

Why not (a) — make `complete` false when ignore/exclude/hidden skipped anything:

- `complete` currently means walk-finished. Truncation, unreadable paths, SIGKILL, and skipped directory symlinks are walk failures. `.gitignore`, default-hidden, and `excludeGlobs` are **requested policy**. Mixing them would make `complete: false` on almost every real git working tree, including the cases the caller asked to prune.
- The code already refuses to lower `complete` for a capped symlink census for this reason (`symlink-scan.js` 102–104: a result that called itself incomplete on every large tree would be ignored within a day). The same fate waits for a `complete` that fires on every `.gitignore`.
- Counting "files the policy hid that would have matched" needs a second unrestricted walk. Flipping the bit without a count still would not tell the caller what was missing.

Why not (c) — documentation only:

- `completeness.md` already documented the CLI false assurance. MCP reproduces it. The field agents check is still `complete`.
- The policy echo in `scope` is real but opt-in knowledge. A guest that returns `hits.length` or a `.map()` already drops even the truncation and symlink signals that work.

What (b) should be:

- Keep `complete` as walk-finished (`rg.js` 227–232).
- Add a second boolean the wire already serializes, named so it cannot be read as walk-finished. `exhaustive` (or `unfiltered`) is false unless `noIgnore && hidden && includeExcluded` and `complete` is true. That is cheap: it is a function of flags already in `scope`, no second walk.
- Optionally later, a skip census (`skippedByPolicy`) if a cheap one exists. Do not block the boolean on that.

That turns the current "AND three flags yourself, after you know to look in `scope`" trap into a field that sits next to `complete`. Callers who want "may I treat zero rows as absence?" check `exhaustive`. Callers who want "did the walk finish?" keep `complete`. Documentation should follow the field, not replace it.
