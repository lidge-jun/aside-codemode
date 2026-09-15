# 070 — wp2, third pass. Decisions, not options.

The round-2 plan audit confirmed deleting the read verb was right and then showed the
hazard had moved. Each finding below gets one decision. Where a decision removes a
feature, it removes it.

## D1 (was BLOCKING) — ref extraction fails closed

`refsFingerprint` is optional, so `extract: { price: { ref: 'e12' } }` without it would
read a renumbered tree and return a confident wrong string.

DECISION: `{ ref }` in `extract` **requires** `refsFingerprint`. Missing it is refused at
validation with EBADVAL naming the reason, not at runtime. Every ref field reports the
guard it received in `data.guard`, the same way a ref step does.

## D2 (was MAJOR, self-nullifying) — ref extraction and actions are mutually exclusive

With a fingerprint supplied, any successful mutating step guarantees a mismatch, so
ref extraction after an action list can only ever return null. A feature whose main
combination always fails is not a feature.

DECISION: `extract` containing a `{ ref }` field together with `actions` is **refused at
validation**. Post-action reads use a css selector, which means the same thing on any
document. Reading by ref after acting is a second call, and `snapshotAfter` returns the
fingerprint that makes that second call legal. That is the only coherent chain, and it
only works on `browse.attach`, which reuses the tab — see D9.

## D3 (was MAJOR) — the diff refusal must not depend on the url

`navigatedDuringActions` is a url comparison, and this module's own header records that
a modal, a client-side tab switch or an SPA re-render renumbers refs with
`location.href` unchanged. So the planned trigger does not fire in the case it exists for.

DECISION: the trigger is **ref-identity overlap**, computed from the trees themselves.

    key(row)  = ref + '|' + role + '|' + name
    overlap   = |before ∩ after| / max(1, before.length)

`overlap < 0.5` means the tree was re-minted: the result is
`{ comparable: false, reason: 're-minted', overlap, beforeCount, afterCount }` and no
added/removed/changed/same is emitted. A url move also refuses, with
`reason: 'navigated'`. Neither depends on the other.

## D4 (was MAJOR) — option rows have no ref, so they are diffed as static rows

Measured: `- option "beta" (selected) value="b"` carries no `[ref=]`.

DECISION: non-ref rows are parsed too, keyed by `depth + '|' + role + '|' + name`, and
diffed into `staticRows: { added, removed }`. A `(selected)` move on an option therefore
appears as one removed and one added static row with the marker visible in the text,
not as a state delta on a ref. The docs say that plainly rather than implying the
combobox state is tracked.

## D5 (was MAJOR) — state is an allowlist, and depth is reported separately

Measured rows carry `[disabled]`, `[checked]`, `[placeholder="parent input"]`,
`value="a"`, `[url=...]`. Treating every bracket as state would call a placeholder a state.

DECISION: `state` is exactly
`checked disabled expanded selected pressed readonly required invalid busy current`,
sorted. Everything else bracketed goes to `attrs`. And a depth move is reported in its
own `depthChanged` array, never mixed into `changed`, so wrapping a dialog around
existing content does not drown the one row that actually changed.

## D6 (was MAJOR) — the read is role-aware

Measured: `innerText()` and `textContent()` on a textbox both return "". An empty string
is a value, not an absence, and `missing` would not flag it.

DECISION: `{ ref }` routes on the role already parsed from the tree. For
`textbox searchbox combobox spinbutton slider checkbox radio` it calls `inputValue()`;
otherwise `innerText()`. `{ ref, attr }` calls `getAttribute(attr)`, `{ ref, text: true }`
forces `innerText()`. All four measured present on a locator on 2026-09-14.

## D7 (was MAJOR) — one throttle point, no wait primitive

Clamping concurrency bounds workers, not owned tabs: a `close()` that throws skips
`markClosed`, leaves the tab open, and the worker immediately opens another.

DECISION: `one()` checks `owned()` — `opened.filter(o => !o.closed).length` — before
`openTab`. Over `browseCaps.maxTabs` (new, default 8) it yields in bounded 50ms slices,
at most 20 of them, rechecking `deadlineHit` each time, then returns that url as
`ETABBUDGET`. Bounded retries and the deadline check mean it cannot deadlock and cannot
starve silently. Counters increment at the two points that already exist:
`opened` on a successful `openTab`, `closed` in `markClosed`. `EOPEN` increments nothing.

## D8 (was MAJOR) — cleanup gets ONE budget, not one per tab

Eight tabs times a 2s close timeout is 16s against 1500ms of host slack, which loses
the payload the timeout was added to save.

DECISION: `cleanup()` becomes `Promise.allSettled` over all closes under a single
`CLEANUP_BUDGET_MS = 1200`, under `SLACK_MS`. Tabs still open when that budget expires are
reported through `leakedUrls`, which is what that field is for.

## D9 (was MINOR) — attach is where chaining works, so attach gets snapshotAfter

DECISION: `snapshotAfter` is added to `browse.attach` as well as `browse.exec`. On exec its
fingerprint is documented as diagnostic only, because `one()` opens and closes a fresh
tab per url per call. Ref extraction on attach is out of scope for wp2 and is named as
such rather than half-built.

## D10, D11 (were MINOR)

- `verifiedClean` and its early return are **deleted**. With no read verb the branch is
  provably dead, and a comment is a weaker guard than absence.
- the reserve clamp moves from `innerMs * 0.6` to `0.75` and the result reports
  `reserveClamped: true` when the requested terms did not fit, instead of silently
  shrinking the protection.

## Files

MODIFY `src/host/browse/script.js` (row parse with state/attrs/depth, diffRefs, snapshotAfter,
tab throttle and counters, cleanup budget, reserve term), `src/host/browse/schema.js`
(snapshotAfter, extract ref form, the two refusals, maxTabs), `src/config.js`
(browseCaps.maxTabs default), `src/host/browse/actions-run.js` (delete the dead branch),
`src/host/browse/attach.js` + `attach-schema.js` (snapshotAfter),
`src/host/browse/probe.js` (measured locator read methods), `src/host/browse/actions-schema.js`.
NEW `test/browse-diff.test.js`.

## Acceptance

- a ref extract without `refsFingerprint` is refused at validation, and with `actions` is refused at validation
- a same-url re-render produces `comparable: false, reason: 're-minted'` with the overlap number
- a checkbox toggled by a ref click appears in `changed` as a `state` delta
- static text appearing after a failed submit appears in `staticRows.added`
- a 20-url batch with `maxTabs: 2` still returns 20 items and never exceeds 2 owned tabs
- `tabs.peak <= tabs.max` on every run, and a forced close failure surfaces in `leakedUrls`

