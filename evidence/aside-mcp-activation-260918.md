# Aside MCP activation through the daemon: measured behavior

Date: 2026-09-17. The run used Aside CLI 1.26.906.1630 on macOS with account
`u1`. This note records the daemon-routed activation performed by
`codemode --install-mcp`; it does not replace the separate attachment and protocol
measurements.

## How the run was produced

The command was run once against an account where `aside-codemode` was safe to
activate. Its `settings-set` step sent JavaScript through `aside repl`, and its
`discovery-session` step started one ordinary Aside session. The installer then read
the account's `settings.json` to check the inventory written by Aside.

`aside repl` is the relevant route because it runs inside the Aside daemon and exposes
`aside.settings.get`, `aside.settings.getAll`, and `aside.settings.set`. Aside has no CLI
command that registers an external MCP server: `aside mcp` starts a server over stdio,
while `aside settings` only exposes `save-sessions` and `set-default-profile`.

The activation script called `aside.settings.set('mcp', next)`, where `next` is the
account's own `mcp` object with our server merged into `servers` and with
`toolInventoryMigrationVersion` and `inventories` deleted. `set` stores exactly the
object it is handed, so omitting both of those keys leaves the daemon's live copy reading
back migration version **0** with an empty inventory map. Only those two keys are removed:
the first measured probe sent `{ servers }` alone, which would also have dropped any other
key the object carried, and nothing else under `mcp` belongs to this project. That live
reset is the step a direct write to `/Users/someone/.aside/u/<n>/settings.json` cannot
perform, because the daemon retains its own copy of settings.

The following ordinary session ran discovery. After it exited, the account settings
contained `inventories["aside-codemode"].tools = ["execute_code"]`.

## Measured result

The `settings-set` step exited **0** and read back migration version **0** with an empty
inventory map. The discovery session also exited **0**. The first measured run, which
registered a server the daemon had not connected to before, took **17 seconds** end to end.
A later run of `codemode --install-mcp --account u1 --json` against an already-registered
server took **3 seconds** and came back with `activated: true` and
`tools: ["execute_code"]`. No settings window was opened in either run, and the daemon was
not restarted.

## The same command on Windows

The package was installed globally from a local tarball on a Windows host (Node v24.16.0)
and `codemode --install-mcp --json` was run there. The first attempt reported
`activated: false` with an empty inventory while both steps exited 0: the registered entry
named `--config <package>/codemode.config.json`, which a published package does not contain,
and the server treats a config it was told to read but cannot as fatal. That is why the
entry now names `--config` only when the file exists. After that change the same command
returned `activated: true` with `tools: ["execute_code"]`, and the account's doctor row read
`activated` with `pointsToThisInstallation: true`. A search through the installed guest on
that host returned 25 rows with `complete: true`.

This is also the measurement that the refusal guard was not exercised on either host: both
accounts had `aside-codemode` as their only MCP server.

## Refusal guard

Deleting `inventories` drops every other server's cached inventory too, so those servers
have to be rediscovered. Aside's migration disables a server it cannot reach and does not
retry it. For that reason, `--install-mcp` refuses activation when
another enabled MCP server or another cached inventory exists. The refusal prints the
two commands that would have run. `--force` is required to proceed despite that risk.

## What this does not claim

- The run does not show that forcing activation is safe for an offline server. Aside can
  disable an unreachable server during migration and never retry it.
- The run does not show that direct `settings.json` writes update the daemon's live
  settings. The measured activation used `aside repl` specifically to reach that copy.
- The **17 seconds** is one measured macOS run, not a duration guarantee for other
  accounts, machines, Aside versions, or MCP servers. The Windows run was not timed.
- Neither run exercised `--force`, so the cost of rediscovering someone else's servers
  remains unmeasured.
- The run proves discovery for `aside-codemode` and its single `execute_code` tool. It
  does not establish hot attachment to a session that was already running.
