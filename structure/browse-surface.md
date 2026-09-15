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

The generated source travels as a command-line argument, so a script over 30,000 characters is
refused with `ESOURCETOOLONG` rather than becoming a platform error that names nothing.

## Refusing work that cannot succeed

`policy.js` names a login wall, a CAPTCHA and a hard block, all of which look like "the page loaded"
to a naive caller, and returns the route that could work instead. The patterns travel to the
compiled script as data so detection happens before a screenshot is paid for.

The circuit breaker keeps a slow or hostile domain from spending the whole batch. State lives on the
host across calls and enforcement happens inside the script, so `plan()` emits plain data and
`record()` takes the outcomes back. A half-open host gets exactly one probe per cooldown window.

Detection reads the rendered page, so a document that talks about blocking trips it. `detect` is
therefore a caller-settable option that defaults on.

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

Staleness is the hazard. The tree is marked dirty by any step that can change it, and a ref step
following a dirty step is re-fingerprinted before it runs. The guarantee is point in time and
nothing can make it otherwise, so every ref step reports `guardAgeMs`, the measured width of the
window between the check passing and the verb running.

## Reading

`read-text.js` answers with one body and a `format` saying whether it came from the fetch path as
markdown or from the browser as rendered text. It reaches the page through `browse.exec` with
`fullText`, so the batch text path and the public read path share one implementation.

## Printing

A guest can already write a verified PDF to disk, through `report.build`. It assembles the HTML,
serves it on loopback, prints with paper dimensions in inches because a named format was measured to
produce the wrong page, reads the artifact back under the same containment a screenshot gets,
verifies the page box against what was asked for, and writes to the caller's path.

What has no path is printing a page the caller names. `browse.exec` accepts a `pdf` option and
reports the byte count, but the branch that writes the bytes runs only when the host issued a name
for them, and `report.build` is the only caller that issues one. `captureMany` takes screenshots and
has no `pdf` option. So the bytes for an arbitrary url are produced, counted, and dropped.

`report.build` also turns block detection off for its own page, because loopback HTML this process
assembled is not a remote origin refusing us, and a report that lists a blocked page renders the
word and would otherwise flag itself. A caller printing their own local page through `browse.exec`
has to know to do the same.
