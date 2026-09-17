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

The activation script called `aside.settings.set('mcp', { servers })`. The value passed
to `set` deliberately omitted both `toolInventoryMigrationVersion` and `inventories`.
`set` replaces the complete `mcp` object with exactly that value, so the daemon's live
copy read back with migration version **0** and an empty inventory map. That live reset
is the step a direct write to `/Users/someone/.aside/u/1/settings.json` cannot perform,
because the daemon retains its own copy of settings.

The following ordinary session ran discovery. After it exited, the account settings
contained `inventories["aside-codemode"].tools = ["execute_code"]`.

## Measured result

The `settings-set` step exited **0** and read back migration version **0** with an empty
inventory map. The discovery session also exited **0**. Total wall time for the command
was **17 seconds**. No settings window was opened, and the daemon was not restarted.

## Refusal guard

Replacing the complete `mcp` object drops every other server's cached inventory, so
those servers have to be rediscovered. Aside's migration disables a server it cannot
reach and does not retry it. For that reason, `--install-mcp` refuses activation when
another enabled MCP server or another cached inventory exists. The refusal prints the
two commands that would have run. `--force` is required to proceed despite that risk.

## What this does not claim

- The run does not show that forcing activation is safe for an offline server. Aside can
  disable an unreachable server during migration and never retry it.
- The run does not show that direct `settings.json` writes update the daemon's live
  settings. The measured activation used `aside repl` specifically to reach that copy.
- The **17 seconds** is one measured macOS run, not a duration guarantee for other
  accounts, machines, Aside versions, or MCP servers.
- The run proves discovery for `aside-codemode` and its single `execute_code` tool. It
  does not establish hot attachment to a session that was already running.
