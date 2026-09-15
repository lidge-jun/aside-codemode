# Session contract

Code mode here runs on the user's own signed-in Chromium. Every other code-mode implementation
runs its generated code against no session at all: an ephemeral isolate, a sandboxed container
with the network cut, or a fresh browser profile with no credentials. That difference is the
whole of this document, because it breaks the premise batching normally rests on.

## The premise that does not hold

A batch is normally justified when the steps repeat, **the items do not depend on each other's
state**, and a finished item can be described in one sentence. Under a signed-in session the
middle condition is false by construction. Eight course pages read in parallel share one SSO
session, and if that session dies partway through, the remaining items quietly read a login page
and report success.

So the unit of work is not the batch alone. It is a native step and a batch together, and the
boundary between them has to be written down or it is guessed each time.

## The division of labour

| Step | Runs | Why |
|---|---|---|
| Sign-in, SSO, second factor | native | a person has to be there; it never belongs inside a batch |
| Confirming the session is live | native, once | the proof is target-specific, and no general check exists |
| Repeated collection | code mode | the session is inherited and tab accounting is exact |
| Reading a tab the user is looking at | attach | `src/host/browse/attach.js` neither opens nor closes a tab |
| A target with an open API | native fetch | a tab is pure overhead when the data is already addressable |

## Why the tool must not guess whether you are signed in

The obvious design is for the tool to decide. It was measured, and a general heuristic fails in
both directions at once.

| Response shape | Truth | A logged-out-word heuristic says | Result |
|---|---|---|---|
| A JSON API answering with account data | signed in | no sign-out wording present | false alarm |
| A portal page while signed in | signed in | sign-out wording present | correct |
| The same portal while signed out | signed out | the word for signing in is not present either | **false pass** |

A JSON response carries no sign-in interface at all, and a signed-out portal page need not contain
the word. The third row is the dangerous one: the page that is furthest from what the caller wanted
is the one the heuristic waves through.

Proof of a live session is therefore **target-specific knowledge the caller holds**, not something
`src/host/browse/policy.js` can infer. `policy.js` detects the shapes that are unambiguous — a
challenge page, an origin refusing the client, a redirect that lands on a sign-in path — and
returns an alternate route. It does not, and should not, try to answer whether an arbitrary
response means you are authenticated.

## Stating the proof

`loggedInMarker` is where that knowledge goes: a regular expression matching text that only appears
when you are signed in. An item without it is `ENOTLOGGEDIN` and its status is `needs_input`, not
`failed`, because the whole distinction is what the caller does next — sign in and run the rest,
rather than retry something that will keep failing.

It is deliberately not `requireContent`. Content that is missing is a failure: the page did not
hold what was wanted. A session that is gone is a request. Two failures that ask different things
of the caller need two options, or the answer collapses into the less useful one.

Once one item reports the marker missing, the rest are skipped with `logged-out` as the reason.
Every remaining item shares the session that just proved gone, so continuing only opens tabs that
cannot succeed and spends the deadline doing it. `stopWhenLoggedOut: false` turns that off for a
caller who would rather see every item fail on its own.

They are skipped rather than dropped, and the difference matters. An earlier revision stopped the
worker loop instead, so the remaining items were never reported and the host filled them in as
requests that never came back — the same answer a run gives when it genuinely loses items. The
queue is drained either way now, and the guard answers each item with the reason it was not
attempted.

A `waitSelector` that never matches does not end the item on its own. On a page you are not
signed in to, the sign-in is why the selector is absent, and ending there reported a bare timeout
while the marker sat unread. The timeout is recorded, the probe runs, and the marker or the
content check gets to name the cause. If neither claims the item, it fails with `EWAITSELECTOR`
naming the selector, which is more than the bare timeout ever said.

The marker is tested against the document's own text with script, style and template content
removed, the same text `requireContent` reads. A bootstrap payload that mentions the marker is not
a signed-in page, and the rendered view collapses on a page the browser has not laid out.

One gap remains. If the page cannot be evaluated at all, the marker is not checked and the item is
not failed for it: a missing evaluate costs the verdict rather than the work, which is the rule the
render checks already follow. `contentVerified` is `null` there, and null has always meant nobody
asked rather than nothing was wrong.
