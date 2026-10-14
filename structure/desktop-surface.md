# Desktop surface

`desktop.*` lets guest code drive native macOS apps through the official Codex Computer Use
engine. It exists for the same reason the rest of code mode does: one model turn should be
able to read an app, pick what matters, act, and check the result, and only the answer should
come back.

## Why a namespace, not another MCP server

A Computer Use MCP server costs one model round-trip per click, and every accessibility tree
and screenshot it returns lands in the context. A chat app's tree is thousands of characters;
its screenshot is over a hundred kilobytes. Inside code mode the guest reads the tree, filters
it with ordinary JavaScript, acts, and verifies, and returns a few lines.

## Transport

The code lives in `src/host/desktop/`: `desktop.js` is the namespace and `desktop-actions.js`
is its catalog.

The host does not speak to `SkyComputerUseClient` directly. That client answers only a parent
it trusts and replies "Sender process is not authenticated" to anything else. The host loads
the `DirectSessionExecutor` from an installed `codex-computer-use-mcp` package, which runs the
OpenAI-signed `codex app-server` with the client attached and verifies both signatures.

One executor lives per server process, not per execution. Element indexes returned by
`get_app_state` are only valid inside the session that produced them, so a guest that reads in
one `execute_code` and clicks in the next must reach the same session. The broker closes it
after `desktop.idleMs` of inactivity. The CLI closes it when its single execution ends.

The abort signal is per execution even though the session is shared: each execution gets a
view of the namespace bound to its own signal. When an execution times out or is cancelled, its
calls stop being sent and `desktop.run` stops before its next step, while the session stays open
for other executions. Concurrent first calls share one start, so only one session is opened.

## macOS responsibility

When Aside launches the chain, macOS treats Aside as the responsible process for every child.
Aside's signature does not carry `com.apple.security.automation.apple-events`, so every call
fails with `bootstrapTimedOut`, and toggling privacy settings cannot fix it. The fix is to
launch the signed `codex` binary with `responsibility_spawnattrs_setdisclaim(1)`, so that binary
answers for itself. `desktop.disclaimLauncher` (or `CU_DISCLAIM_LAUNCHER`) names a launcher that
does this; the broker package must honour that variable at the point where it spawns `codex`.

## Configuration and defaults

Off by default. Driving native apps has a larger blast radius than reading files.

    "desktop": { "enabled": true, "packageDir": "…/node_modules/codex-computer-use-mcp",
                 "disclaimLauncher": "…/disclaim.py", "idleMs": 120000 }

`desktop.status()` reports whether it is on, whether the broker verified, and whether a
launcher is set. It never throws for the disabled case.

## Result shape

Each method returns `{ method, ok, text, image?, error? }`. `text` is the official text content.
A screenshot is returned as `{ mimeType, bytes, omitted: true }` unless the call passes
`{ image: true }` as its second argument. `desktop.run(steps)` executes `{ method, args,
expect? }` steps in order, stops at the first failure or missing `expect` substring, and trims
each step's text to `textChars` (default 300) unless `keepText` is set. A stopped run reports
`complete: false` and `failedAt`.
