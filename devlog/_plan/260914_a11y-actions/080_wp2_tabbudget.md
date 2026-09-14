# 080 — wp2 delivered unit: the tab budget, cleanup, and the dead branch

wp2 was planned as four items. One is gone, two moved, one ships here.

- frame-scoped refs: DELETED. wp1 measured that a child frame element is already
  addressable from the top-level page as an f-prefixed ref.
- post-action diff: moved to wp2c. Three plan audits could not settle the
  comparability test; the reviewer produced a counterexample in each direction.
- ref extraction: moved to wp2b. The read contract needs its own pass.
- tab budget and cleanup: SHIPS HERE. Its design is settled and its open defects
  were named precisely by the round-3 audit.

## The defects being fixed, as the audit measured them

1. A throttle that reads "opened" is a check-then-open race. "opened" is appended
   only after the await succeeds (script.js:202) while the tab is requested earlier
   (script.js:190), and the pool starts every worker concurrently. With the shipped
   concurrency 4 and maxTabs 2, all four workers read owned() === 0 and all four
   open. Peak reaches 4.
2. page.close() sits in a bare catch, so a close that throws skips markClosed,
   leaves the tab open, and the worker immediately opens another.
3. A cleanup budget taken from SLACK_MS is measured against the wrong clock. The
   host deadline starts at process spawn; SCRIPT_STARTED_AT starts after Aside boots
   and parses the generated source. That slack must also cover stringify and stdout.

## MODIFY src/config.js

browseCaps.maxTabs, default 8, validated as a positive integer like its siblings. It
is already read by the doctor payload but has never existed in the defaults.

## MODIFY src/host/browse/script.js

Counters that move at INTENT, not at success:

    let tabsRequested = 0, tabsClosed = 0, tabsPeak = 0;
    function owned() { return tabsRequested - tabsClosed; }

tabsRequested increments immediately before openTab and is rolled back on the EOPEN
path, the only place a request never becomes a tab. That is what removes the race: a
worker that has decided to open is already counted when the next worker checks.

The single throttle point, immediately before openTab:

    for (let w = 0; w < 20 && owned() >= JOB.maxTabs && !deadlineHit; w++) await sleep(50);
    if (owned() >= JOB.maxTabs) {
      items.push({ url: item.url, ok: false, code: 'ETABBUDGET', owned: owned(), max: JOB.maxTabs });
      return;
    }

Bounded at 20 slices and re-reading deadlineHit each time, so it cannot deadlock and
cannot starve silently. The url is reported, never dropped.

markClosed increments tabsClosed and is the only decrement point. tabsPeak is sampled
after each successful open.

cleanup() changes from a serial loop to one Promise.allSettled raced against a single
budget derived from the time actually left:

    const budget = Math.max(250,
      SCRIPT_STARTED_AT + JOB.innerMs + JOB.slackMs - Date.now() - 400);

slackMs is passed in from deadlineMath so the script knows the real figure instead of
assuming it owns SLACK_MS. The 400ms holdback is for stringify and the stdout write.
Tabs still open when that budget expires are reported through leakedUrls, unchanged.

The final payload gains tabs: { requested, closed, peak, max, leaked }.

## MODIFY src/host/browse/actions-run.js

Delete verifiedClean and the "verifiedClean && !dirty" early return. The audit
verified the branch is provably dead: verifiedClean is set only after a passed guard,
every ref verb dirties before the next guard, and sleepMs — the only inert verb — has
target 'none' so it can never be a ref step. A comment is a weaker guard than absence.

## MODIFY src/host/browse/schema.js

maxTabs and slackMs reach the job payload from browseCaps and deadlineMath.

## NEW test/browse-tabs.test.js

- 20 urls, maxTabs 2, concurrency 4: all 20 reported, tabs.peak <= 2
- the race: four workers entering together never exceed maxTabs, because the counter
  moves at intent. This test fails against a counter that moves at success.
- a close that throws does not decrement the counter, and the url appears in leakedUrls
- EOPEN rolls the request back, so a page that never opened does not wedge the pool
- cleanup runs every close concurrently under ONE budget, not one budget each
- the compiled script no longer contains verifiedClean

## Acceptance

Every test above green, full suite green, one independent audit round, pushed to dev,
deployed to the three machines, and a live run showing tabs.peak <= tabs.max.

