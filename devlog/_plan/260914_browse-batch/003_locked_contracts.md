# 003 — Locked contracts (normative)

**Precedence: this document wins.** Where 010-060 disagree with a rule here, this rule is
correct and the decade doc is stale. Written to close the nine blockers raised by the wp1
independent audit, which returned FAIL because parallel-written phase docs had drifted into
three incompatible `session.run` shapes, clobbering config defaults, and an unlocked spawn model.

## E7 — measurements that settle the previously unlocked APIs

Same harness as [001](001_probe_evidence.md): `aside.exe repl <script>`, CLI `1.26.906.1630`.

| Call | Measured | Consequence |
| --- | --- | --- |
| `await openTab(url)` | returns the **page object itself**: keys `cdp, frameManager, targetId, modifierState, mouse, keyboard, events, browser`; `title`/`goto`/`screenshot` are functions | `tab.page` and `tab.id` are **undefined**. 030 is wrong to use them |
| `page === openTab(...)` result | `true`; the global `page` IS that object | there is no wrapper to unwrap |
| identity field | `targetId` (no `id`) | use `page.targetId` |
| `snapshot(page)` | `{tree,refs,diff}`, tree 245 | canonical |
| `snapshot(page, {interactive:true})` | `{tree,refs,diff}`, tree 289 | canonical with options |
| `snapshot()` | throws `Cannot read properties of undefined (reading 'url')` | no implicit current page |
| `snapshot('<targetId>')` | throws `Cn.url is not a function` | **a string id is not accepted**; 010 is wrong |
| `page.evaluate(fn)` / `page.evaluate(fn, arg)` / `page.evaluate('expr')` | all three work (`got:41` for the arg form) | no conflict; prefer `evaluate(fn, arg)` |
| `page.waitForLoadState('networkidle')` | **accepted**, but Aside prints `this is redundant wait; openTab() already waits for the page to become usable. Falling back to 'stable' with 5s timeout.` | networkidle is silently downgraded |
| `page.waitForLoadState('not-a-state')` | **accepted**, 1 ms, no error | Aside does not validate this argument at all |
| `page.goto(url, {waitUntil:'networkidle'})` | accepted | not proof it waited |
| `page.goto(url, {waitUntil:'zzz'})` | **accepted**, 28 ms | Aside does not validate `waitUntil` either |
| `openTab('file:///.../r.html')` | throws `Cannot navigate to a file URL without local file access.` | **file URLs are refused** |

Two of these change plans rather than confirming them. Aside silently accepts any
`waitUntil` / `waitForLoadState` string, so an unsupported wait value cannot be detected at
runtime — it must be rejected **host-side** in `schema.js` or it becomes a silent no-op. And
the report printer cannot use a `file://` URL at all.

## C1 — the host API (closes audit blocker 2, task t9)

One shape. `session.js` owns compilation; callers never pass source.

```js
// src/host/browse/session.js
createSession({ spawnAside, resolveAside, readFile, stat, now, signal })
  .run(job, { signal }) -> Promise<SessionResult>
```

- `job` is a **validated job object** from `schema.js`, never a string of JavaScript.
- `session.run` calls `compile(job)` from `script.js` internally. No caller compiles.
- Deadlines are computed inside `session.run` by the single exported helper
  **`deadlineMath(job)`** in `script.js`. The name `computeDeadlines` does not exist; 040 must
  import `deadlineMath` from `./script.js`, not from `schema.js`.
- `SessionResult` is `{ ok, items, timings, partial, leakedUrls, raw }` and is handed to
  `result.js` to build the guest envelope. `session.run` never returns raw stdout.

Every later factory **spreads the previous surface**:
`createBrowse(...) -> { ...wp2Methods, ...wp3Methods, ... }`. wp4 must not return a bare
`{ captureMany, screenshot, readText }` and drop wp2's `probe`/`exec`.

## C2 — deadline ordering (closes blocker 5)

`inner script deadline < host process deadline`. The host is the more patient one.
`hostDeadlineMs = innerDeadlineMs + SLACK_MS`. The script must always finish under its own
timer so its `finally` runs and the CLI exits cleanly.

`innerDeadlineMs` is capped at **25000**, below Aside's measured ~30 s internal screenshot
timeout ([001](001_probe_evidence.md) E4). `browseCaps.timeoutMs` default is therefore 25000,
not 30000, and `schema.js` **enforces** the cap instead of only documenting it.

## C3 — merged `browseCaps` and `asidePath` (closes blocker 3, task t10)

This is the ONE after-state for `DEFAULTS` in `src/config.js`. wp3 and wp4 add fields to it;
they never restate it as a smaller object.

```js
asidePath: null,
browseCaps: {
  enabled: false,        // wp2, opt-in
  timeoutMs: 25000,      // wp2, inner cap (C2)
  maxTabs: 8,            // wp2, tabs inside one script
  concurrency: 4,        // wp4, in-script parallelism
  navigateTimeoutMs: 15000,   // wp3
  breakerFailures: 3,         // wp3
  breakerCooldownMs: 30000,   // wp3
  domainTimeouts: {},         // wp3
},
```

`apply()` merges `browseCaps` **field-wise**, exactly like `searchCaps` at `src/config.js:109`.
A phase that replaces the whole object erases the other phases' keys.

## C4 — spawn and batch shape (closes blocker 4, task t11)

`session.js` is the **only** module that may spawn. One `session.run` is one `aside.exe`
process is one repl session.

N URLs are **N tabs inside one compiled script**, bounded by `browseCaps.concurrency`. The
circuit breaker and per-domain waits operate on **items inside that single script**, not by
spawning per item. Any reading of 020 section 3.7 in which `runItem` spawns a process per URL
is rejected: it pays the measured 1.4-2.4 s process overhead per URL and discards the 3397 ms
to 908 ms batching win that justifies this whole unit ([001](001_probe_evidence.md) E1, E6).

## C5 — tab ownership after the inner deadline (closes blocker 6, task t12)

A `Promise.race` that abandons `main()` does not stop an in-flight `openTab`, so a tab opened
after the race still leaks — the exact failure [001](001_probe_evidence.md) E5 says cannot be
repaired from a later session. Required shape in every compiled script:

1. A single `deadline` flag is set before the race resolves; `openTab` is never called when it
   is set.
2. Each `openTab` registers its page in `opened` **before** any await that could be abandoned.
3. Cleanup awaits late-resolving `openTab` promises and closes those pages too, rather than
   only closing what was in `opened` at the instant the race fired.
4. Anything still unclosed is reported in `leakedUrls` with `partial: true`.

Acceptance must include an activation that injects a hanging `openTab` resolving AFTER the
inner deadline and asserts the page is still closed. Grepping the compiled source for
`finally` and `closeTab` does not prove this and does not satisfy the criterion.

## C6 — Aside call forms (closes blocker 7, task t13)

- `const page = await openTab(url)` — the return value **is** the page. Never `tab.page`.
- Identity is `page.targetId`. Never `tab.id`.
- `await snapshot(page)` or `await snapshot(page, { interactive: true })`. Never a string id,
  never no-arg.
- `await page.evaluate(fn, arg)` is the preferred form; the string form also works.
- `waitUntil` and `waitForLoadState` arguments are **validated host-side in `schema.js`**
  against an allowlist, because Aside accepts anything. `networkidle` is accepted by Aside but
  downgraded to `stable` with a 5 s timeout, so it is **not** a network-quiet guarantee: the
  schema rejects it with `ENOTSUP` and directs callers to an explicit selector wait. 010's
  `EBADVAL` classification and 040's opt-in networkidle are both superseded, and 060's close
  line for #11 must be rewritten to say exactly this.
- The report printer must **not** use a `file://` URL; it is refused. Serve the assembled HTML
  over loopback and navigate to that, as 040 already proposes.

## C7 — write scope amendment

[000](000_plan.md) did not list `src/register.js`, but 010 patches it to seed browse defaults.
Registering defaults is in the spirit of the unit, so the write scope is amended to include
`src/register.js`. This is recorded rather than silently taken.
