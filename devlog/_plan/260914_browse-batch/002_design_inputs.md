# 002 — Design inputs: wiring seams and module layout

Research doc. No diffs here; each decade doc owns its own diffs.
Sources: an architect pass (decisions A1-A9) and three explorer passes over this tree.

## Module layout (A1, accepted)

`src/host/browse/` — `browse.js` (guest factory), `schema.js` (option/capability SSOT),
`result.js` (envelope builder), `session.js` (the ONLY spawn+deadline+parse path),
`script.js` (REPL source compiler), `probe.js` (capability matrix + doctor payload),
`pool.js` (leases and cancel ownership), `cache.js` (file-backed TTL), `fetch-first.js`,
`adapters.js`, `policy.js` (breaker, waits, recipes, block detect), `extract.js`, `image.js`.

`src/host/report/` — `report.js`, `html.js`, `pdf.js`, `pagebox.js`.

No `index.js` barrels: host callers import concrete files, matching `./search.js`.
Report depends on browse `session`; browse never imports report.

## Guest-namespace wiring — every one of these or the namespace is invisible

| File | Required change |
| --- | --- |
| `src/host/globals.js:8` | add `browse:`/`report:` to the returned object; pass `signal` through |
| `src/sandbox.js:7` | append `'browse'`, `'report'` to `ROOTS`; `hostMethods` only walks ONE level, so `browse.tab.open` can never register |
| `src/execution-worker.js:50` | pre-create and freeze `injected.browse`/`injected.report`; otherwise `injected[root][method] =` throws while building stubs |
| `src/host/actions.js:11` | splice `BROWSE_ACTIONS`/`REPORT_ACTIONS` into `REGISTRY`, the way `SEARCH_ACTIONS` is spliced from `src/search-schema.js:159` |
| `src/tools.js:7` | one `GUEST_API_DOC` bullet per namespace; `inputSchema` stays `{code,timeoutMs}` |

`actions.*` is a separate synchronous `Atomics.wait` channel and the parent rejects any sync
name not starting with `actions.` (`src/sandbox.js:88`). Browse must stay on the async lane.

## RPC boundary facts

Transport is `worker_threads` structured clone, not JSON: plain objects, arrays, TypedArray,
Map/Set, RegExp, Date all survive; functions and `AbortSignal` do not. Structured clone drops
non-enumerable properties and never calls `toJSON`, which is why search results take a special
`toJSON()`/`restoreSearchResult` lane flagged by `msg.search` (`src/sandbox.js:110`).
**Browse must not join that lane** — its envelope is a plain enumerable object so metadata
survives without teaching the worker another special case.

The final guest return value goes through a second JSON-only pass (`stringifyResult`), then
`fitEnvelope` trims to `maxResultBytes` (96 B .. 16 MiB, default 65536): logs first, then the
result body. Per-item failures must therefore live inside `items[]`, never only in logs, or a
budget trim can silently convert a partial batch into a clean-looking list.

In-flight guest RPC cap is 256 (`src/execution-worker.js:7`).

## Cancellation seam

`runCode` owns one `AbortController` per execution and hands `controller.signal` to the
globals factory (`src/sandbox.js:32`). It is aborted by the MCP `notifications/cancelled`
path, by stdin close, by the `timeoutMs` watchdog, and by every `finish()` including success.
Host work that ignores the signal keeps running for `HOST_DRAIN_MS` (1000 ms) and is then
reported as `pendingHostCalls` / `sideEffectsMayContinue`. The CLI does **not** currently pass
an outer signal into `runCode` (`src/cli.js:93`); only the sandbox deadline applies there.
Cancel code is `ECANCELLED`; the kill pattern to copy is `src/rg-stream.js:64-92`.

## Config and CLI seams

`src/config.js` has no schema — `DEFAULTS` plus a hand-written copier in `apply()`. A new key
that is not copied there is silently dropped, and unknown top-level JSON keys are ignored
(unlike guest search options, which reject unknown keys). Nested objects follow the
`searchCaps` field-wise pattern at `src/config.js:109`. Env overrides are applied last and
always win; there is no nested env convention, so browse needs flat `CODEMODE_*` names.
Also update `codemode.config.example.json` and `src/register.js` if defaults should be seeded.

`src/cli.js` parses argv by `indexOf`; unknown flags are ignored, so a bare `--browse` falls
through to usage/exit 2. `--doctor` is gated **after** `loadConfig`, `resolveCwd` and
`makeRootGuard`, so it never prints when every root is missing. If browse diagnostics must
work on a broken-root machine, that branch has to move above the root guard.

## Test conventions that new tests must obey

`npm test` runs `scripts/run-tests.mjs`, which enumerates `test/*.test.js` itself because
Node 18/20 and Windows shells do not expand quoted globs. Zero dependencies; no `npm ci`.
CI matrix is Ubuntu 18/20/22, macOS 22, Windows 22 with real ripgrep installed, `fail-fast:false`.

Rules: `node:test` + `node:assert/strict`; fixtures under `mkdtempSync(path.join(tmpdir(),...))`;
compare paths with `realpathSync.native` (Windows 8.3 short names); derive drive roots from
`path.parse(...).root`, never a hardcoded `/` or `C:\`; no POSIX mode assertions on win32;
no network, no `shell:true`, no `/bin/sh` without a Windows guard.

**Timing is banned as a correctness oracle** (`test/write-hardening.test.js:4-7`): settle races
with `fork()` IPC ready/go handshakes. Child processes are faked by injection —
`createRgProcessFns({spawnImpl, execFileImpl})` (`src/child-opts.js:13`) is the pattern the
Aside spawn must copy so `npm test` never launches a browser. Live Aside checks go behind an
explicit env flag, never in CI.
