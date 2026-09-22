# Browse surface

Everything under `src/host/browse/` exists to turn a list of urls into rows without opening a tab
the caller cannot account for. One module spawns Aside, one compiles the script, one validates the
job, and the rest are the checks that keep a batch honest.

## Execution context

`context.js` validates and freezes the optional account and host selectors. Every run path and raw
REPL path builds its command from that same value, placing `--account` and `--host` before `repl`.
The requested context also scopes cache keys, pending approvals, and tab journals, so work requested
for one account or host cannot reuse another context's browser state. A partial selector leaves the
other identity unresolved, so it disables shared cache and approval persistence and uses a private
tab journal; the literal word `inherited` is never used as a reusable identity. With no selector,
the existing Aside-inherited behavior and local current-account cache scope remain unchanged.

A remote REPL may return ordinary rows and text. Artifact APIs need a stronger contract because the
`pwd` printed by a remote session is not a local filesystem fact. There is no verified transfer path
in this package, so `browse.captureMany` and `report.build` refuse remote-host materialization before
spawning instead of passing the remote path to local file APIs.

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

What the tool promises everywhere is narrower than what the schema accepts, and the suite pins both
halves. The ordinary acting and reading jobs — twenty urls with an interactive snapshot, a
fingerprint, a snapshot afterwards and one step — fit 30,000 on any host, with the headroom stated
in characters so the next change knows what it has. The combinations past that envelope are
asserted to be past it and to fit 50,000, so nothing quietly drifts from one side to the other.

Past the ceiling the answer is a refusal, not a surprise. `ESOURCETOOLONG` names the size, the
limit, the platform that set it and what to drop, and it is raised before a process exists. It also
names where the size went: the characters the urls account for, and the length and scheme of the
longest one. That breakdown exists because "drop helper, snapshot, actions or some urls" reads as a
nudge toward fewer urls, and the measured case was one 65 KB `data:` url carrying a whole document
on the wire. When the longest url is a `data:` url the refusal says so and names the replacement:
serve the document over http from loopback, which the browser reaches, and pass the short url. Both
entry points check: the job path and `session.raw`, which browse's other surfaces compile their own
source for and which used to skip the check, so a caller who injected a helper learned about it from
the operating system instead.

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

## Whose tab is whose

The tool measured this about itself: a killed CLI leaks its tabs permanently and no later session
can close them. The reason was never that closing is hard — nothing recorded which tabs were ours,
so a browser ends up holding a mix of the person's tabs and ones abandoned by a run that died, with
no way to tell them apart. The accessibility REPL has nowhere to stamp an owner: there is no per-tab
metadata field and no setter for one, and the only identity a tab has is the `targetId` the browser
assigns.

So ownership lives on the host. The script prints a line the moment a tab exists and the moment it
stops existing, and `tab-journal.js` keeps, per run, the tabs that were opened and never reported
closed. `browse.leakedTabs()` names a tab only when all of this holds: it is in the journal, it was
never closed, the run that opened it is no longer running, and it is open in the browser right now
**at the same url**. The url is load-bearing rather than decorative — browsers reuse target ids, so
an id we recorded can come back attached to a tab the person opened themselves. The cost is that a
tab of ours they navigated away from stops being recognised, which is the direction to be wrong in.

"No longer running" is judged two ways, because a process cannot ask whether it is alive. A record
written by another process is checked against its pid; a record this process wrote itself is judged
by age instead, and is only a candidate once it has gone stale.

A tab outside the journal is never a candidate for anything, and that is the whole of the guarantee
that somebody's own tabs are left alone — deliberately the conservative direction, because a tab we
lost track of is a mess while a tab we wrongly claimed is someone's work disappearing.

It reports and stops there. Closing is not promised: the same measurement that found the leak found
that a known `targetId` could not be closed either, and tabs sitting in a person's own browser are
theirs to decide about.

A caller who names a tab is never handed a different one. `browse.attach` selects by `targetId`,
else `urlIncludes`, else `titleIncludes`, else the active tab, and only that last branch is
implicit — a named tab that is gone answers `ETABGONE` and stops, where a selector that matched
nothing answers `ENOTAB`. The two are separate codes because an undifferentiated failure makes a
model retry a navigation that cannot work.

A tab that was in the list and gone by the time it was attached reads the same way. That race used
to surface as a generic attach failure, which is the undifferentiated answer the split exists to
stop producing.

`ETABGONE` carries what a recovery needs: the `targetId` asked for, the tabs that are open, and
`lastUrl` with `boundAt` when the journal knew that tab. A tab this tool never opened leaves those
null rather than a guess, and so does an id the journal saw at two different pages — a reused id
answers nothing rather than the newer page, because a wrong page given confidently is worse than no
page. It also says `effectsUnknown`, since a tab vanishing is an observation about the tab: if a
write was sent before it went, that write's outcome is not known, and `ok: false` must not be read
as nothing happened.

The journal is written once per run, when the run settles, including when it was killed — the
spawner hands back the whole transcript at once, so there is no earlier seam to write from. That
bounds what it can cover: a run whose host process dies before it writes leaves tabs this cannot
name. The window is narrower than it was, not closed.

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

`browse.attach` is covered now. It compiles its own source and calls the REPL directly, so
`session.run` never saw it, and it reached the same verbs on the tab the person is signed into and
looking at — the more dangerous of the two paths, and the one with nothing in front of it. It takes
the same `approveWrites` declaration, refused the same way but in attach's own flat shape, because a
caller reading one surface should not have to learn the other to understand being turned down.
Naming a `targetId` chose where, not what may be done there.

It also issues a run id and reports `effects`. Before this an attached click produced no ledger
entry at all: the call passed neither a run id nor an effect callback, and `session.raw` answered a
failed marker with no transcript, so a click that went out and then lost its process left nothing
behind. Requested and never confirmed reads `indeterminate` here, the same vocabulary the batch
answers in, and it survives the failure that follows it.

What still is not covered: a URL whose GET changes state. The gate governs what the tool sends, not
what the page does.

The refusal carries an `approvalId`, and `browse.approve` runs that stored job for the first time
under its own `runId`, which the returned envelope carries back beside the `approvalId` so the pair
can be joined. It is not a resume: nothing was started, which is the reason the gate sits before
the compile. The job that runs is the validated, frozen one the refusal saw, so approving cannot add
an option that was never shown.

Approval surfaces race, so every answer states what the record is rather than what the caller hoped.
One caller wins a `rename`; a second `approve` runs nothing and answers `changed: false` with the
state it found and the `runId` of the attempt that did happen. `browse.reject` settles only a
pending record: a claimed one comes back as `claimed`, never as rejected, because by then the steps
may have gone out. `rename` cannot carry the new `runId` with it, so a winner that stops in between
leaves a claimed record with a null `runId` — neither ran nor did not run, and reported as itself
rather than guessed at. Approvals expire, and an expired one is refused rather than run late.

Staleness is the hazard. The tree is marked dirty by any step that can change it, and a ref step
following a dirty step is re-fingerprinted before it runs. The guarantee is point in time and
nothing can make it otherwise, so every ref step reports `guardAgeMs`, the measured width of the
window between the check passing and the verb running.

For a step that could change something and is aimed by ref, that guard is required rather than
available. `refsFingerprint` must be present, it must be the full `snapshot.fingerprint` rather than
`snapshot.fingerprintStructure` — which compares ref and role only, so a reordered list looks
unchanged to it — and `allowStaleRefs` cannot be set beside it, because that flag skips the
comparison entirely and would leave the first two rules satisfiable by any string of the right
shape. All three are refused before anything spawns, on the batch path and the attach path, from
one definition.

A consequence worth stating: every verb that can be aimed by ref is an effect verb, since the three
that are not — `waitFor`, `waitForLoadState` and `sleepMs` — take a selector or nothing. So
`allowStaleRefs` no longer has a use alongside a ref-aimed step at all, and the catalog says so.

There is no `guardAgeMs` threshold. A number would have to come from somewhere, and nothing here
has measured what age is too old.

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
producing US Letter while reporting A4. A stylesheet may still own the page: `preferCSSPageSize`
and a four-sided `margin` pass through to the print call, so a document written against
`@page { size: A5; margin: 20mm }` paginates the way a browser prints it rather than being scaled
onto the requested sheet with the engine's default margins.

`verifyPageBox` reads the real MediaBox out of the bytes and reports which rule it applied. In the
default mode a page that came back the wrong size fails the item with `EPAGEBOX`: a file that
exists is not a page of the size that was requested. When CSS page size is preferred, a different
size is the point, so the comparison against the requested sheet is dropped — the verifier would
otherwise refuse exactly the documents the option exists for. What it still requires is that the
box be a page: a parseable MediaBox, finite and positive, and the same on every page. The bytes
cannot say which size the stylesheet asked for, so that result carries `measuredOnly` and reports
the size it read rather than claiming the request was honoured.

Asking for a pdf without naming a screenshot means a pdf and no screenshot, because paying for both
when only one was wanted is the kind of silent cost this surface exists to remove.
