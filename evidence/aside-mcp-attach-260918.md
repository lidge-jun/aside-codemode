# Aside MCP attachment: measured behavior

Date: 2026-09-18. The client-side runs used Aside CLI 1.26.906.1630 and background
service 1.26.917.1731. This note records the native MCP route only; it does not demote
or replace the existing CLI installation route.

## What was measured

Aside exposes MCP configuration at Settings > Plugins & MCPs > MCPs. Per-account
configuration is stored at `~/.aside/u/<n>/settings.json`, under `mcp.servers` and
`mcp.inventories`.

Two otherwise identical server registrations were compared:

| registration path | initial inventory state | attached tool in a new `aside exec` session |
| --- | --- | --- |
| entry written directly to `settings.json` | **0 tools cached** | absent |
| control: identical server added through the GUI | **1 tool cached** | present |

Registration by itself was therefore not sufficient. Using the GUI's per-server
**Refresh tools** action on the hand-written entry changed it from **0 tools cached**
to **1 tool cached**. A newly created `aside exec` session then listed
`mcp__aside-codemode__execute_code` and could call it. No daemon restart was needed
between the inventory refresh and that new session.

## Protocol capture

The captured MCP exchange showed:

1. The client identified itself as the Aside browser and sent an `initialize` request
   with `protocolVersion` **2025-11-25**.
2. The server's `initialize` response echoed **2025-11-25**.
3. `tools/list` returned **execute_code**.

The initialize and discovery exchange completed without a protocol or tool-schema
error. This separates inventory attachment from protocol compatibility: the server
could complete the handshake even when a manually written registration still had no
cached inventory for agent attachment.

## Spawn environment and first failure

When the background service spawned the MCP server, the child received only **six
environment variables**. Its working directory was the background service's own
application directory, not the project or account directory. The restricted `PATH`
did not contain ripgrep, so the first attached MCP call failed with **ERG404**.

The raw environment values, absolute working directory, account identity, and run
identifiers are intentionally omitted. They are machine records, not facts needed to
judge the result.

## Fix and post-fix result

The server configuration was changed to pin `rgPath` to the absolute path of the
ripgrep binary bundled with the Aside runtime. That binary reported ripgrep 15.2.0
with PCRE2 support and ran with a completely empty environment, so the pin did not
depend on the six-variable child `PATH`.

After refreshing the server inventory and starting a new `aside exec` session, the
agent used `mcp__aside-codemode__execute_code` once. That one MCP call ran
`search.content` and returned rows with `complete:true`, `truncated:false`, and
`partial:[]` in **40 ms**. The agent used no other tool in that run.

## Resident description size

The attached `execute_code` tool description measured **6,775 bytes** when the MCP route
was first proven. It is resident in every MCP session. For comparison only, the account
`AGENTS.md` block measured 3,808 bytes and the installed user skill measured 8,973 bytes
and is loaded on demand.

The same release then moved the per-action synopses out of that description and into the
existing on-demand action catalog, leaving the cross-cutting warnings resident. Measured
after the change with `Buffer.byteLength(TOOL_DEF.description)`: **1,793 bytes**.

What that number does and does not mean. It is a byte measurement of the description, not
a measurement of agent behaviour. The relocation was checked three ways: the suite pins the
call-shape tokens that had to survive, a byte budget now fails the suite above 2,048 bytes,
and `actions.describe('search.content')` was run live to confirm the completeness envelope
and `scope.skippedSymlinks` are reachable on demand. The paired A/B trial that would show a
slimmed description is not WORSE for an agent was not run, so no usability claim is made here.

## Pinless resolution, measured after 0.7.0

The ERG404 above was recorded when the resolver had no candidate for the ripgrep that Aside
itself bundles, so the fix at the time was an absolute `rgPath` pin. 0.7.0 added that bundled
binary to the ladder, ahead of PATH and behind any explicit path, derived from the home
directory on macOS and Windows.

Re-measured on macOS with **no pin at all** (`rgPath: null`): one `aside exec` session called
`mcp__aside-codemode__execute_code` exactly once, ran a fixed-string `search.content`, and got
its row back with `complete:true`, `truncated:false` and `partial:[]`. The agent used no other
tool, so no fallback produced the answer. The explicit pin is now an override, not a requirement.

Which binary served that search is an **inference**, not a direct observation: an MCP response
carries rows and completeness, not the resolved path. It rests on four premises checked at the
same moment. The configured `rgPath` was null; the daemon-spawned child carries the same
six-variable environment that produced the ERG404 above; and the ladder's three fixed macOS
locations — `/opt/homebrew/bin/rg`, `/usr/local/bin/rg` and
`/home/linuxbrew/.linuxbrew/bin/rg` — were all absent. What remains is the Aside bundle.
Install a ripgrep into one of those locations and the inference no longer holds.

## What this does not claim

- No automatic activation: a server registration with **0 tools cached** did not
  attach. The GUI Add flow or per-server Refresh tools action must populate
  `mcp.inventories`.
- Hot-attach behavior for an already running session is unverified. Start a new
  session after refreshing the inventory.
- The 6,775 -> 1,793 byte reduction is a size measurement only. No trial established that an
  agent performs as well with the shorter description.
- Pinless resolution was measured on macOS only. The Windows daemon was not re-measured after
  0.7.0; the earlier Windows run succeeded through the package-vendored relative path instead.
- ERG404 is not structurally impossible. An explicit path that fails still throws it by design,
  Linux has no bundled candidate, and a moved or unexecutable bundle exhausts the ladder.
- The bundled binary serving a search is an inference from the premises above, not a reading of
  the resolved path out of the MCP response.
