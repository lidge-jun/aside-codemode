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

## A blocked page, and who can clear it

`EBLOCKED` is one code carrying two answers, and which one it is decides the status. A sign-in wall
or a challenge is something a person can clear, so the item is `needs_input`. An origin refusing
this client, or an upstream answering 5xx, is not cleared by anyone sitting down at the browser, so
the item is `failed`. An `EBLOCKED` that never named its kind stays `failed`: `needs_input` is a
claim that human action unblocks the item, and a code that did not say so has not earned it.

A run inherits the request. If nothing finished and something needs a person, the run is
`needs_input`; if other items did finish, it is `partial` and the tag says which kind of block was
met.

It ranks below `indeterminate`, because a run we cannot account for is genuinely not a run a person
fixes by signing in. It ranks **above** an unconfirmed effect and above a ledger that does not
reconcile. Both of those answer `failed` when nothing completed, and `failed` is a definite claim
that the run is over and the cause is terminal — which is untrue when signing in would unblock it,
and which hides the only status that tells a caller to hand the run back rather than retry. Both
facts stay readable in `effects[]` and in the reasons.

This is where `needs_input` finally has a producer. The installed skill has always told an agent
that `needs_input` means a login wall and should be handed back rather than retried; until now the
code never emitted it, so the document described a status the tool could not reach.

## Arriving nowhere

Chrome's own error page is a page: it loads, it has a title, and opening it resolves. A DNS failure
and a refused connection therefore used to arrive looking exactly like a success.

**Arriving nowhere is decided before every other verdict, inside the script.** It has to be. An
error page is a real rendered document with a body, so the session marker finds nothing and answers
that you are logged out, a required content pattern does not match and answers that the page never
rendered, and block detection reads a title and a tree this page also has. Each would answer with
confidence about a page that was never loaded, and the session answer would additionally stop the
rest of the batch. A host-side repair cannot undo a decision the script made three steps earlier,
so the destination is checked first and the item is stamped `EDEADEND` there.

The host keeps the same check as a net for the one case the script has nothing to look at: a page
it could not evaluate at all. That stamp lands only where the item still looked successful, so an
item that already named its own failure keeps that reason rather than having a symptom written over
the cause.

The scheme is the only signal available here. HTTP status is not: `waitForResponse` is absent from
this surface, so the batch never sees one, and `read-text.js` is the only place a status is read at
all. A page that loaded and says Not Found is therefore left to the content check, because
inventing a rule for it would trade this false success for a false failure.

## Saying what counts as content

`requireSelector` and `minTextChars` describe what the page must have. `requireContent` decides
what a failed check costs, and it takes two shapes. A string is a regular expression the page must
contain, and is itself the check, so it stands alone and produces a real verdict. `true` enforces
whatever checks apply, including the render heuristics that always run, and is legal with nothing
beside it.

`contentVerified` is `true` only when something was actually asked for: a required selector, a
minimum length, or a pattern. A bare `true` never counts, so it cannot report verified with nothing
verified. That is worth stating because an earlier revision refused the bare form to prevent
exactly that, and the refusal was both unnecessary — the verdict already excluded the boolean — and
ineffective, since `minTextChars: 1` satisfied it and then a single character read as verified.
A weak check still returns what the caller asked for; choosing a meaningful one is theirs.

The pattern is tested against the document's own text with script, style and template content
removed. The rendered view is not used, because it collapses on a page the browser has not laid
out — one page answered 2,024 characters that way and 271,303 the other — and a marker that is
present would read as absent. Script bodies are excluded for the mirror reason: a bootstrap payload
that mentions the string would match while nobody could see it.

## An empty answer that should not be believed

A selector that matched nothing on one page is a page that does not have it. A selector that
matched nothing on **every** page that answered is a selector that is wrong, and the run is the
only place that sees more than one item at a time, so it is the only place that can tell. It
reports `suspectEmpty` naming those fields, along with how many of those pages carried frames,
because a frame is the usual explanation: eight course pages once returned zero for the same
selector with no error anywhere, and the content was inside an iframe. The count is pages rather
than frames, since a total cannot tell two pages with two frames from one page with four.

A search where every query came back with nothing carries the same field, for the same reason: in
practice that is a challenge page or a parser that stopped matching rather than a subject with no
results anywhere.

Both need at least two answers before they say anything. One page without a selector, and one
query without results, are ordinary.

A ref-addressed extract field is never accused. A ref names a row in one observation, so an empty
one is a stale fingerprint rather than a selector anybody wrote wrongly, and the run already
reports staleness as what it is.

Neither lowers the status. The call worked and the run is `completed`; what is in doubt is whether
the answer means what it looks like it means, and saying so is different from failing.

A content search that finds nothing is deliberately **not** flagged. Finding nothing usually means
the text is not there, which is the answer that was asked for, and a warning on the common case
teaches a reader to ignore the field.
