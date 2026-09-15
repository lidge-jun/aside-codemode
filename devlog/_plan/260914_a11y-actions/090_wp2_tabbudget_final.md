# 090 — tab budget, after the fourth audit. Blocking: none.

Three things the audit confirmed, so the rest reads in context:

- counters at intent DO close the check-then-open race. owned() is read and
  tabsRequested incremented in the same synchronous run before openTab, and
  run-to-completion means a worker resuming from a sleep passes the check and
  increments before any other worker resumes. That invariant is the whole proof, so
  it gets a comment on the line: never introduce an await between the check and
  the increment.
- markClosed is reachable on both real close paths, and intent-counting also makes
  the synthetic record cleanup builds decrement correctly, which an opened-based
  counter would have gotten wrong.
- nothing here reintroduces a verifiedClean reader.

## Corrections folded in

C1 (was MAJOR) — the cleanup budget still re-anchored to the script's own clock,
which 080 itself identified as the late one. DECISION: the host computes an absolute
hostDeadlineAt at compile time and embeds it in the payload. It is strictly earlier
than spawn, therefore conservative, and the script never re-derives it from
SCRIPT_STARTED_AT.

C2 (was MAJOR) — cleanup() opens with an unbounded await on every outstanding
openTab, before any close is attempted. Racing only the closes leaves the line that
actually hangs untouched. DECISION: the budget starts at the top of cleanup() and
covers that await too.

C3 (was MAJOR) — 20 slices of 50ms is a one-second ceiling against a measured
2,143ms click, so at maxTabs 1 / concurrency 8 nearly the whole batch is refused
while most of innerMs remains. DECISION: the wait is bounded by the item's own
deadline, not by a slice count; deadlineHit already makes that safe. ETABBUDGET
becomes the rare real refusal rather than the normal outcome, and the acceptance
test asserts 20 items ok, not merely 20 items reported.

C4 (was MAJOR) — session.js builds its result from an explicit field list, so
final.tabs would be dropped and the acceptance criterion could not be observed.
DECISION: session.js joins the MODIFY list, on both the normal and host-kill paths.

C5 — openTab can throw synchronously, outside the try, leaving tabsRequested
permanently high. DECISION: the increment goes inside the try, with a rollback in a
catch around the call itself.

C6 — 080 dropped the per-close timeout 070 had. A close that HANGS costs a worker
for the rest of the run, and its queued urls get no ESKIP row. DECISION: restore the
per-close timeout in one(); the cleanup budget protects the payload, this protects
the work.

C7 — markClosed now carries a counter, so it must be idempotent. DECISION: the
!rec.closed guard moves inside the function, where the invariant belongs.

C8 — a close that resolves after the budget still mutates counters already
stringified. DECISION: snapshot counters and leakedUrls at one instant and label
them as-of-print.

C9 — the throttle called sleep bare, while this same file guards it because the
global is not fully trusted. DECISION: use the guarded form.

C10 — deleting the early return leaves dirty read nowhere. DECISION: keep dirty and
the per-step re-check; delete only verifiedClean and its branch, and correct the
header so it describes what the code does.

## Residual, accepted rather than fixed

A hung close still costs that worker its remaining queue even with the per-close
timeout shortening it, and the as-of-print counters can drift by one late close.
Both are stated in the module docs rather than papered over.

