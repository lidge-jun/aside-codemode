# 060 — wp2 revised after the plan audit returned FAIL

Twelve findings. Every one is answered below with a decision, not a promise.

## F1 BLOCKING — a read-only ref verb would reopen round 2

The audit is right that marking a read verb inert recreates the exact hole:
`[{ref:e1, extractText}, {ref:e9, click}]` would early-return on `verifiedClean && !dirty`
and click unchecked while labelled `fingerprint`.

DECISION: **there is no read verb.** Ref extraction is not a step. It stays in the
`extract` phase, which runs once, after the whole action list, and is guarded once
against the same fingerprint. `__INERT` stays `{ sleepMs: 1 }` and stays unreachable.
A comment in actions-run.js records that adding any read verb requires revisiting the
early return first. The cost question the audit raised disappears with the verb.

## F2 MAJOR — a ref-keyed diff across documents asserts a lie

Aside re-mints e1..eN per document, so a persistent nav bar would be reported as
**same**, which is the staleness lie in a new costume.

DECISION: the diff refuses rather than degrades. When `navigatedDuringActions` is true,
or the url moved, the result is
`{ comparable: false, reason: 'the document changed; refs were re-minted', urlBefore, urlAfter }`
plus the new tree and fingerprint. No added/removed/changed/same is emitted at all.

## F3 MAJOR — the diff missed state, static text, and structure

Measured on 2026-09-14, the tree carries exactly what was missing:

    - textbox "attr-value" [ref=e1]
    - button "dis" [ref=e2] [disabled]
    - checkbox [ref=e3] [checked]
    - combobox "beta" [ref=e4]:
      - option "alpha" value="a"
      - option "beta" (selected) value="b"
    - text: "visible text here"

DECISION: a ref row now captures `{ ref, role, name, actionable, state, depth }` where
`state` is the sorted bracket tokens (`disabled`, `checked`, `expanded`, `selected`, …) plus
`(selected)`, and `depth` is the indentation that was being thrown away. `changed`
reports which of role/name/state/depth moved. Non-ref rows are counted and diffed as
`textRows: { added, removed }`, so "Payment declined" appearing as static text is not
reported as "nothing happened".

## F4 MAJOR — snapshotAfter was unfunded

DECISION: `ACTION_RESERVE_MS` gains a `snapshotAfter` term. The plan also records the
real cost the audit counted: `fingerprintOf` already takes one snapshot **per ref
step**, so a three-ref job with `snapshotAfter` is five snapshots, not two. That number
goes in the option's own description so a caller sees it before paying it.

## F5 MAJOR — chaining is false for browse.exec

`one()` opens a fresh tab per url per call and closes it in `finally`. A post-action
fingerprint can never match a freshly navigated document on the next call.

DECISION: the returned fingerprint is documented as useful for `browse.attach` only,
which reuses the live tab. The exec description says so.

## F6 MAJOR — the capability claim was unmeasured, and the example was wrong

Now measured on a locator, all ok: `getAttribute('value')` -> "attr-value",
`getAttribute('data-kind')` -> "probe", `inputValue()` -> "attr-value",
`evaluate('el => el.value')` -> "attr-value", `isChecked()`, `isDisabled()`.
`innerText()` and `textContent()` on an input both return "" — correctly.

DECISION: `{ ref }` reads `innerText()`; `{ ref, attr }` reads `getAttribute(attr)`;
`{ ref, value: true }` reads `inputValue()`, which is the live property the audit correctly
said `getAttribute('value')` is not. probe.js gains the measured locator methods.

## F7, F8 MAJOR — the tab budget as planned had no primitive and no owner

There is no wait primitive in the pool, `deadlineHit` cannot wake a blocked waiter, and
a hung `page.close()` would stall `main()`, then `cleanup()`, then the final payload.
Also `pending` and `opened` disagree about ownership exactly where leaks live.

DECISION: no waiting. Concurrent owned tabs are already bounded by the worker pool, so
the budget is enforced where it actually lives: effective concurrency is clamped to
`browseCaps.maxTabs` (new, default 8) and the clamp is reported. Every run returns
`tabs: { opened, closed, peak, max, concurrency, clamped }`, counted at the same two
points that already exist so ownership stays unambiguous: `opened` on a successful
`openTab`, `closed` on `markClosed`. `EOPEN` never increments anything. Separately,
`page.close()` is wrapped in a timeout in both `one()` and `cleanup()`, because a hung
close silently taking the final payload is the real version of the risk F7 names.

## F9, F10, F11, F12 MINOR

- the diff consumes the full ref list, not the 500-row display slice, and carries
  `refsTruncated` through
- the diff returns `survivingRefs`, the set, not only a count, so "is e12 still the
  element I read" is answerable
- `snapshotAfter: 'bytes'` measures the POST-action tree in its own variable; reusing
  the pre-action `tree` would silently report the old size
- wiring: `snapshotAfter` joins JOB_KEYS; extract validation accepts `{ ref }` beside
  `{ selector }`; `browseCaps.maxTabs` is introduced in config.js defaults rather than
  referenced as if it existed

