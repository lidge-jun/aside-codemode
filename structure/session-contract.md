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

## What this costs today

There is no option for a caller to state that proof, so the knowledge has nowhere to go. A session
that expired mid-batch produces items that arrive, render, and verify, because a login page is a
page that rendered. The result is `completed`.

