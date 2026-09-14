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

Names are taken from 010, the largest and most-copied artifact. This section introduces no new
spelling; it deletes the competing ones.

```js
// src/host/browse/session.js
createBrowseSession({ spawnAside, resolveAside, readFile, stat, now, signal })
  .run(job, { signal }) -> Promise<SessionResult>
```

- The factory is **`createBrowseSession`** (010's name). `createSession` is not a thing.
- `job` is a **validated job object** from `schema.js`, never a string of JavaScript.
  030's `run(source) -> {stdout}` and 040's "call whichever landed" are both superseded.
- `session.run` calls `compile(job)` from `script.js` internally. No caller compiles.
- Deadlines come from **`deadlineMath(requestedMs, browseCaps)`** exported by `script.js`. It
  takes the requested milliseconds (010's arity) plus the caps object 040 already passes, and
  returns `{ innerMs, hostMs }`. The name `computeDeadlines` does not exist and it is NOT in
  `schema.js`; 040 imports `deadlineMath` from `./script.js`.
- `SLACK_MS = 1500` (010's value); 030's 3000 is superseded.
  `hostDeadlineMs = innerDeadlineMs + SLACK_MS`.
- `SessionResult` is `{ ok, items, timings, partial, leakedUrls, raw }`, handed to `result.js`.
  `partial` is a **`string[]`** of reasons (010's shape), not a boolean; empty means nothing was
  degraded. `raw` is `{ stdout, marker }`, kept for diagnostics and for 030's existing
  `raw.stdout` read. The rule is that **no caller parses stdout to decide success** — marker and
  file inspection happen once, inside `session.run`. An earlier draft said "never returns raw
  stdout", which contradicted its own field list.

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
  enabled: false,        // wp2, opt-in; 010's enabled:true is stale
  timeoutMs: 25000,      // wp2, inner cap (C2); 010's 30000 is stale
  maxTabs: 8,            // wp2, tabs inside one script
  concurrency: 4,        // wp4, in-script parallelism
  navigateTimeoutMs: 15000,      // wp3
  maxNavigateTimeoutMs: 25000,   // wp3, must equal the C2 inner cap
  breakerFailures: 3,            // wp3 default; 020 may pass 2 as a constructor argument
  breakerCooldownMs: 30000,      // wp3
  domainTimeouts: {},            // wp3
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

**How the breaker wires, given that the Aside REPL cannot import `policy.js`.** The split is
decide-on-host, enforce-in-script, and it is what makes C4 a lock rather than a hole:

- Host `policy.js` keeps breaker state across calls. For a batch it produces a plain data plan —
  per item `{ url, timeoutMs, waitSelector, skip }`, where `skip: true` marks a domain whose
  breaker is already open. That plan is JSON and `script.js` **embeds it as a literal** in the
  compiled source.
- The compiled script enforces the plan: a skipped item is returned as a failure without opening
  a tab, and every other item races its own `timeoutMs`.
- The script reports per-item outcomes, and host `policy.js` **feeds them back** into breaker
  state after `session.run` resolves, so the next call sees the trip.

`runGuardedBatch` therefore stays a host function, but it wraps exactly ONE `session.run` and
post-processes its items. `spawnOnePage` is deleted from the design; nothing below
`session.run` may spawn.

## C5 — tab ownership after the inner deadline (closes blocker 6, task t12)

A `Promise.race` that abandons `main()` does not stop an in-flight `openTab`, so a tab opened
after the race still leaks — the exact failure [001](001_probe_evidence.md) E5 says cannot be
repaired from a later session. Required shape in every compiled script:

1. A single `deadline` flag is set before the race resolves; `openTab` is never called when it
   is set.
2. Register the **promise**, not the page: `const pr = openTab(url); pending.push(pr);` and only
   then `await pr`. A page cannot be registered before the await that creates it, so an earlier
   draft of this rule asked for something unimplementable.
3. Cleanup awaits every promise in `pending`, settled or not, and closes each page that
   resolves — not only what had resolved when the race fired.
4. Anything still unclosed goes in `leakedUrls`, and `partial` gains a reason string.
5. Close with `page.close()`. There is no `tab.id`, so `closeTab(t.id)` is wrong (E7).

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

## C8 — wp2 implementation spec (the only thing to build from)

Everything wp2 needs is here. 010 is background; do not open it to implement.

### Files

| Path | Kind | Exports |
| --- | --- | --- |
| `src/host/browse/schema.js` | NEW | `validateJob`, `BrowseOptionError`, `UNSUPPORTED`, `ASIDE_REPL_CAP_MS`, `A4_INCHES` |
| `src/host/browse/script.js` | NEW | `compile`, `deadlineMath`, `SLACK_MS` |
| `src/host/browse/session.js` | NEW | `createBrowseSession`, `parseMarker` |
| `src/host/browse/result.js` | NEW | `buildEnvelope` |
| `src/host/browse/probe.js` | NEW | `CAPABILITY_MATRIX`, `doctorPayload` |
| `src/host/browse/browse.js` | NEW | `createBrowse` |
| `src/host/globals.js` | MODIFY | add `browse`, and `report: Object.freeze({})` |
| `src/sandbox.js` | MODIFY | `ROOTS` gains `'browse'`, `'report'` |
| `src/execution-worker.js` | MODIFY | pre-create and freeze `injected.browse`, `injected.report` |
| `src/host/actions.js` | MODIFY | splice `BROWSE_ACTIONS` from `browse/schema.js` |
| `src/config.js` | MODIFY | `asidePath` + `browseCaps` per C3, field-wise merge |
| `src/cli.js` | MODIFY | `--doctor --browse` |
| `src/child-opts.js` | MODIFY | `createAsideProcessFns({ spawnImpl, execFileImpl })` |
| `src/tools.js` | MODIFY | one `GUEST_API_DOC` bullet |
| `test/browse-*.test.js` | NEW | see Tests |

### `deadlineMath` — one definition, used everywhere

```js
export const SLACK_MS = 1500;
export const ASIDE_REPL_CAP_MS = 120000;

// requestedMs is the caller's timeout. browseCaps supplies the inner cap.
// innerMs is what the compiled script races; hostMs is the process deadline.
// C2: inner < host, always. Never the other way round.
export function deadlineMath(requestedMs, browseCaps = {}) {
  const cap = Math.min(browseCaps.timeoutMs ?? 25000, ASIDE_REPL_CAP_MS);
  const innerMs = Math.max(1, Math.min(requestedMs ?? cap, cap));
  return { innerMs, hostMs: innerMs + SLACK_MS };
}
```

### `session.run` — one signature

```js
createBrowseSession({ spawnAside, resolveAside, readFile, stat, now, signal })
// signal is closed over by the factory, exactly like createFs/createRgRunner.
// The second argument exists only so a caller can pass a narrower per-call signal.
session.run(job, { signal } = {}) -> Promise<SessionResult>

SessionResult = {
  ok: boolean,
  items: Array<{ url, ok, source, error, code, artifact, capture, timings }>,
  timings: { steps, totalMs },
  partial: string[],      // reasons; [] means nothing was degraded
  leakedUrls: string[],
  raw: { stdout, marker },
}
```

`run` does, in order: `validateJob(job)` -> `deadlineMath` -> `compile(job)` ->
`resolveAside()` -> `spawnAside(bin, ['repl', source], childOpts)` with `hostMs` ->
`parseMarker(stdout)` -> parse the JSON payload -> inspect every claimed file
(exists, bytes, PNG IHDR / JPEG SOF, PDF MediaBox) -> build `SessionResult`.

Success is the trailing `[ok | Nms]` marker **and** the file inspection. A missing marker is a
failure even at exit 0. No caller parses `raw.stdout` to decide success.

### Compiled script shape (C5-compliant, this is the template)

```js
"use strict";
const JOB = /* JSON literal, includes the per-item plan from policy.js (C4) */;
const opened = [];   // { targetId, url, page }
const pending = [];  // every openTab promise, registered BEFORE it is awaited
let deadlineHit = false;

async function one(item) {
  if (deadlineHit || item.skip) return { url: item.url, ok: false, code: 'ESKIP' };
  const pr = openTab(item.url);   // register first (C5.2)
  pending.push(pr);
  const page = await pr;          // E7: openTab RETURNS the page
  opened.push({ targetId: page.targetId, url: item.url, page });
  // ... waits, snapshot(page), page.screenshot(...), page.pdf({ paperWidth, paperHeight })
  return { url: item.url, ok: true /* , ... */ };
}

async function main() {
  const limit = JOB.concurrency;
  // bounded parallelism over JOB.items; never more than `limit` in flight
}

async function cleanup() {
  // C5.3: await EVERY registered promise, settled or not, and close what resolved.
  const settled = await Promise.allSettled(pending);
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) { try { await s.value.close(); } catch (_) {} }
  }
  const leaked = opened.filter((o) => !o.closed).map((o) => o.url);
  return leaked;
}

const timer = new Promise((r) => setTimeout(() => { deadlineHit = true; r('deadline'); }, JOB.innerMs));
let out;
try { out = await Promise.race([main(), timer]); }
finally { const leakedUrls = await cleanup(); console.log(JSON.stringify({ type: 'final', items, leakedUrls, partial: deadlineHit ? ['inner-deadline'] : [] })); }
```

Close with `page.close()`. `closeTab` is not used and must not be asserted against.

### Tests (never launch a browser)

| File | Proves |
| --- | --- |
| `test/browse-schema.test.js` | unknown key rejected with the valid list; `page.route`, `maxWidth`, `pdf.format` throw `ENOTSUP`; `waitUntil`/`waitForLoadState` allowlist rejects `networkidle` and garbage; `timeoutMs` above the cap is clamped |
| `test/browse-script.test.js` | compiled source contains `paperWidth`/`paperHeight` and never `page.route`, `maxWidth`, `closeTab`, `tab.page`, `tab.id`; contains `pending.push` before `await`; `deadlineMath` returns `inner < host` |
| `test/browse-session.test.js` | injected `spawnAside` fake (a `process.execPath -e` child) printing JSON + `[ok | 12ms]` parses; exit 0 with `[error | 3ms]` is a FAILURE; missing marker is a failure; a claimed-but-absent file fails the item |
| `test/browse-pagebox.test.js` | committed 2-page PDF fixture: MediaBox `612x792` fails an A4 request, `595.92x841.92` passes |
| `test/browse-doctor.test.js` | spawn `src/cli.js --doctor --browse` like `test/cwd.test.js:68`; asserts the matrix keys |

Fixtures under `test/fixtures/browse/`. No network, no timing oracle, no real `aside.exe`.
Live checks go behind `CODEMODE_ASIDE_LIVE=1` and never run in CI.
