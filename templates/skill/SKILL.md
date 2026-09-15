---
name: aside-codemode
description: Batch repeated browser and file work from inside Aside, and read a result that says what actually happened. Use when the structure repeats and the items do not share state; stay native for a first look, a single click, or anything needing an account or an approval.
---

# aside-codemode

Native first. This skill is for the moment after you already know the shape of the work:
the same steps over twenty rows, the same read over forty files, the same capture over a
list of urls. If you have not seen the page yet, look at it natively. If one click answers
the question, click it.

## Deciding to batch

Batch when all three hold: the steps repeat, the items do not depend on each other's
state, and you can say in one sentence what a finished item looks like. If items share a
cart, a wizard step, or a single logged-in form, they are one task, not a batch.

A batch is also the wrong tool when the answer is visual and you have not looked yet. Run
one item natively, read what came back, then batch the rest.

## Running one, inside a REPL session

    const src = await fs.readFile({{HELPER}}, 'utf8'); (0, eval)(src);

    const out = await cm.run({
      items: rows.map((r) => ({ url: r.href, row: r })),
      limit: 2,            // tabs working at once
      maxTabs: 4,          // tabs this run may own at all
      deadlineMs: 60000,
      async onItem(tab, item, jobId) {
        return { jobId, title: await tab.evaluate(() => document.title) };
      },
    });

`cm` does not wrap the browser. Inside `onItem` you use the same `tab`, `snapshot`,
`page.locator`, `cua` and `display` you would use by hand. What it owns is the part a
hand-written loop gets wrong: how many tabs are open at once, closing a tab whose item
threw, and refusing to call the run finished when it was not.

That path is this account's own copy, written by the installer. Use it as it stands rather
than a relative one: the two surfaces that read this document do not agree on what a
relative path is relative to. `aside repl` resolves from its session directory, two levels
below the account root, so `../../codemode/cm.js` works there. The in-app agent REPL
resolves from the account root itself, where the same line leaves the account root and the
fs guard refuses it with `Path escapes Project and session roots`. The absolute path is the
one form measured to work on both.

## Reading the result

`cm.run` and the host's `browse.exec` answer with the same keys and the same status
words, so one reader handles both.

    status        completed | partial | failed | needs_input | indeterminate
    items[]       one row per requested item, each with its own jobId
    effects[]     confirmed | indeterminate, per side effect
    tabs          { requested, closed, peak, leaked }
    checkpoint    jobIds that finished, so a rerun can skip them
    complete      true only when status is completed

`completed` means every requested item came back and no tab was left open. Anything else
is a real answer, not a reason to run it again:

- `partial` — some items finished. `checkpoint` says which. Rerun only what is missing.
- `indeterminate` — the run was cut off and may have acted without reporting it. Read the
  page before doing anything again.
- `needs_input` — a login wall or an approval. Hand it back to the user; do not try to
  solve it inside the batch.

An effect that is `indeterminate` was started and never confirmed. Do not retry it. A
second submit is a second order.

## Failure and resume

A failed item names its cause: `EOPEN` the tab never opened, `ETABBUDGET` the run was
already at its tab ceiling, `EDEADLINE` the budget ran out before this item started. None
of them are retried for you, on purpose.

To resume, filter by `checkpoint` and run the remainder with the same `onItem`. Do not
widen `limit` to catch up; the ceiling is what kept the browser usable.

## From a shell instead

When you need the host file tree, many files at once, or a structured result to hand back,
use the CLI. Details, including why `--code-file` is the safe form, are in
[references/execution-paths.md](references/execution-paths.md). Windows quoting and ssh
are in [references/windows-invocation.md](references/windows-invocation.md).
The calls that cost a first attempt - the guest's missing module loader, `pattern` versus
`query`, the shape `browse.readText` wants and the field it answers with, asking for a
parsed accessibility tree, turning browse on - are in
[references/call-shapes.md](references/call-shapes.md). Read it before your first batch
rather than after the refusal.

## Two different browsers

`browse.exec` opens its OWN tab in a fresh Aside session. It reuses the account's cookies,
so a logged-in page works, but it cannot see the tab the user is looking at.

`browse.tabs()` lists the user's real tabs and `browse.attach({ urlIncludes })` reads one
of them — their session, their screen, their scroll position. Attach never opens or closes
a tab. Select by `targetId` or `urlIncludes`; the `id` field carries a `tab:` prefix that
`attachBrowserTab` rejects, and attach strips it for you. Over ssh there is usually no
focused window, so asking for "the active tab" returns `ENOACTIVE`. Name the tab instead.

`ok` is not `contentVerified`. A page can load, return its real title, and still hand you
bootstrap JSON. Pass `minTextChars` or `requireSelector` when the answer depends on what
rendered; without them `contentVerified` is `null`, which means nobody checked.

## What not to do

Do not drive one tab from two places at once. Do not reuse a ref from an older
observation: refs are numbered per observation, and a re-render renumbers them. Do not
retry a side effect whose outcome you do not know. Do not report a `partial` run as done.
