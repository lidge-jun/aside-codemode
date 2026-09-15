# 040 — Audit of the wp1/wp2 plan

Five findings. Four change the plan. One of them is a correctness hazard the draft
did not see at all.

## A1 (CORRECTNESS, changes the plan) — a ref is only valid for the tree it came from

Refs are assigned by the snapshot that produced them. The probe measured a single
click taking the dashboard tree from 3,126 to 23,530 characters, which means the
ref numbering after that click is a different numbering. A caller that reads a
tree, picks e18, and then sends a two-step action list where step 1 navigates is
pointing step 2 at a ref that no longer means what they read.

The draft had no answer for this and would have clicked whatever now owns that id.
That is the worst possible failure shape: it succeeds, and it succeeds on the
wrong element.

Revised: the script records the url at the moment the pre-action snapshot was
taken. Before executing a **ref** step it compares the current url. If it moved,
the step returns `ok:false, code:'EREFSTALE'` naming both urls, unless the caller
passed `allowStaleRefs: true`. Selector steps are unaffected, because a selector
means the same thing on any document. A caller that wants to act twice across a
navigation re-snapshots, which is what `snapshotAfter` is for.

## A2 (changes the plan) — 50 steps does not fit in the deadline

`locator("e5").click()` measured 2,143ms on a trivial local button, and the inner
cap is 25,000ms with the host deadline above it. Fifty steps is between four and
a hundred times the budget, so the cap advertises something the surface cannot do
and every long list would die on the shared deadline instead of on its own limit.

Revised: 20 steps, and the per-step default timeout is derived from the remaining
budget rather than fixed. The refusal at validation time says why, with the
measured number in the message, so the caller does not have to discover it by
timing out.

## A3 (changes the plan) — a cumulative tab budget would break existing batches

The draft said "refuse to open past maxTabs". `browse.exec` already accepts more
urls than maxTabs and handles them by closing each tab as it finishes; the pool
bounds tabs **in flight**, not tabs over the life of the run. A cumulative counter
would turn today's working 20-url batch into 8 results and 12 ETABBUDGET rows.

Revised: the budget counts **currently owned** tabs. `tabsOpened`, `tabsClosed` and
`tabsPeak` are reported on every run so a leak is visible in the result, and
ETABBUDGET only fires when the pool genuinely cannot release one.

## A4 (changes the plan) — the render verdict would describe a page that is gone

The draft ran actions after the render check. If an action navigates,
`contentVerified` describes the page we left while `finalUrl` and `data` describe the
page we arrived at. Two fields in one item, about two different documents, with
nothing saying so. This project already has one scar from exactly that shape.

Revised: `finalUrl` is re-read after the action list, `render.stage` records
`'pre-actions'`, and when the url moved the item carries `navigatedDuringActions: true`
with `urlBeforeActions`. The verdict is not silently reused for a different page.

## A5 (no change) — enumeration is not capability detection

Worth restating because it is counter-intuitive and a future reader will try it:
`Object.getOwnPropertyNames(page.locator(ref))` returns `[]` while every method on
that object works. The plan already says call-and-catch. Keep it, and keep the
probe evidence next to it so nobody "fixes" it into a feature check.

## Verdict

PASS with A1, A2, A3 and A4 folded into 020 and 030. A1 is the one that mattered:
without it this feature would have shipped a silent wrong-element click.

