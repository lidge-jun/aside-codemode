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

The attached `execute_code` tool description measured **6,775 bytes**. It is resident
in every MCP session. For comparison only, the account `AGENTS.md` block measured
3,808 bytes and the installed user skill measured 8,973 bytes and is loaded on demand.
These measurements do not establish a prompt-size reduction.

## What this does not claim

- No automatic activation: a server registration with **0 tools cached** did not
  attach. The GUI Add flow or per-server Refresh tools action must populate
  `mcp.inventories`.
- Hot-attach behavior for an already running session is unverified. Start a new
  session after refreshing the inventory.
- No reduction of the **6,775-byte** resident tool description has been made yet.
- The result does not make native MCP the default and does not deprecate the CLI
  route. They are two supported installation paths.
