# Browse surface

Everything under `src/host/browse/` exists to turn a list of urls into rows without opening a tab
the caller cannot account for. One module spawns Aside, one compiles the script, one validates the
job, and the rest are the checks that keep a batch honest.

## The job, validated before anything spawns

`schema.js` is the option source of truth. Unknown keys are rejected with the valid list, and a key
Aside accepts but silently ignores is refused by name with the measurement behind it: `page.route`
is absent and `page.on('request')` delivered zero events; `screenshot.maxWidth` was ignored;
`pdf.format: 'A4'` quietly produced US Letter; `waitUntil` accepts any string including garbage.

Refusing early matters because the alternative is a batch that looks configured and is not.

## Deadlines

`script.js` owns the arithmetic. The inner deadline is always earlier than the host deadline, and
the host is the patient one: if the host timer fires, the script never ran its cleanup and the tabs
are gone for good. That case is reported as a host-kill leak with every requested url named, rather
than quietly dropped.

The generated source travels as a command-line argument, so a script over the wire limit is
refused with `ESOURCETOOLONG` rather than becoming a platform error that names nothing.

That limit is the platform's, from `WIRE_LIMIT` in `script.js`. Windows caps a whole command line
at 32,767 characters, so it gets 30,000 with room for the binary path and the verb; every other
host measures its limit in hundreds of kilobytes and gets 50,000. Holding all of them to the
tightest one had a cost that was invisible until it was measured: `helper: true` could not be used
with a full batch anywhere, and neither could twenty actions or `treeNodes`.

What the tool promises everywhere is narrower than what the schema accepts, and the suite pins
both halves. The ordinary acting and reading jobs fit 30,000 on any host, with the headroom stated
in characters so the next change knows what it has. The combinations past that envelope are
asserted to be past it, and to fit 50,000, so nothing quietly drifts from one side to the other.

The budget applies to what the host actually compiles, which is not the job the caller handed in.
`session.run()` puts the issued `runId` on the job and a `jobId` on every plan row before calling
`compile()`, and those identifiers ship. A measurement taken from `compile(validateJob(job))` is
smaller than the source that travels, by an amount that grows with the number of urls.

Comments are not what costs. `compile()` ends by running the whole assembled source through
`stripForWire()`, so whole-line comments and blank lines are removed from the main body and from
every injected fragment alike. What ships is code, data and the job payload. Two changes in this
branch crossed the limit, and neither was paid for by prose: one widened the detection patterns,
which are data.

## Refusing work that cannot succeed

`policy.js` names a login wall, a CAPTCHA and a hard block, all of which look like "the page loaded"
to a naive caller, and returns the route that could work instead. The patterns travel to the
compiled script as data so detection happens before a screenshot is paid for.

The circuit breaker keeps a slow or hostile domain from spending the whole batch. State lives on the
host across calls and enforcement happens inside the script, so `plan()` emits plain data and
`record()` takes the outcomes back. A half-open host gets exactly one probe per cooldown window.

Detection reads the rendered page, so a document that talks about blocking trips it. `detect` is
therefore a caller-settable option that defaults on.

Two things narrow that. The phrases the detector matches are phrases an origin uses to refuse you;
the bare words `blocked` and `forbidden` used to be alternatives on their own, which is how this
tool's own report, listing an item that was blocked, got flagged as blocked itself. And detection
defaults off when every url in the job is a local origin, because a page this machine generated and
served to itself is not a remote origin refusing us. Naming `detect` still wins either way.

## Artifacts

`capture.js` names every file host-side, resolves the read under the session directory, and checks
the final path rather than only the directory, because the working directory arrives in the script's
own stdout and is influenced data rather than a host fact.

Files are attributed through the issuing ledger, never through the order results came back in:
workers finish out of order, so index joins hand one file to two requests. `image.js` verifies the
bytes actually match the format requested, and a failed verification lowers the run status, not only
the item.

## Acting on a page

`actions-run.js` drives by accessibility ref rather than a guessed CSS selector, which is also how a
child frame becomes reachable: its element arrives as an f-prefixed ref that resolves with no frame
API.

A job whose steps could change something does not travel until the caller has said so. `actions`
carrying any verb other than `waitFor`, `waitForLoadState` and `sleepMs` needs `approveWrites: true`;
without it the run is refused before anything is compiled, resolved or spawned, and answers
`needs_input` with code `EWRITEAPPROVAL` and `wants` naming the verbs it wanted. The refusal is an
ordinary result envelope rather than a thrown option error, because the request was well formed and
is waiting on a decision, and because a thrown error keeps only a message and a code across the RPC
boundary — there is nowhere to put the verbs.

The line it draws is the effect ledger, not a second list beside it. Every verb the run issues an
`operationId` for is a verb the caller approves, so the two cannot disagree about what counts as a
change; the suite reads the shipped `__NOEFFECT` set back out of the script and compares it with the
host's copy. Setting `approveWrites` on a job with no such verb is refused, so it cannot become a
habit, and only a real boolean is accepted, because a truthy string reading as consent is the
failure this gate exists to prevent.

Two things it does not cover, both named rather than implied. `browse.attach` reaches the same verbs
by its own path. And a URL whose GET changes state is a change this tool cannot see: the gate governs
what the tool sends, not what the page does.

Staleness is the hazard. The tree is marked dirty by any step that can change it, and a ref step
following a dirty step is re-fingerprinted before it runs. The guarantee is point in time and
nothing can make it otherwise, so every ref step reports `guardAgeMs`, the measured width of the
window between the check passing and the verb running.

## Reading

`read-text.js` answers with one body and a `format` saying whether it came from the fetch path as
markdown or from the browser as rendered text. It reaches the page through `browse.exec` with
`fullText`, so the batch text path and the public read path share one implementation.

## Printing

Two callers print, and both go through the same machinery: a host-issued name, a read jailed under
the session directory, a check that the page is the size that was asked for, and one write.

`report.build` assembles HTML, serves it on loopback and prints that. `captureMany` takes a `pdf`
option and prints a url the caller names. Before that option existed the bytes for an arbitrary url
were produced and counted and then dropped, because the branch that writes runs only when the host
issued a name for the file and `report.build` was the only caller that ever issued one.

Paper is expressed in inches and never as a format name, because the shortcut was measured
producing US Letter while reporting A4. `verifyPageBox` reads the real MediaBox out of the bytes,
and a page that came back the wrong size fails the item with `EPAGEBOX`: a file that exists is not
a page of the size that was requested.

Asking for a pdf without naming a screenshot means a pdf and no screenshot, because paying for both
when only one was wanted is the kind of silent cost this surface exists to remove.
