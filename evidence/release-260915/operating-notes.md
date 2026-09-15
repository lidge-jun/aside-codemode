# Operating notes — code mode, 2026-09-15

What an account gets, how to read what comes back, and the two places this surface behaves
differently from what a reasonable person would assume.

## Which path to take

Native first. A page you have not seen, a single click, a fresh visual judgement, anything
needing an account or an approval: work the way you normally do. Batch only when the steps
repeat, the items do not depend on each other's state, and you can say in one sentence what a
finished item looks like.

## Loading the helper

The installed skill prints an absolute path for the account it was installed into, and that
is the line to use:

    const src = await fs.readFile("<accountRoot>/codemode/cm.js", 'utf8'); (0, eval)(src);

The session-relative form `../../codemode/cm.js` works under `aside repl` only. The in-app
agent REPL resolves relative reads from the account root, where that form leaves the account
root and the fs guard refuses it with `Path escapes Project and session roots`. The absolute
path is the one form measured to work on both.

The path carries its own quotes in the document because an account root can contain an
apostrophe. Do not re-quote it.

## Reading a result

`status` is `completed | partial | failed | needs_input | indeterminate`. `completed` means
every requested item came back and no tab was left open. Anything else is an answer, not a
reason to run it again:

- `partial` — some items finished. `checkpoint` lists which. Rerun only what is missing.
- `indeterminate` — the run was cut off and may have acted without reporting it. Do not
  retry a side effect on this status.

## Two surface facts worth knowing

**Windows needs the tab in front for a screenshot.** `tab.screenshot()` on Windows returned
`browser CDP command timed out while capturing viewport screenshot` when the tab was not
frontmost. Calling `bringToFront()` first fixed it, and even then one run in four still timed
out. Treat a screenshot timeout there as the surface being unavailable at that moment, not as
a bug in your script.

**A snapshot fixture cannot be a `data:` page with an `srcdoc` iframe.** A `data:` URL has an
opaque origin, so the child is cross-origin: its controls are absent from the accessibility
tree and `contentDocument` reads back null. Serve the fixture over loopback instead.

## Installing, and what the verbs do

    node scripts/install-codemode.mjs <install|upgrade|repair|uninstall|rollback|doctor> [--account <id>] [--json]

Always pass `--account`. Without it the installer follows `accounts.json`'s
`currentAccountId`, which can change under you.

`doctor` reports `upToDate`. A file that matches the manifest but not this build reads
`stale`: the machine is behind a release, not healthy.

`upgrade` keeps a file you edited and names it in `preserved`. `repair` writes only what is
missing. **`rollback` restores the previous generation without looking at the disk** — an
edit you made after the upgrade is overwritten by it. `uninstall` removes only files whose
hashes still match, leaves files you edited, and takes the managed block out of AGENTS.md
while leaving the rest of that file alone.

## What is collected

Nothing is sent anywhere. The install writes a manifest under the account root and this
repository keeps the probe transcripts in `evidence/`. Screenshots and page content stay in
the session that produced them.
