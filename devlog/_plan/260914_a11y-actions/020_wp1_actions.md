# 020 — wp1, the action list

## NEW src/host/browse/actions-run.js

`ACTION_STEP_SRC`: one function text, injected into both generated scripts, exactly the
way `TREE_SUMMARY_SRC` is, so the unit test exercises the shipped code.

    async function runActions(page, steps, budgetMs, nowFn)

Each step: `{ ref } | { selector }` plus exactly one verb.

    click, dblclick        locator.click / .dblclick
    fill: string           locator.fill
    type: string           locator.type
    press: string          locator.press
    hover                  locator.hover
    focus                  locator.focus
    check / uncheck        locator.check / .uncheck
    selectOption: string   locator.selectOption
    scrollIntoView         locator.scrollIntoViewIfNeeded
    waitFor: selector      page.waitForSelector
    waitForLoadState: s    page.waitForLoadState
    scroll: 'top'|'bottom'|{y}   page.evaluate(window.scrollTo)
    goBack / goForward / reload  page.*
    sleepMs: n             bounded pause between steps

Per step it returns
`{ i, verb, target, targetKind: 'ref'|'selector', via, ok, ms, error?, code? }`.
`via` is `'locator'` or `'page'`. A verb the surface refuses gets `ok:false` and
`code:'ENOTSUP'` with the thrown message, never a silent success.

Rules baked in:
- A step never enumerates the locator to decide whether a method exists. The probe
  proved enumeration returns []. Call it, catch, report.
- Each step gets its own budget slice and the loop stops at the shared deadline
  with `code:'EDEADLINE'` on the steps it did not reach, so a half-run is visible.
- `stopOnError` defaults true. With it false the run continues and every failure is
  still reported.
- Targets are JSON-embedded, never concatenated, so a quote, backslash or newline
  in a selector cannot close the generated string.

## MODIFY src/host/browse/schema.js

`actions`, `stopOnError`, `allowStaleRefs`, `refsFingerprint` and `actionBudgetMs`
join JOB_KEYS. `validateActions(raw)` enforces: array, <= 20 steps (A2, because a
measured click cost 2,143ms), exactly one target key, exactly one verb key,
string/int types, an affirmative value for value-less verbs, and an optional
per-step `timeoutMs`. Unknown keys are refused by name.

## MODIFY src/host/browse/script.js

Actions run after navigation and the render check, before extract and capture, so
`extract` sees the post-action DOM. `out.actions` carries the step array;
`out.ok` is false when a step failed and `stopOnError` was on. The batch adds
`partial:['action-failed']` the same way it reports content-unverified.

## MODIFY src/host/browse/attach.js + attach-schema.js

Same `actions` list against the live tab. The tab is still never closed.

## MODIFY src/host/browse/probe.js

CAPABILITY_MATRIX gains `locator.present` and a note that page-absent does not mean
surface-absent. The refusal list is unchanged.

## Tests, test/browse-actions.test.js

Schema refusals; generated-source injection; an AsyncFunction run of the real
step function against a fake page recording the calls; ENOTSUP on a throwing verb;
deadline truncation; stopOnError both ways; and an injection case whose selector
carries a quote, a backslash and a newline.
