# Operating notes — code mode, 2026-09-16 (0.3.0)

What an account gets, how to read what comes back, and the places this surface behaves
differently from what a reasonable person would assume. The 0.2.0 notes still apply where
this file is silent; everything below either changed in 0.3.0 or was measured again.

## Which path to take

Native first. A page you have not seen, a single click, a fresh visual judgement, anything
needing an account or an approval: work the way you normally do. Batch only when the steps
repeat, the items do not depend on each other's state, and you can say in one sentence what
a finished item looks like.

## Loading the helper

The installed skill prints an absolute path for the account it was installed into, and that
is the line to use:

    const src = await fs.readFile("<accountRoot>/codemode/cm.js", 'utf8'); (0, eval)(src);

The session-relative form `../../codemode/cm.js` works under `aside repl` only. The in-app
agent REPL resolves relative reads from the account root, where that form leaves the account
root and the fs guard refuses it with `Path escapes Project and session roots`. The path
carries its own quotes in the document because an account root can contain an apostrophe.
Do not re-quote it.

## The guest is not Node

`--code` runs in a vm context. There is no module loader: `await import('node:fs')` comes
back as `EGUESTIMPORT` with the list of names you do have, and `require` was never defined,
so it throws a plain ReferenceError. `process`, `fetch`, `setTimeout`, `URL` and `Buffer` are
absent too. Injected instead:

    search  fs  actions  browse  report  api  recipes
    read_file  write_file  edit_file  apply_patch  console

A guest that catches its own rejection sees Node's words, not ours: the translation happens
at the edge. Read files with `read_file`, reach the network through `browse`.

## Call shapes that cost a first attempt

`search.files` matches paths with `pattern` (a substring, not a glob) and/or `glob`.
`search.content` and `search.count` match contents with `query`. All three require `path`.
Passing the wrong name is refused with the right one; when the value looks like a glob the
refusal offers both, because either could be what you meant.

`browse.readText` takes a URL string or `{ url }`. The body is `text` and `format` says
whether it is `markdown` (the fetch path converted the html) or `text` (the browser's
rendered body). There is no `markdown` field any more. A large body is still cut to fit the
envelope, so compare `chars` with what you received before calling it the whole page.

`browse.exec` and `browse.attach` accept `treeNodes: true`, which adds `snapshot.nodes`:
one `{ depth, role, name, ref, attrs, line }` row per node. Group by walking forward while
`depth` exceeds the parent's. It is off by default because it costs payload. Two limits:
`interactive` mode has no text or heading rows, so a grouped read needs `tree`; and a child
frame whose rows arrive without indentation cannot be grouped by depth — use its `f`-refs.

## Symlinks are stepped over, and now say so

Links are never followed. `scope.skippedSymlinks` reports `{ dirs, files, examples, capped, scanned }`.
A skipped **directory** also sets `complete: false`: a subtree can hide behind it, and neither
`noIgnore` nor `hidden` will bring it back — point `path` at the link target instead. A
skipped **file** link is counted without lowering completeness. The census does not read
`.gitignore` and stops after a bounded number of entries (`capped: true` says so).

## Browsing is opt-in

    codemode --enable-browse

One command, run once. It writes `browseCaps.enabled` into the user config and changes
nothing else, no-ops when already on, and refuses invalid JSON with `EBADCONFIG` rather than
overwriting it. It runs before the config is loaded, so a broken file can still be repaired.
Uninstalling the account skill does not turn it back off.

## Two surface facts worth knowing

**Windows needs the tab in front for a screenshot.** `tab.screenshot()` returned
`browser CDP command timed out while capturing viewport screenshot` when the tab was not
frontmost. `bringToFront()` first fixed it, and even then one run in four still timed out.
Treat a screenshot timeout there as the surface being unavailable at that moment.

**A snapshot fixture cannot be a `data:` page with an `srcdoc` iframe.** A `data:` URL has
an opaque origin, so the child is cross-origin: its controls are absent from the
accessibility tree and `contentDocument` reads back null. Serve it over loopback instead.

## Installing, and what the verbs do

    node scripts/install-codemode.mjs <install|upgrade|repair|uninstall|rollback|doctor> [--account <id>] [--json]

Always pass `--account`. Without it the installer follows `accounts.json`'s
`currentAccountId`, which can change under you.

`doctor` reports `upToDate`. A file that matches the manifest but not this build reads
`stale`: the machine is behind a release, not healthy. Note that a release which changes only
templates still makes an account stale even though `HELPER_VERSION` did not move — 0.3.0 is
exactly that release.

`upgrade` keeps a file you edited and names it in `preserved`. `repair` writes only what is
missing, which means a file this release ADDED is not what repair is for: it is classified
`new`, not `missing`, and `upgrade` is the path.

`rollback` restores the previous generation without looking at the disk, so an edit made
after the upgrade is overwritten. New in 0.3.0: it also REMOVES files the generation it
restores never had, and lists them in `dropped`. Only untouched ones go; a file you edited
stays. Before this, rolling back to 0.2.0 left the 0.3.0 files behind under a manifest that
did not know them, and doctor called our own file `new`.

`uninstall` removes only files whose hashes still match, leaves files you edited, takes the
managed block out of `AGENTS.md` while leaving the rest of that file alone, and — also new
in 0.3.0 — actually removes the directories it emptied. `rmSync` without `recursive` throws
EISDIR on a directory and the catch around it had been swallowing that.

## What is collected

Nothing is sent anywhere. The install writes a manifest under the account root and this
repository keeps the probe transcripts in `evidence/`. Screenshots and page content stay in
the session that produced them.

## npm

The package is publishable and was not published. What ships, what does not, and why the
vendored ripgrep now carries its own notices is in
`devlog/_plan/260915_agent-friction/070_w8_npm.md`.
