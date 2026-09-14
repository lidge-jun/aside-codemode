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

Two paths the sequence above must not skip:

- **The host kill path.** If `hostMs` fires, the script never printed its JSON, so there are no
  `leakedUrls` to read. `session.run` takes the leaked set from the **job it sent** — every url
  it asked for that has no completed item — and returns `partial: ['host-kill']` with those
  urls. E5 says those tabs cannot be recovered later, so reporting them is the only honest
  outcome; silence would turn a permanent leak into a clean-looking result.
- **MediaBox parsing lives in browse for wp2.** 002 places `pagebox.js` under `report/` and
  forbids browse from importing report. `session.run` must verify page size, so wp2 puts the
  parser at `src/host/browse/pagebox.js`; wp5's report layer imports it from there rather than
  owning a second copy.

Success is the trailing `[ok | Nms]` marker **and** the file inspection. A missing marker is a
failure even at exit 0. No caller parses `raw.stdout` to decide success.

### Compiled script shape (C5-compliant, this is the template)

```js
"use strict";
const JOB = /* JSON literal, includes the per-item plan from policy.js (C4) */;
const opened = [];   // { targetId, url, page, closed }
const pending = [];  // every openTab promise, registered BEFORE it is awaited
const items = [];
let deadlineHit = false;

function markClosed(rec) { rec.closed = true; }

async function one(item) {
  if (deadlineHit || item.skip) { items.push({ url: item.url, ok: false, code: 'ESKIP' }); return; }
  const pr = openTab(item.url);   // C5.2: register the PROMISE before awaiting it
  pending.push({ url: item.url, pr }); // carry the url so a late failure can name it
  const page = await pr;          // E7: openTab RETURNS the page
  const rec = { targetId: page.targetId, url: item.url, page, closed: false };
  opened.push(rec);
  try {
    // waits, snapshot(page), page.screenshot(...), page.pdf({ paperWidth, paperHeight })
    items.push({ url: item.url, ok: true /* , ... */ });
  } finally {
    try { await page.close(); markClosed(rec); } catch (_) {}
  }
}

async function main() {
  const limit = JOB.concurrency;
  // bounded parallelism over JOB.items; never more than `limit` in flight
}

async function cleanup() {
  // C5.3: await EVERY registered promise, settled or not, and close what resolved —
  // including a page that resolves AFTER the deadline, which never reached `one`.
  const settled = await Promise.allSettled(pending.map((x) => x.pr));
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status !== 'fulfilled' || !s.value) continue;
    const page = s.value;
    let rec = opened.find((o) => o.page === page);
    if (!rec) {
      // A page that resolved after the deadline never reached `one`, so it is not in
      // `opened`. Take its url from `pending` — a null here would report a real leak
      // as an anonymous one, which is exactly the silent-loss failure C5 exists to stop.
      rec = { targetId: page.targetId, url: pending[i].url, page, closed: false };
      opened.push(rec);
    }
    if (!rec.closed) { try { await page.close(); markClosed(rec); } catch (_) {} }
  }
  return opened.filter((o) => !o.closed).map((o) => o.url);
}

// `sleep` is a measured Aside global (001 E2). setTimeout is not relied on.
const timer = sleep(JOB.innerMs).then(() => { deadlineHit = true; });
try { await Promise.race([main(), timer]); }
finally {
  const leakedUrls = await cleanup();
  console.log(JSON.stringify({ type: 'final', items, leakedUrls, partial: deadlineHit ? ['inner-deadline'] : [] }));
}
```

Close with `page.close()`. `closeTab` is not used and must not be asserted against.

### Tests (never launch a browser)

| File | Proves |
| --- | --- |
| `test/browse-schema.test.js` | unknown key rejected with the valid list; `page.route`, `maxWidth`, `pdf.format` throw `ENOTSUP`; the wait allowlist is exactly `{'load','domcontentloaded','stable'}` — `networkidle` throws `ENOTSUP` and any other string throws `EBADVAL`, because E7 proved Aside accepts both silently; `timeoutMs` above **`browseCaps.timeoutMs` (default 25000)** is clamped to it. `ASIDE_REPL_CAP_MS = 120000` is only the absolute ceiling Aside itself imposes and is never the effective cap |
| `test/browse-script.test.js` | **Runs the compiled source**, it does not grep it. Evaluate the string in a `node:vm` context with fake `openTab`, `sleep`, `snapshot` and `console` globals, then assert behaviour. Required activation for C5: one fake `openTab` resolves AFTER the inner deadline has fired, and the test asserts `close()` was still called on that late page and that it is absent from `leakedUrls`. A second case makes `openTab` reject and asserts the other items still complete. Grepping for `finally`/`closeTab` is explicitly NOT acceptance for C5 (C5 above). Substring checks may additionally confirm the source never contains `page.route`, `maxWidth`, `closeTab`, `tab.page` or `tab.id`, and that `paperWidth`/`paperHeight` are present — but those are hygiene, not the C5 proof |
| `test/browse-session.test.js` | injected `spawnAside` fake (a `process.execPath -e` child) printing JSON + `[ok | 12ms]` parses; exit 0 with `[error | 3ms]` is a FAILURE; missing marker is a failure; a claimed-but-absent file fails the item |
| `test/browse-pagebox.test.js` | committed 2-page PDF fixture: MediaBox `612x792` fails an A4 request, `595.92x841.92` passes |
| `test/browse-doctor.test.js` | spawn `src/cli.js --doctor --browse` like `test/cwd.test.js:68`; asserts the matrix keys |

Fixtures under `test/fixtures/browse/`. No network, no timing oracle, no real `aside.exe`.
Live checks go behind `CODEMODE_ASIDE_LIVE=1` and never run in CI.

### C8 stale check at wp2 P (against dev 89d6606)

LOOP-CONTINUITY-01 requires the pre-written spec to be re-verified against the tree before it
is executed. Every seam C8 depends on was read at HEAD and matches:

| Seam | HEAD | Status |
| --- | --- | --- |
| `src/sandbox.js:7` | `const ROOTS = ['search', 'fs', 'actions', 'read_file', 'write_file', 'edit_file', 'apply_patch'];` (note the space after each comma — patch context must match byte for byte) | append `'browse'`, `'report'` |
| `src/sandbox.js:9-21` | `hostMethods` walks ONE level via `Object.entries` | confirmed: `browse.x.y` can never register |
| `src/execution-worker.js:50` | `const injected = { search: {}, fs: {}, actions: {} };` | add `browse: {}`, `report: {}` |
| `src/execution-worker.js:56` | `for (const key of ['search', 'fs', 'actions']) Object.freeze(injected[key]);` (space after each comma) | add both keys |
| `src/child-opts.js:13` | `createRgProcessFns({ spawnImpl, execFileImpl })` | copy shape for `createAsideProcessFns` |
| `src/config.js:29-36` | `DEFAULTS` has no `asidePath`/`browseCaps` | add per C3 |
| `src/config.js:109-112` | `searchCaps` merged field-wise | copy exactly for `browseCaps` |
| `src/cli.js:57` | `if (has('--doctor')) {` builds one report object | extend in place, no second CLI |

No amendment needed: C8 is current. One ordering note for B — `src/cli.js:57` sits AFTER
`makeRootGuard`, so `--doctor --browse` still will not print on a machine whose every root is
missing. That is accepted for wp2 rather than moving the guard, because moving it changes
existing doctor behaviour that `test/cwd.test.js:68` pins.

## C9 — wp3 spec: step timings, block detection, circuit breaker

Closes #20, #17, #21. Builds on the wp2 contract; nothing here changes C1-C8.

### Files

| Path | Kind | Purpose |
| --- | --- | --- |
| `src/host/browse/policy.js` | NEW | block-signal detection, per-domain breaker state, per-item plan builder |
| `src/host/browse/script.js` | MODIFY | measure each step; honour the embedded per-item plan; report block signals |
| `src/host/browse/session.js` | MODIFY | feed per-item outcomes back into the breaker; aggregate step timings |
| `src/host/browse/schema.js` | MODIFY | accept `domainTimeouts`, `breakerFailures`, `breakerCooldownMs` |
| `src/cli.js` | MODIFY | `--doctor --browse` reports measured step timings when `CODEMODE_ASIDE_LIVE=1` |
| `test/browse-policy.test.js` | NEW | detection + breaker state transitions |
| `test/browse-timings.test.js` | NEW | per-step timing aggregation |

### #20 — step timings, honestly

The issue asks for a navigate/snapshot/screenshot bottleneck report from `--doctor --browse`.
Static capability text is not that. So:

- The compiled script measures each step and emits
  `timings: { navigate, waitFor, snapshot, screenshot, pdf }` in milliseconds per item.
- `session.run` aggregates into `timings.byStep` with total and max per step, so the slowest
  stage is visible without reading every item.
- `--doctor --browse` prints the matrix as today. With `CODEMODE_ASIDE_LIVE=1` it additionally
  runs ONE real page — `https://example.com` by default, overridable with
  `CODEMODE_ASIDE_LIVE_URL` — and that probe MUST actually perform all three measured steps:
  navigate, snapshot and screenshot. It reports `liveProbe: { url, navigate, waitFor, snapshot,
  screenshot, totalMs }` in milliseconds, plus `slowest` naming the largest step. A probe that
  skipped snapshot or screenshot would print a bottleneck report with nothing in it, which is
  the same overclaim as printing the static matrix.
- Without the flag it says `liveProbe: 'skipped (set CODEMODE_ASIDE_LIVE=1)'` rather than
  printing zeros, because a fabricated zero reads as a fast page.
- CI never sets that flag, so no CI job launches a browser.

### #17 — block detection

Detection is on observable page state, never on a retry that eventually gives up:

| Signal | Rule |
| --- | --- |
| login wall | final url host differs from requested host AND matches `/(login|signin|sign-in|auth|account)/i`, or the snapshot tree contains a password field role |
| CAPTCHA | title or tree matches `/captcha|are you a robot|verify you are human|cf-challenge/i` |
| hard block | title or tree matches `/access denied|403 forbidden|rate limit|too many requests|blocked/i` |

A detected item returns immediately with `ok: false`, `code: 'EBLOCKED'`, `blockKind`, and
`alternate` naming the route that could work (`api`, `fetch-first`, `authenticated-exec`).
It must NOT retry: retrying a login wall spends the budget and still fails.

**When detection happens, exactly.** This is the part that decides whether #17 works or is
theatre. Immediately after `await openTab(url)` resolves and after the wait step, and BEFORE
any screenshot, pdf or extraction, the script performs one probe read:

```js
const finalUrl = await page.url();     // a method, not a field
const title = await page.title();      // a method, not a field
const tree = (await snapshot(page)).tree || '';   // snapshot takes the page object
const verdict = detect({ requestedUrl: item.url, finalUrl, title, tree });
if (verdict) { items.push({ url: item.url, ok: false, code: 'EBLOCKED', blockKind: verdict.kind, alternate: verdict.alternate, timings: t }); return; }
```

That tree is then reused for the snapshot step rather than fetched twice. Detecting after the
capture would mean paying for the screenshot of a login wall and then reporting it as a
successful capture, which is the silent-degradation class this whole layer exists to prevent.

The login-wall password signal is a **string match on the snapshot tree text**
(`/password|비밀번호/i` plus a textbox marker), NOT a role API: no accessibility role query was
ever measured on this surface, and inventing one would be exactly the unmeasured-API failure
the round-1 audit caught.

### #21 — per-domain circuit breaker

Host-side state, script-side enforcement, exactly as C4 requires.

```js
createBreaker({ failures = 3, cooldownMs = 30000, now = Date.now })
  .plan(urls, { domainTimeouts, defaultTimeoutMs })  // -> [{ url, timeoutMs, skip }]
  .record(items)                                     // feed outcomes back
  .state(host)                                       // 'closed' | 'open' | 'half-open'
```

| Transition | Trigger | Activation scenario |
| --- | --- | --- |
| closed -> open | `failures` consecutive failures for one host | record 3 failures, assert `state()` is `open` and the next `plan()` marks that host `skip: true` |
| open -> half-open | `cooldownMs` elapsed since opening | advance the injected `now`, assert `state()` is `half-open` and `plan()` allows exactly one probe |
| half-open -> closed | the probe succeeds | record one success, assert `state()` is `closed` and the failure count is reset |
| half-open -> open | the probe fails | record one failure, assert `state()` is `open` again and the cooldown restarts |

`now` is injected, so every transition is driven by an explicit clock value. No test sleeps.

Per-domain timeouts come from `browseCaps.domainTimeouts` and are clamped to the C2 inner cap
of 25000, which sits below Aside's measured ~30s internal screenshot timeout — a per-domain
timeout at or above that ceiling would never fire first and would be decorative.

## C10 — wp4 spec: batch capture, host image handling, fetch-first read

Closes #6, #12, #8.

### How bytes get out of the REPL (the decision this phase turns on)

A screenshot is a Buffer inside Aside. It cannot ride the JSON payload without base64
inflating every image by a third, and the repl filesystem refuses to write outside the
session and project roots (`Path escapes Project and session roots`), so the script cannot
write straight into the caller's directory.

So the script writes into `./artifacts/` under its OWN session directory and reports its
absolute `pwd` in the payload. The host — which has ordinary filesystem access — reads from
there, post-processes, and writes the result to the caller's path through `assertInside`.
That keeps the root guard honest: the guest never names a path the host does not check.

**`pwd` is script-reported, so it is not trusted as a read root.** It arrives in stdout the
script produced, which makes it influenced data rather than a host fact. Three rules close
that hole:

1. **The host generates every artifact filename.** The script is told the names to use; it
   never invents one and the host never takes a name from the payload. A payload name is
   ignored even if present.
2. **Reads are contained.** The host resolves `realpath(join(pwd, 'artifacts', hostName))`
   and refuses anything that does not sit under `realpath(pwd)/artifacts`, so a `..` segment
   or a symlink cannot walk out of the session directory.
3. **`assertInside` is applied to the FINAL output file**, not merely to `outDir`. Checking
   the directory alone leaves the join unchecked, which is the same class of bug as
   validating a prefix instead of a resolved path.

### #6 — `browse.captureMany(urls, opts)`

A named wrapper over the existing one-session batch, with per-item artifacts:

- one `session.run` for N urls; concurrency from `browseCaps.concurrency`
- each item carries `artifact: { path, bytes, mime, width, height }` after the host copy
- one failure never empties the rest (already proven in wp3 tests)
- `outDir` is resolved with `assertInside`; a path outside the configured roots is refused

### #12 — host-side image handling, honestly scoped

`src/host/browse/image.js` gains real readers and an explicit refusal:

- `pngDimensions(buf)` from the IHDR at byte 16/20, `jpegDimensions(buf)` by walking SOF
  markers. Both are zero-dependency and exact.
- `verifyCapture(buf, requested)` returns `{ width, height, matched }` so a caller learns the
  real pixels instead of trusting the request. `maxWidth` was measured to be ignored, so this
  is the only way to know what was actually captured.
- **Resize is `ENOTSUP`, deliberately.** Re-sampling a bitmap in pure JS with no dependency
  would be slow and would produce worse output than the browser already can. The supported
  geometry control is `clip` at capture time, which was measured to be honoured exactly
  (320x200 requested, 320x200 returned). JPEG encoding is Aside's, via `type` and `quality`.
  Claiming a resize we cannot do well is the silent-degradation failure this layer refuses.

### #8 — `web.readText(url)`

`src/host/browse/read-text.js`, fetch-first:

1. Host `fetch` (Node >= 18 guarantees it) with a short timeout.
2. Strip `script`, `style`, `noscript`, `svg`, then extract the densest block and convert
   headings, links, lists and paragraphs to markdown.
3. **Browser fallback only when the extracted text is measurably not content.** The rule is a
   property of the RESULT, not a guess about the framework:
   - `extracted.length < 200` after the strip-and-extract pass, OR
   - the page has a non-empty body whose extracted text is empty (an app shell that rendered
     nothing server-side).

   Framework markers are deliberately NOT a trigger. `__NEXT_DATA__` and `ng-app` live inside
   `<script>`, which step 2 strips — so on raw HTML they would fire on ordinary
   server-rendered Next pages that need no browser at all, and after the strip they would
   never fire. Either way they measure the toolchain rather than the content. A
   text-to-markup ratio is dropped for the same reason: a chrome-heavy article page is
   markup-dense and still perfectly readable.

   The decision and its reason are reported as `source: 'fetch' | 'browser'` and
   `fallbackReason`, so a caller can tell which path answered and why.

A `file:` url is refused up front, matching E7.
