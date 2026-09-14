# 000 — Browse batch layer: plan and work-phase map

Unit: `devlog/_plan/260914_browse-batch/`. Closes #6-#23.
Prior D conclusion this plan resumes from: dev was published green at `3b566e7` with the
browsing features left as an unimplemented roadmap. This unit implements them.

## Loop spec (HOTL bounds)

| Bound | Value |
| --- | --- |
| Mode | HOTL, goal-backed, 7 work-phases (wp1 docs-only .. wp7 release) |
| Write scope | `src/host/browse/**`, `src/host/report/**`, `src/host/globals.js`, `src/sandbox.js`, `src/execution-worker.js`, `src/host/actions.js`, `src/config.js`, `src/cli.js`, `src/child-opts.js`, `src/tools.js`, `test/**`, `templates/`, `README*.md`, `devlog/_plan/260914_browse-batch/**`, `evidence/**`, `package.json`, `codemode.config.example.json` |
| Out of scope | file/search core semantics, the `node:vm` trust model, new npm dependencies, a bundled browser engine, `~/.aside` settings or credentials, any other repository |
| Tool/credential scope | local git + `gh` for this repo, local `npm test`, local `aside.exe repl`. No account creation, no secrets committed |
| External writes | push to `origin/dev` per phase, merge to `main` in wp7 — both explicitly authorized by the user |
| Wall-clock bound | none stated by the user; report `BUDGET_EXHAUSTED` only against a stated bound |

## Constraints locked by measurement

Full evidence: [001_probe_evidence.md](001_probe_evidence.md). The four that change the design:

1. `page.route` does not exist and `p.on('request')` delivers zero events. Resource blocking
   (half of #11) is **not implementable** on this surface and is split out, not faked.
2. `screenshot.maxWidth` is silently ignored and the viewport is not settable. Only `clip`
   controls geometry, so #12 must post-process host-side or refuse.
3. `pdf({format:'A4'})` silently produces US Letter. #22 must verify the real MediaBox.
4. A killed CLI leaks its tabs permanently and no later session can close them. Cancellation
   must be deadline-driven and script-owned, never kill-first.

## Architecture decision (resolves the A/B question in #23)

#23 offered **A** an opt-in `browse` host module in codemode reaching a browser via
`cdpUrl|playwright`, or **B** leave codemode file-only and hand the ideas to Aside as a spec.

**Decision: A-shaped surface, B-shaped engine.** codemode gains opt-in `browse.*` / `report.*`
host globals exactly as A describes, but their engine is the Aside REPL CLI rather than a
Playwright/CDP connection. Pure B closes no issue in this repo and ships nothing verifiable;
pure A requires a browser dependency the repo has refused since day one. The measured
Aside REPL is a real, already-installed execution surface that satisfies A's contract.

Accepted architect decisions A1, A2, A3, A4, A6, A8, A9 as proposed.
**Amended A5 and A7**: the architect assumed "process death is tab death" and made SIGKILL the
cancel primitive. E5 falsifies that. Amendment: the **in-script deadline fires first and the
host deadline is the outer backstop** (host = inner + slack), so the script's `finally` closes
its own tabs and the CLI exits cleanly under its own timer instead of being killed. Kill is a
last resort that MUST surface `partial` plus the leaked URLs.

Ordering, stated once so it cannot be read backwards: `inner script deadline < host process
deadline`. The host must be the more patient of the two. An earlier draft of this document and
of 001 said the opposite; 010 and 020 implement the correct order.

Unresolved assumptions returned by the architect, now resolved by measurement:
argv shape (1) confirmed `['repl', script]`; in-script multi-page (2) confirmed, 5 pages in
one script; orphan tabs (3) confirmed to survive a kill, forcing the A5/A7 amendment;
MediaBox parsing (6) confirmed plaintext, an in-repo parser suffices. Host `fetch` (4) is
guaranteed by `engines.node >=18`. Image transcode (5) is decided in 030. Items 7-12 keep
the architect's stated defaults.

## Work-phase map (dependency order, not effort order)

| Phase | Doc | Issues | Independently verifiable at close |
| --- | --- | --- | --- |
| wp2 foundations | [010](010_phase2_foundations.md) | #20, #23 decision | `--doctor --browse` prints the capability matrix; session contract unit-tested with a fake child |
| wp3 resilience | [020](020_phase3_resilience.md) | #17, #21 | block detection and circuit breaker unit-tested against fixture stdout |
| wp4 core batch | [030](030_phase4_batch.md) | #6, #12, #8 | `captureMany` returns per-item results with requested-vs-actual scope |
| wp5 extraction/report | [040](040_phase5_extract_report.md) | #18, #10, #14, #11, #22 | `report.build` fails an item whose MediaBox is not the requested box |
| wp6 repetition | [050](050_phase6_repetition.md) | #19, #13, #15, #7, #9, #16 | shared cache honours its key and TTL across two processes |
| wp7 release | [060](060_phase7_release.md) | closes #23 | `origin/main` contains the dev head, green CI, global install runs `--doctor` |

Each phase closes with `npm test` green plus a pushed `origin/dev` whose CI run is green on
all five combos. Phase boundaries follow the build order: execution contract first, then the
policies that guard it, then the features that use it, then the ones that cache them.

## Verifiers (PLAN-VERIFIER-REAL-01 — run before being written here)

| Command | Exit | Observes this unit's target? |
| --- | --- | --- |
| `npm test` | 0 (see note) | yes — `scripts/run-tests.mjs` enumerates every `test/*.test.js`, so new browse tests are included automatically |
| `node --test test/search-boundary.test.js` | 0, 3/3 runs | yes, for the cancel seam the browse session reuses |
| `gh run list --repo lidge-jun/aside-codemode` | 0 | yes — run `34801531821` on `3b566e7` is `completed/success`, the green baseline this unit must preserve |
| `node bin/codemode.mjs --doctor` | 0/1 by rg | yes — wp2 extends this exact object |

Note on `npm test` — a pre-existing defect found while establishing this baseline.
`test/search-boundary.test.js:46` ("cancelling an active stream kills its child instead of
waiting for the rg deadline") fails **consistently** in the full suite on this Windows host
(2 of 2 clean runs) and **passes 3 of 3** when the file is run alone. It asserts that
cancellation wins a race against a 300 ms `rg` deadline; under `node --test` file-level
concurrency the deadline fires first and the assertion sees `RgFailedError: rg timed out`
instead of `ECANCELLED`.

This uses elapsed time as a correctness oracle, which this repo's own test convention forbids
(`test/write-hardening.test.js:4-7`: races are settled with `fork()` IPC ready/go handshakes,
"never on elapsed time"). CI is green on `windows-latest` only because that runner happens to
win the race. It is a latent portability bug, not a machine quirk, and the browse session
reuses this exact cancel seam — so it is folded into wp2 as task t8 rather than left to
resurface as a mystery red run mid-loop.

Until it is fixed, the authoritative gate is the hosted CI run, and a local red on this one
test must be confirmed by an isolated re-run before being treated as a new regression.

## SoT sync target (SOT-SYNC-01)

This repo has no architecture INDEX doc. The source of truth for the guest contract is the
`README.md` / `README.ko.md` Guest API table plus `GUEST_API_DOC` in `src/tools.js` and the
`actions` REGISTRY. Every phase that adds a guest-visible name patches all three in its own C,
and `templates/AGENTS.codemode.md` when the agent recipe changes.

## Issue-to-phase index

#6 wp4 · #7 wp6 · #8 wp4 · #9 wp6 · #10 wp5 · #11 wp5 (wait strategy only; blocking refused)
· #12 wp4 · #13 wp6 · #14 wp5 · #15 wp6 · #16 wp6 · #17 wp3 · #18 wp5 · #19 wp6 · #20 wp2
· #21 wp3 · #22 wp5 · #23 wp7.
