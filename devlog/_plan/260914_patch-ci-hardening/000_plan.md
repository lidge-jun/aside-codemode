# Patch contract, 51x evidence, CI, and MIT license

Independent re-evaluation of `8223264` raised the product to “search/read trial use” but blocked general auto-edit on one defect: `apply_patch` still does substring `indexOf`. This unit locks a dependency-ordered roadmap that turns that finding into line-based patches, honest helper search, a runnable 51x companion, and ship hygiene (MIT LICENSE + Actions). Implementation starts only after this docs cycle closes.

Who reads: the next executor and reviewer on local `dev`. They decide whether each later PABCD can start from these decade docs without rediscovering the tree.

## Loop spec

- Archetype: satisfy-spec (C4, HOTL, docs-first then five implementation cycles).
- Trigger: user `/loop` after the 8223264 re-evaluation; authorized work is `dev` branch + CI + MIT LICENSE + hardening; unlimited subagents; no push.
- Goal: line-based `apply_patch` (refuse `foobar`/`-foo`, delete lines, preserve EOL), `fs.grepFile` completeness aligned with `search.content`, documented ripgrep glob precedence, independently runnable 51x companion that does not weaken the operator 55s/1s lead, SPDX MIT LICENSE in the npm pack, GitHub Actions on Node 18/20/22 with `rg` + `npm test`.
- Non-goals: origin push, merge to `main`, npm publish, new runtime dependencies, new agent/API layers, sandbox/worker timeout redesign, copying openai/codex Apache-2.0 as this package’s license, claiming a synthetic bench *is* the operator 51x pair, Linux product install recipes.
- Verifier: `npm test` (`package.json` → `node --test "test/*.test.js"`). Preflight 2026-09-14: exit 0, 208 pass / 0 fail / 30324 ms; the glob includes every planned `test/*.test.js`. Conditional paths name activation below. LICENSE/CI also use `npm pack --dry-run`.
- Stop: all six work-phases done; criteria `c-1`…`c-4` have capturedEvidence; `crc loop validate` green; local `dev` ready for the user to review/push.
- Memory: this folder; `.codexclaw/goalplans/bring-aside-codemode-repo-lidge-jun-aside-codemo/`; evidence stays under `evidence/` or `.codexclaw/evidence/`.
- Terminal outcomes: DONE = contracts + evidence + LICENSE/CI verified on `dev`. BLOCKED = missing `rg`/node/git. UNSAFE = ignore/root loosened or non-MIT license. NEEDS_HUMAN = only if the user later wants Apache instead of MIT. BUDGET_EXHAUSTED = only on a later user-stated bound.
- Escalation: no new credentials, no push, no new deps. Main reclaims a slice after two distinct agent failures. Architect/reviewer do not own the FSM.
- HOTL bounds: write this checkout only; local commits on `dev` with `[agent]` prefix; no push; wall-clock this conversation; unlimited subagents as authorized.

## Current tree (compact)

```
README.md / README.ko.md     public SoT (51x lead, search, patch)
package.json                 MIT, files[] without LICENSE, test glob
src/host/patch.js            parse + apply_patch factory
src/host/fs.js               edit_file indexOf; grepFile silent max
src/host/globals.js          wires apply_patch → edit_file
src/search-result.js         decorateSearchResult envelope
src/search-schema.js         glob/max validation for search.*
src/tools.js                 GUEST_API_DOC
src/child-opts.js            rgChildOpts (issue #5)
templates/AGENTS.codemode.md register prompt
evidence/dev-folder-51x.md   operator 55s/1s note
eval/compare.mjs             recorded-event compare (not a folder bench)
test/*.test.js               208 tests; some phrase/string locks
```

No `.github/workflows/`, no `LICENSE`, no `package-lock.json`, zero runtime deps.

## Source of truth (SOT-SYNC-01)

Public SoT is `README.md` + `README.ko.md` + `templates/AGENTS.codemode.md`. Each implementation cycle patches those files in C when the guest contract or 51x evidence story changes. This unit reuses `devlog/_plan/` numbering; it does not create a new `docs/` tree.

## Dependency-ordered work-phases (PHASE-SPLIT-01)

Foundations (mutation/search contracts) → evidence → delivery → polish. Not effort buckets.

| Phase | Doc | Builds on | Independently verifiable |
| --- | --- | --- | --- |
| WP0 docs-only | this file + 001 + 010–050 | nothing | files exist at diff-level; A audit |
| WP1 patch | `010_phase1_patch.md` | WP0 | foobar fails; delete-beta no blank; CRLF context succeeds and keeps `\r\n` |
| WP2 search helper | `020_phase2_search.md` | WP0 (same `decorateSearchResult`) | grepFile envelope + invalid max throw; glob docs |
| WP3 51x | `030_phase3_51x.md` | WP0 | `eval/bench-search.mjs` repeats + equality; README lead unchanged |
| WP4 LICENSE+CI | `040_phase4_ci_license.md` | WP1–WP3 tests exist | LICENSE in pack; workflow present; local `npm test` |
| WP5 hardening | `050_phase5_hardening.md` | WP1–WP2 | spawn-option / bench self-check tests, not only string locks |

PR stack: one local `dev` branch. User did not opt into GitHub native stacks (DEV-STACK-OPT-IN-01).

## Decisions (main; D3/D4 architect ALIGNED; A PASS 2026-09-14)

| ID | Choice | Rejected | Contract |
| --- | --- | --- | --- |
| D1 | Public `edit_file` stays unique-substring. `apply_patch` uses internal `lineMatch: true` (same opt-in style as `eof`). | Making all `edit_file` calls line-based. | Guest `edit_file({oldText,newText})` unchanged. |
| D2 | Extract `src/host/line-edit.js` for split/match/join. `fs.js` is already 338 lines. `fs.js` does **not** import `search-schema.js` (architect). | Inlining ~80 lines into `fs.js`; `fs`→`search-schema` coupling. | Internal only. |
| D3 | Parse with `split(/\r?\n/)`; emit `{oldLines,newLines,oldText,newText,atEof,ops}` where `ops` is `keep`/`del`/`add` in patch order. `newLines: []` deletes; `['']` is one empty line. | Join-only; inferring alignment from arrays only. | `apply_patch` is line-accurate and EOL-aligns after insert/delete. |
| D4 | Untouched spans stay byte-for-byte. Reconstruction walks `ops`, not array index: `keep` uses that old record’s EOL; `del` consumes an old record and emits nothing; `add` after `del` uses the **deleted** record’s EOL (replace); a bare `add` uses the next old record’s EOL (or the previous if at end). Unterminated tail stays unterminated. | One `blockEol`; positional `start+j`; always giving `add` the next survivor’s EOL. | Mixed-EOL replace/delete/insert keep each line’s own EOL. |
| D5 | `grepFile` decorated with `decorateSearchResult`; one extra match after `max`. Integer checks **inlined** in `fs.js` (same rules as `positiveInt`/`nonNegativeInt`). `actions.check` value-validates `fs.grepFile` max/context via existing `checkOptionValue`. | `fs` importing `search-schema`; `{hits,truncated}` return. | Array + envelope, like search. |
| D6 | Document ripgrep glob-over-ignore; do not change rg flags. | Implementing `--weakglobs`. | Docs only. |
| D7 | Keep README 55s/1s/51x. Companion at `eval/bench-search.mjs` (not the operator pair). | Softening the title or calling the companion “the 51x bench”. | Operator pair stays. |
| D8 | SPDX MIT, `Copyright (c) 2026 lidge-jun`. Codex is Apache-2.0; do not copy it. Holder is GitHub owner (NEEDS_HUMAN if wrong). | Copying Codex Apache; switching `package.json` off MIT. | Matches `"license": "MIT"`. |
| D9 | Actions include: ubuntu Node 18/20/22 + macos 22 + windows 22; apt/brew/choco; `npm test`; `npm pack --dry-run`. No `npm ci`. No README `## Linux`/`apt`. | Full 3×3 matrix; taiki-e cargo-binstall. | CI-only Linux. |
| D10 | Widen RPC restore from `search.*` to also `fs.grepFile` (`sandbox.js:110`). Keep grep `context` as a string. | `{before,after}` context. | Guest `.length` + wire envelope. |
| D11 | `@@` stays a heading. Multi-hunk still applies against the **original** snapshot. | Unified-diff line numbers. | `test/write-hardening.test.js:366-419` stay valid. |

## Measured baseline (this session)

| Case | Result | Owner |
| --- | --- | --- |
| `doc.txt` = `foobar`; hunk `-foo`/`+bar` | `ok:true`, file `barbar` | `patch.js:71` → `fs.js:296` |
| `alpha\nbeta\ngamma\n`; `-beta` only | `alpha\n\ngamma\n` | same |
| CRLF file + context ` alpha` / `-beta` / `+BETA` | `oldText not found: alpha\nbeta`; file unchanged | `patch.js:71,25` + `fs.js:296` |
| CRLF file + single-line `-beta` | succeeds (`beta` is a substring without `\n`) | shows the eval case needs a context/newline in `oldText` |
| `grepFile(max:1)` | one row; no `truncated`/`complete`; `JSON.stringify` is a bare array | `fs.js:100-144` |
| `grepFile(max:-1)` | `[]`, no throw | `hits.length < max` is false |
| `npm test` | 208/208 exit 0 | `package.json:11` |

## Conditional paths (C-ACTIVATION-GROUNDING-01)

| Path | Activate | Observe |
| --- | --- | --- |
| Line match miss | foobar / `-foo` | throw; file unchanged |
| Line delete | `-beta` on `alpha\nbeta\ngamma\n` | `alpha\ngamma\n` |
| CRLF context | CRLF file + space context + replace | success; `\r\n` preserved |
| Ambiguous lines | two `dup` lines, no EOF | `/not unique/`; file unchanged |
| EOF last line | two `dup`, `*** End of File` | last line replaced |
| grep max | three-line file, `max:1` | length 1, `.truncated===true`, `.complete===false` |
| grep invalid max | `max:-1` / `0` / `1.5` | throw, not `[]` |
| glob docs | read README/schema/AGENTS | glob-vs-ignore sentence present |
| LICENSE pack | `npm pack --dry-run` | `LICENSE` listed |
| CI file | open workflow | Node 18/20/22 + rg install + `npm test` |

## Enforcement / bypass (PLAN-BYPASS-NAMED-01)

| Layer | Surface | Bypass | Residual | Wording |
| --- | --- | --- | --- | --- |
| Tests | `npm test` locally / Actions | skip file, or not pushing `dev` | string-lock tests can still pass while behavior is wrong — WP5 tightens | early warning until WP5 |
| CI | GitHub Actions after push | user never pushes; workflow_dispatch unused | local `dev` has no remote CI proof this session | early warning; local `npm test` is the completion gate |
| LICENSE | `files[]` + pack dry-run | omit from `files[]` | pack would ship without LICENSE | test in WP4 |
| Final layer | none that cannot be skipped without push | — | user push is ESCALATE | do not claim CI enforces until the user publishes `dev` |

## Necessity (DEV-NECESSITY-01)

- Do nothing: rejected — foobar/`ok:true` is a real silent wrong edit.
- Delete `apply_patch`: rejected — it is the agent edit surface.
- Configure only: rejected — no flag makes `indexOf` line-accurate.
- Reuse: reuse `decorateSearchResult`, `withFileLock`, `rgChildOpts`, `eval/make-corpus.mjs` patterns. New: `line-edit.js`, bench script, LICENSE, workflow.

## PR / git

Local commits on `dev` during B, `[agent]` prefix. No push.

## Attestation log

- 2026-09-14 P (WP0): roadmap written at this folder. Architect [proposal](00d848f1-a1c3-4ed3-b72d-b73fa693f26b) then **ALIGNED** reflection. Residuals 1–3/5 folded (mixed-EOL wording, `--dir`/`notOperator51x`, eval not in npm files, IN-line validators). Explorer [caller map](fbc49e80-4102-4a45-be3d-cc6dda8bba37) folded as D10 RPC restore. Independent A reviewer dispatched.
- 2026-09-14 A FAIL ([reviewer](89f47e7b-fb3f-436b-87f7-a19d28d7418b)): `npm test` 208/208 exit 0 (reviewer-run, 30244 ms). Five High blockers synthesized below; all accepted and folded. D4 execution flow changed → same architect reflection, then same reviewer re-audit.
- 2026-09-14 architect reflection on D4 ([architect](00d848f1-a1c3-4ed3-b72d-b73fa693f26b)): first **ALIGNED** (blockEol→per-line), then **MISALIGNED** on ops `add` after `del` (test 8 would take gamma CRLF). Folded: `add` after `del` uses deleted record EOL. Re-reflection: **ALIGNED**. Residual: multi-insert on unterminated tail follows `reconstructFromOps` as written.

## A FAIL synthesis (REVIEW-SYNTHESIS-01)

Reviewer ran `npm test` (208 pass, exit 0) and verified Codex Apache-2.0 + SPDX MIT + ripgrep#1808. Verdict **FAIL**.

| # | Root cause | Conflicts | Decision |
| --- | --- | --- | --- |
| 1 | `applyLineEdits` used one `blockEol` for every reconstructed line, so a mixed-EOL hunk (context+change) would rewrite context EOLs. That fights D4 “mixed EOL does not rewrite”. | Against 000 D4 and 010:24. | **Accept.** Per-line EOL from `records[start+j]`; add mixed-EOL regression. D4 updated (architect recheck). |
| 2 | WP5 still only greps source for `windowsHide`. Dead `rgChildOpts()` at a call site would still pass. | Against 050 goal “not string locks”. | **Accept.** Extract injectable `spawnRg`/`execFileRg`; test the wrapper with a stub spawn; call sites must use those helpers. |
| 3 | WP3 left baseline as Node-walk **or** per-file grep **or** `grep -R`. WP4 left the README license line optional. | DIFFLEVEL-ROADMAP-01. | **Accept.** Lock baseline to `grep -R -n -- query root` when `grep` exists, else labeled `node-walk`. Always add the LICENSE footer sentence. |
| 4 | `actions.check` is patched but no test calls `check('fs.grepFile', …)`. Runtime throw ≠ discovery agreement. | PLAN-VERIFIER-REAL-01. | **Accept.** Assert `check` returns `ok:false` + `invalid` for bad max/context. |
| 5 | `npm pack --dry-run` via bare `npm` is a `.cmd` shim on Windows (`src/rg.js:31-34`). | Windows CI matrix. | **Accept.** Spawn `process.execPath` + npm-cli.js (no `.cmd`). |

Residuals kept: phrase locks as copy locks; operator 51x folder unreproducible; `--glob` is not `-uuu` (wording tightened in 020); remote Actions until push.

## A FAIL #2 synthesis (same reviewer)

| # | Root cause | Decision |
| --- | --- | --- |
| 1 | `start+j` maps `newLines[1]` to `beta` after deleting `beta` from `[alpha,beta,gamma]→[alpha,gamma]`. | **Accept.** Parser emits `ops`; `reconstructFromOps` walks keep/del/add. D3/D4 updated. Tests 9–10. |
| 2 | `promisify(execFileRg)` treats `env` as the callback. | **Accept.** `execFileRg` returns a Promise itself. No `promisify`. Stub test for `execFileRg`. |
| 3 | Companion evidence prose still said `find`+`grep` after locking `grep -R`. | **Accept.** Evidence + 030 prose say `grep -R` (or labeled `node-walk`). Operator table may still mention find historically. |
| 4 | `createHostActions` does not exist; export is `createActions` (`src/host/actions.js:149`). | **Accept.** Exact import in 020. |
| 5 | Pack snippet used `repoRoot` undefined. | **Accept.** Define via `fileURLToPath(import.meta.url)`. |

## A FAIL #3 synthesis (LOOP-REPAIR-01: third FAIL)

No A→P edge exists while the goal blocks Interview. Plan is amended in place (the “changed plan”); same reviewer re-audits once more. A fourth FAIL → `orchestrate reset` and a new P for WP0.

| # | Root cause | Decision |
| --- | --- | --- |
| 1 | After `max`, `return pendingAfter.length > 0` is `false` when `context===0`, so `eachLine` stops on the first gap and a later match is reported `complete:true`. | **Accept.** Keep scanning until extra match or EOF. Test 5b: `hit / gap / hit`. Not a D-table change (D5 unchanged). |
