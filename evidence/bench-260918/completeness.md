# Does completeness metadata catch silent misses?

Date: 2026-09-18. Host: one macOS machine. aside-codemode 0.8.1. ripgrep 15.2.0 (`<aside-home>/runtime/bin/rg`). Node v26.5.0.

Produced by `evidence/bench-260918/make-completeness-fixture.sh` then three deterministic runs of each search configuration through `node bin/codemode.mjs --code '…; return r.toJSON()'` and the same ripgrep binary the host resolves. Raw JSON: session tmp `completeness-bench-raw.json` (written 2026-09-18T03:31:47Z). An independent MCP `search.content` call on the same corpus reproduced the default-search envelope.

The question is not whether ignore rules hide files. They do, on purpose. The question is whether `complete: true` is ever returned when files that physically exist under the search path were not returned. That would be a **false assurance**: the caller is told the answer is finished, and it is not.

## Headline

**False assurance found.** On a tree with no symlink door, default `search.content` returned 8 of 15 sentinel files and `complete: true`. The seven misses were exactly the files this fixture was built to hide: gitignored, hidden, and `excludeGlobs` (`node_modules`). The same call with `noIgnore: true, hidden: true` still missed the two `node_modules` files and still returned `complete: true`.

`complete` flags truncation and skipped *directory* symlinks. It does **not** flag gitignore, hidden, or configured exclude-glob pruning. Those three are silent.

ripgrep reports nothing at all for the same misses: exit 0, empty stderr.

## Fixture

Built under the session tmp directory so this repository's own `.gitignore` cannot pollute the walk. A throwaway `git init` exists only so ripgrep will honour the fixture `.gitignore` (rg ignores `.gitignore` files that are not inside a git work tree). The inventory file is stored *outside* the search tree, with the sentinel string split, so the manifest cannot become a hit.

Sentinel: `ZQXJ_SENTINEL_7741` (one line per file). Absent-control string: `ZQXJ_ABSENT_0000_NEVER`.

```
completeness-fixture/
|-- .git/                          (throwaway repo; no sentinel in objects)
|-- .gitignore                     (contains: corpus/ignored-dir/)
|-- README.md                      (no sentinel)
|-- corpus/
|   |-- visible/                   (a) eight hits, v1.txt … v8.txt
|   |   `-- README.md              (no sentinel)
|   |-- ignored-dir/               (b) three hits, gitignored
|   |   |-- ign1.txt
|   |   |-- ign2.txt
|   |   `-- nested/ign3.txt
|   |-- .secret/                   (c) two hits, dot-directory
|   |   |-- hid1.txt
|   |   `-- nested/hid2.txt
|   `-- node_modules/pkg/          (excludeGlobs axis) two hits, NOT gitignored
|       |-- nm1.txt
|       `-- nm2.txt
`-- sym-area/
    `-- link-door -> …/completeness-symlink-target

completeness-symlink-target/       (d) three hits, outside the fixture, inside <home>
|-- link1.txt
|-- link2.txt
`-- nested/link3.txt
```

`.git` is omitted from the tree above; a `--no-ignore --hidden` walk of `.git` found **zero** sentinel files, so git objects are not inflating counts.

## Ground truth

Every count is unique files containing the sentinel, enumerated by walking the real directories without following the symlink door, then walking the target separately.

| bucket | files | concealment |
|---|---:|---|
| (a) visible | 8 | none |
| (b) gitignored (`corpus/ignored-dir/`) | 3 | fixture `.gitignore` |
| (c) hidden (`corpus/.secret/`) | 2 | default ripgrep skips dot-directories |
| excludeGlobs (`corpus/node_modules/`) | 2 | host `excludeGlobs` (`node_modules`); **not** gitignored |
| (d) behind symlink door | 3 | policy: links are never followed |
| **corpus, no follow** | **15** | 8+3+2+2 |
| **on disk** | **18** | 15 + 3 behind the door |

`git check-ignore -v` confirmed only `corpus/ignored-dir/` is gitignored. `node_modules` and `.secret` are not. `rg --follow --no-ignore --hidden` from the fixture root found all 18; without `--follow` it found 15. So the three linked files exist, are inside a configured root, and are reachable only by following the door.

Two search roots were measured so one concealment cannot mask another:

- **corpus/** — no symlink. This is the load-bearing test of whether `complete` reports gitignore / hidden / excludeGlobs misses.
- **fixture root** and **sym-area/** — include the door. These test whether skipped directory links lower `complete`.

## Results: corpus/ (no symlink)

Ground truth for this path: **15 files**. Three runs, identical every time.

| config | found | missed | `complete` | other signal | verdict |
|---|---:|---:|---|---|---|
| 1. `search.content` defaults | 8 | 7 | **true** | `truncated: false`, `partial: []`, `skippedSymlinks.dirs: 0` | **FALSE ASSURANCE** |
| 2. `noIgnore: true, hidden: true` | 13 | 2 | **true** | same, dirs 0 | **FALSE ASSURANCE** |
| 3. + `includeExcluded: true` | 15 | 0 | true | dirs 0 | honest full |
| 4. defaults + `max: 2` | 2 | 13 | **false** | `truncated: true` | honest cap |
| 5. `rg` defaults | 10 | 5 | (none) | exit 0, empty stderr | silent miss |
| 6. `rg --no-ignore --hidden` | 15 | 0 | (none) | exit 0, empty stderr | honest full |

Breakdown of what each miss set was:

| config | visible 8 | ignored 3 | hidden 2 | node_modules 2 |
|---|---|---|---|---|
| cm defaults | 8 | 0 | 0 | 0 |
| cm noIgnore+hidden | 8 | 3 | 2 | 0 |
| cm + includeExcluded | 8 | 3 | 2 | 2 |
| cm max=2 | 2 | 0 | 0 | 0 |
| rg defaults | 8 | 0 | 0 | 2 |
| rg --no-ignore --hidden | 8 | 3 | 2 | 2 |

Default ripgrep sees `node_modules` (it is not gitignored). Default codemode does not, because `excludeGlobs` injects `-g '!node_modules'`. Turning on `noIgnore` and `hidden` is not enough to recover those two files; `includeExcluded: true` is a third, independent switch. Completeness does not mention that third switch.

MCP `execute_code` on the same corpus with defaults: 8 rows, `complete: true`, `truncated: false`, `partial: []`, `skippedSymlinks.dirs: 0`. Same false assurance as the CLI, not a CLI serialization artifact.

`scope.skippedSymlinks.scanned` did move (17 on defaults, 20 with hidden, 23 with includeExcluded). That is a census size, not a miss flag. `complete` stayed true.

## Results: fixture root (symlink door present)

Ground truth on disk: **18**. A non-following walk of this path can see at most the 15 in-tree files; the other 3 sit behind `sym-area/link-door`.

| config | found | missed vs 18 | `complete` | signal |
|---|---:|---:|---|---|
| cm defaults | 8 | 10 | **false** | `skippedSymlinks.dirs: 1` (the door). Still also missing gitignore/hidden/excludeGlobs, which this flag does not name. |
| cm noIgnore+hidden | 13 | 5 | false | dirs 1; still missing the 2 `node_modules` files and the 3 behind the door |
| cm + includeExcluded | 15 | 3 | false | dirs 1; the remaining 3 are behind the door |
| cm max=2 | 2 | 16 | false | `truncated: true` **and** dirs 1 |
| rg defaults | 10 | 8 | (none) | exit 0, empty stderr |
| rg --no-ignore --hidden | 15 | 3 | (none) | exit 0, empty stderr |

This table is why the corpus isolation matters. Searching the fixture root always returns `complete: false` because of the door, which would have **hidden** the gitignore/hidden/excludeGlobs false-assurance if it had been the only search path. The `false` here is about the symlink, not about the seven ignore-hidden files.

## Results: symlink door only (`sym-area/`)

Ground truth behind the door: **3**. The search path itself contains no regular files.

| config | found | `complete` | signal |
|---|---:|---|---|
| every codemode config | 0 | **false** | `skippedSymlinks.dirs: 1`, example = `…/sym-area/link-door` |
| both rg configs | 0 | (none) | **exit 1**, empty stderr |

Codemode is honest here: zero rows plus `complete: false` plus a named skipped directory. ripgrep's exit 1 is the same code it uses for "this string does not exist anywhere". A caller cannot tell a skipped door from an honest empty.

Direct search of the real target (`completeness-symlink-target/`): all six configs that are not `max: 2` found 3/3. Codemode `complete: true`. `max: 2` found 2, `complete: false`, `truncated: true`. So the files are findable when the path is the real directory; the miss is the unfollowed door.

`followSymlinks: true` was not tested. The host rejects it with `ENOTSUP`.

## Negative control

Query `ZQXJ_ABSENT_0000_NEVER` on the same trees.

| path | cm defaults | cm all-flags | rg defaults | rg --no-ignore --hidden |
|---|---|---|---|---|
| corpus/ | 0 rows, **`complete: true`** | 0 rows, `complete: true` | 0 files, exit 1 | 0 files, exit 1 |
| symlink-target/ | 0 rows, `complete: true` | 0 rows, `complete: true` | exit 1 | exit 1 |
| fixture root / sym-area | 0 rows, `complete: false`, dirs 1 | same | exit 1 | exit 1 |

`complete` is not stuck on false. An honest empty search of a tree with no skipped directory returns `complete: true` and zero rows. That is why the corpus default result (8 rows, `complete: true`) cannot be dismissed as "the flag never goes true" or "the flag never goes false". It discriminates. It discriminates the wrong thing: walk-finished, not files-found.

ripgrep's negative control is exit 1 with empty stderr — identical to the symlink-door search that missed three real files.

## Determinism

Every configuration was run three times. File count, `complete`, `truncated`, `partial`, and `skippedSymlinks.dirs` were identical across the three trials in every cell. No fluke, no race.

## What this means

`complete: true` means "the walk you asked for finished": nothing was truncated, stderr had no unreadable-path warnings, the process was not killed, and no *directory* symlink was stepped over. It does **not** mean "every file under this path that contains the query was returned".

The concealment mechanisms this fixture planted are the ones the tool already documents as silent (`noIgnore` "a parent .gitignore can silently hide an entire repo"; `hidden` defaults off; `includeExcluded` opts back into `excludeGlobs`). Completeness metadata does not mention any of them. A caller who treats `complete: true` as permission to stop looking will miss gitignored files, dot-directory files, and anything matching `excludeGlobs`. In this tree that was 7 of 15 files on the default call, and still 2 of 15 after `noIgnore` and `hidden`.

Truncation is the one miss `complete` reliably catches (`max: 2` → `truncated: true`). Skipped directory symlinks are the other (`dirs: 1` → `complete: false`). Both worked on every trial. That is the useful half of the flag. It is also the half that can mask the other misses: put a symlink door in the same tree as a gitignore and the result is `complete: false` for the door, with no record that gitignore hid anything.

ripgrep is worse, not better. Exit 0 with 8, 10, or 15 files looks the same. Exit 1 on the symlink door looks the same as "string not found". There is no completeness bit to misread because there is no completeness bit.

Practical rule from this run: `complete: true` is not evidence of absence unless the call also used `noIgnore: true`, `hidden: true`, and `includeExcluded: true`, the path contains no skipped directory symlink, and `truncated` is false. Even then it is only evidence of absence *under those options*. Default `complete: true` is a false assurance on any tree that uses gitignore, dot-directories, or a name in `excludeGlobs`.

## What this does not claim

- It is one synthetic tree with a unique sentinel. It does not measure how often these concealments appear in a real home directory.
- It does not measure `search.files` or `search.count`. Only `search.content`.
- It does not measure unreadable paths (`partial`), killed-by-signal, NFC/NFD dual walks, or a capped symlink census (`skippedSymlinks.capped`). Those other `complete: false` branches were not exercised.
- `complete: true` after `noIgnore+hidden+includeExcluded` on the corpus is honest for *this* tree. It is not a proof that those three flags recover every possible hide.
- Returning `r.length` or a `.map()` projection still drops the envelope. This run always called `r.toJSON()`. A guest that does not is blind even to the truncation and symlink signals that do work.
- The fixture lives in session tmp and is not part of this repository. Re-run `make-completeness-fixture.sh` before repeating the measurement; the tree is not durable.
