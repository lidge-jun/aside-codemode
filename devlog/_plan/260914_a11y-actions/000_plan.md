# a11y actions — drive the page by ref, not by guessed selector

## Why

codemode can now READ Aside's accessibility tree (9536398). It still cannot ACT on it.
That leaves the expensive half on the table: an agent that can see
`link "공지" [ref=e18]` but cannot click it has to come back to the model for
every step, and a measured round trip costs ~4.5s against a 35ms snapshot.

## What the probe changed

Two assumptions in the shipped capability matrix turned out to be wrong, and both
made the feature look harder than it is. Measured on macbookpro-2, CLI
1.26.906.1630, 2026-09-14, evidence in 010_probe_evidence.md:

1. `press`, `hover`, `selectOption`, `textContent`, `innerText`, `boundingBox` and
   `isVisible` are absent on the **page**, which is what the matrix records. They are
   all **present on the locator**. So there is nothing to emulate: no synthetic
   KeyboardEvent, no manual select dispatch. Call the locator.
2. A child frame's elements are already addressable from the top-level page. The
   iframe's button came back as `[ref=f1e1]` and `page.locator("f1e1").click()`
   clicked it, confirmed by reading the child document afterwards. There is no
   frame plumbing to write. The ref namespace crosses frames on its own.

That collapses the planned "frame-scoped refs" work into nothing, and turns the
action layer into a thin, honest wrapper over `page.locator(target)`.

## Work phases

- wp1 a11y interaction core: an ordered `actions` list on browse.exec and browse.attach
- wp2 post-action snapshot diff, ref-addressed extraction, and a tab budget
- wp3 fleet: push to dev, deploy to three machines, prove each live

## Non-goals

Merging dev into main. Not authorized, and it stays that way.
Request interception and viewport control: measured ENOTSUP, unchanged.

## Done means

Every criterion in the bound goalplan is met with captured output, the full suite
is green on Windows, CI is green on 5 combos for the pushed head, and each of the
three machines answers a live probe that performs a real ref action.

