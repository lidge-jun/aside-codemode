# Review hardening and honest performance positioning

This unit repairs the runtime, search, and file-mutation defects reproduced against d1fa638, then updates both READMEs with the requested “make aside 50x faster” hook and an immediately visible distinction between batching ambition and measured wall-clock performance. Existing CLI-first installation and Aside-shaped file APIs remain the product surface.

## Loop spec

- Archetype: satisfy-spec; repair correctness before measuring batching.
- Trigger: user requested fixes, commits, repository update, README hook, and `$loop` under codexclaw rules.
- Goal: watchdog-bounded guest execution, preserved search completeness, consistent root policy, coordinated writes, supported multi-hunk patches, trustworthy evidence and documentation.
- Non-goals: modify Aside/codexclaw, parent repository changes, account/config installation, dependency additions, npm publication, force-push, hostile-code sandbox certification, or an invented 50x end-to-end result.
- Verifiers: existing `npm test` (package script reads test/*.test.js importing src); targeted new node:test regressions; actual CLI stdout JSON checks; npm package dry-run; source syntax checks; remote HEAD after authorized update. Baseline execution evidence is captured separately before production edits.
- Stop: all scoped repairs verified, independent diff review resolved, focused commits created, local commit verified and user-requested remote update published by normal fast-forward push. Disclose unsupported environments and workflow capabilities.
- Memory: this numbered unit, sanitized evidence/ review-hardening report, private raw execution logs outside the checkout.
- Outcomes: DONE for verified code/update; BLOCKED for actual transport/push refusal; NEEDS_HUMAN for untested Windows or unavailable native loop setup. No time/token limit was supplied; tool processes receive per-invocation watchdogs, not a goal-completion time budget.
- Escalation: no dependency/config/permission expansion; main reclaims delegated work after two distinct failures. Main alone integrates and commits. Unrelated work remains untouched.

## Runtime preflight limitation (not a fabricated loop)

`cxc session current` and `cxc session bind` both report CODEX_THREAD_ID absent and hooksVerified:false. Native tool inventory exposes neither spawn_agent nor create_goal. Do not borrow the previous session, substitute cli, alter CODEX_THREAD_ID, or edit FSM bytes. Formal HOTL/Stop continuation and native architect consultation are NOT armed. Per runtime-lifecycle.md, continue the independently authorized code changes and retain this limitation. Aside exec is explicitly user-authorized for independent leaf work; it is not presented as a native architect or formal FSM audit.

## Current structure / source of truth

```
README.md / README.ko.md              public CLI/API/install/trust contract
bin/codemode.mjs -> src/cli.js         one-shot execution
src/tools.js -> src/sandbox.js        shared runCode API, MCP consumer
src/server.js                        future-only MCP integration
src/rg.js -> src/host/search.js        search adapter and options
src/host/fs.js / patch.js             guarded file operations
src/paths.js / config.js              roots and configuration
src/host/actions.js                   guest discovery catalog
src/register.js / templates/          registration and prompt template
```

## Dependency-ordered slices and write ownership

| Slice | Document | Exact scope | Proof |
| --- | --- | --- | --- |
| Roadmap | 000/001 | This docs-only plan before edits, independent design review | Actual review output, recorded dispositions |
| Runtime | 010 | sandbox.js + focused execution/serialization modules; cli.js/tools.js/server.js integration; config numeric validation; test/runtime-hardening.test.js | async loop and serialization-loop watchdogs; Unicode/log/error/escape-aware output budget; CLI/MCP parity; no leaked timers |
| Search | 020 | rg.js, host/search.js, host/actions.js, shared search schema/result helpers, paths.js; test/search-hardening.test.js | metadata survives wire; context; count partial; symlink rejection before spawning rg; option parity; root filesystem guard |
| Mutation | 030 | host/fs.js, host/patch.js, focused locking/read modules; test/write-hardening.test.js | same-file concurrent edits across processes; lock failure/no clobber; multi-hunk and EOF; partial apply details; bounded reads |
| Integration/docs | 040 | READMEs, templates, tools descriptions, eval/compare.mjs, focused eval regression tests, evidence | full original and new suites; independent review; actual CLI scenarios; Git remote identity |

Slices with disjoint source ownership may use scoped Aside leaf executors in the same checkout. No leaf commits, switches branches, changes .codexclaw, registers tools, spawns children, installs dependencies or touches other lanes. Main owns the public integration points and resolves interface changes before delegation.

## Design decisions / alternatives

D1: Isolate CPU-bound guest evaluation and result serialization under a supervisor outside the guest event loop. Keep runCode signature usable by tests with injected host closures. Reject merely adding Promise.race because event-loop starvation defeats it. Choose the smallest viable worker/RPC approach or isolated CLI child only if the internal contract is also covered; native actions discovery remains synchronous. No hostile-code security claim.
D2: Preserve array ergonomics inside guest code; make search metadata explicitly serializable through a shared result helper and preserve it across any worker RPC. Existing plain-array consumers remain source compatible, while direct JSON projection has an intentional documented envelope. Do not attach metadata that disappears through stringify/structuredClone.
D3: Reject followSymlinks:true before search until a safely guarded traversal is implemented. Clear error is safer than reading outside then filtering. Default traversal remains unchanged. Root prefix check uses path.relative for '/' and drive roots.
D4: Serialize cooperating writers on canonical path with an exclusive, cross-process lock; acquire before reading original and hold through commit. Atomic replacement alone is rejected: it does not prevent lost updates. Never auto-steal a live/unknown lock. Fail closed with actionable stale-lock information. Document noncooperating editors, hard links, and crash residuals.
D5: Keep apply_patch Add/Update and successful {} contract; support repeated @@ sections and conventional EOF markers. Parse/validate the entire patch first. No all-files rollback promise; failed application reports applied files and failed target without hiding prior writes.
D6: UTF-8/result/log caps apply at actual wire serialization; include escape expansion and error payloads. Invalid settings are errors. A small configured payload budget cannot hold an arbitrarily rich envelope; document minimum/overhead explicitly instead of falsely guaranteeing tiny total packets.
D7: README hook is exactly “make aside 50x faster”. The first following paragraph says 50x is a batching goal (50 round trips to one), not measured end-to-end speed. Preserve published benchmark results and limitations. Do not invent timings or imply an acceleration demonstrated by a synthetic delay is production evidence.

## Threat and residuals

Assets are files under configured roots, task responsiveness, and truthful search/output state. Entrypoints are CLI --code, config/env, file paths and patches. Agent-generated JS shares the trust level of an agent that already has shell; it is not hostile input containment. Root checks, writer locks and watchdogs protect accidents among cooperating APIs. Native shell, noncooperating editors, hard-link aliases, OS/filesystem failures and externally killed processes remain outside those guarantees. Temporary fixtures contain only synthetic data.

## Completion ledger

Planning recorded before any production edits. Runtime preflight failure is preserved; no native PABCD completion claim is permitted.

## Delivery conclusion (2026-09-13)

The authorized implementation and local commit scope is complete. The final production/test source at47b9829 was verified by a fresh `npm test`:196 passed,0 failed,0 cancelled,0 skipped. HEAD and source SHA-256 values were unchanged across that run. Syntax checks passed for49 JS/MJS files. Package dry-run included34 files, all worker/search/file helpers, and no private .codexclaw state. The sanitized durable proof is evidence/review-hardening-20260913.json; raw agent transcripts and execution logs remain outside the checkout.

Independent reviews covered the runtime and search/file integration. A broad runtime review was stopped when it did not converge and is not counted as PASS; the bounded replacement returned PASS after17 runtime tests and byte-cap/RPC probes. The search/file reviewer accepted the repaired scope with a low-severity internal window-validation finding subsequently fixed and regression-tested. No global security certification or 50x wall-clock improvement was established.

Formal native HOTL/Stop continuation remains unavailable: no CODEX_THREAD_ID or host goal capability. No historical session or FSM was reused. The current request for committed fixes and an update to the named GitHub repository authorizes normal remote publication. origin/main was updated by a fast-forward push and independently read back at067ef167e61993f0af96064c943f380dbaa172b6. Windows remains untested; trusted-agent, synchronous-host, temp-lock-directory and external-editor residuals remain documented. No npm publication, global registration or parent-repository mutation was performed.
