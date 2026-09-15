# Overview

aside-codemode gives the Aside browser agent one place to search, filter, read and summarise local
files, and to run many pages through a single browser session and come back with rows. The point is
that intermediate data never enters the model's context: the call returns the answer and the
evidence needed to judge it.

## The product boundary

Aside exec does not attach MCP servers on current builds. The working path is one `bash` call to the
`codemode` CLI plus a rule in the account's `AGENTS.md`. File cards in the Aside UI still come from
native `read_file` / `write_file` / `edit_file`, and a guest write from the CLI is not one of those
cards.

The package runs on Node 18 or later, on macOS and Windows, and needs ripgrep on PATH or a vendored
binary. It has no runtime dependencies and no lockfile.

## Three execution paths

Native Aside tools are the default: a first look, one file, anything the user should watch happen.

The Aside REPL runs Playwright-style JavaScript against the signed-in profile, with a 120 second
ceiling. The batch helper `cm` runs there and owns the part a hand-written loop gets wrong: how many
tabs are open at once, closing a tab whose item threw, and refusing to call a run finished when it
was not.

The CLI is this package. `bin/` holds the entry point, `bin/codemode.mjs`, and `src/cli.js` parses
the invocation behind it. Guest code arrives as `--code-file`, as `--code -` on stdin, or as
`--code` for a short expression with no quotes of its own.

## What the guest may reach

Guest code is an async function body evaluated in a vm context, not in Node. `src/sandbox.js` builds
that context and `src/host/globals.js` injects what the guest gets:

    search  fs  actions  browse  report  api  recipes
    read_file  write_file  edit_file  apply_patch  console

`src/host/namespaces.js` assembles those namespaces. There is no module loader: a dynamic import is
translated at the edge into `EGUESTIMPORT` and answered with the list of names the guest actually
has, while `require` was never defined and throws Node's own words. `process`, `fetch`,
`setTimeout`, `URL` and `Buffer` are absent, and code cannot be built from a string.

**The sandbox is a shape, not a security boundary.** It exists so a batch cannot quietly depend on
something the host never promised. Nothing here is written to survive hostile guest code.

## Asking rather than guessing

`src/tools.js` carries the tool description, and the `actions` namespace answers the question a
first call usually gets wrong:

    actions.find('browse')
    actions.describe('browse.exec')
    actions.check('browse.exec', { urls: ['https://x'] })

`describe` returns the signature and every input. `check` validates a call without making it, using
the same validator the real call uses, so a combination it accepts is a combination that runs.

## Invariants

- An option Aside cannot honour is refused before a process is spawned, with the valid list named.
- A run never trusts the Aside CLI's exit code; success is the trailing marker plus inspection.
- The script's own deadline is always earlier than the host's, because a killed CLI leaks its tabs
  permanently and no later session can close them.
- A result that came back is reconciled against what was asked for, never counted on its own.

