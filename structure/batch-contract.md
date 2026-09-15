# Batch result contract

The host batch and the in-REPL helper are written in different places and run in different
processes, and a caller is expected to read both with the same code. That only holds if the shape is
something a machine can check, so it lives in `src/host/browse/result-contract.js` and both are
checked against it.

## The envelope

Every run answers with `schema`, `runId`, `status`, `requested`, `completed`, `unreturned`, `items`,
`effects` and `complete`. The host batch answers as `browse/2` and the helper as `cm/1`.

    status        completed | partial | failed | needs_input | indeterminate
    items[]       one row per requested item, each with its own jobId
    effects[]     confirmed | indeterminate, per side effect
    tabs          { requested, closed, peak, leaked }
    checkpoint    jobIds that finished, so a rerun can skip them
    complete      true only when status is completed

Item status adds `unreturned` and `skipped` to the run vocabulary.

`needs_input` is part of the vocabulary even though nothing emits it yet. A login wall is a run
outcome rather than an error, and the reader has to already handle it.

## The rule that ties counts to the verdict

`checkResultEnvelope` returns the problems rather than throwing, so one run names every mismatch. It
refuses `complete: true` beside any status other than `completed`, and refuses `completed` when the
number of finished items is not the number requested. A run that calls itself complete while part of
what was asked for never came back is the failure this contract exists for.

## Deriving the verdict

`src/host/browse/session.js` owns every identifier and every status. The script echoes ids and
reports per-item facts; it never decides whether the run succeeded.

`itemStatus` reads codes before `ok`, because a host-killed item and an ordinary failure both carry
`ok: false` while an item whose action list half ran arrives with `ok: true`. Reading `ok` first
called both of those completed.

`runStatus` folds in five facts: whether the process was killed or printed no marker, whether any
item is indeterminate, whether any effect started without being confirmed, whether any result could
not be placed against the ledger, and whether a tab leaked.

An effect that started and was never confirmed is neither a failure nor a success. Ending a wait is
not cancelling a click Aside already handed to the page, so it cannot raise a run to `completed` and
must not erase the work that did finish.

## Reconciliation

The issuing ledger keys on position, because the same url may be requested twice and two requests
for one url have nothing else to tell them apart. Results are matched by `jobId`; a second result
carrying an id already matched is recorded as a duplicate rather than replacing the first. An item
naming an id that was never issued is an extra. Both lower the run below `completed`.

When no item carries a `jobId` and the counts match exactly, the run falls back to position matching
and says so in `reconciledBy`.

## Content and rendering today

Items carry `contentVerified`, which is `true`, `false`, or `null` when nobody asked and no heuristic
fired. `requireSelector` and `minTextChars` say what "the content is there" means for a page, and
`requireContent` turns a failed check into a failed item instead of a warning.

What none of this does yet: a destination that is a 404, a browser error page or an expired session
still reaches `completed`. Arriving at a page and reading its content are different claims, and only
the second is checked, and only when the caller asked.

## Truncation

`src/execution-output.js` bounds what a run may return. The envelope carries `truncated`, and a
caller comparing a reported character count against what arrived is the only way to know a body was
cut.

