# What --force costs, and what comes back: measured

Date: 2026-09-18, macOS, Aside CLI 1.26.906.1630, account `u1`. The account had one working
MCP server (`aside-codemode`) and one deliberately unreachable probe server whose command
pointed at a path that does not exist.

## How the run was produced

A watcher polled the account settings every 200 ms while `codemode --install-mcp --account u1
--force --json` ran. The probe server was registered through `aside repl` before each run and
removed the same way afterwards.

## Measured timeline

| t | what the settings said |
| ---: | --- |
| 0.2 s | version 1, both servers enabled, our inventory cached |
| 1.4 s | version 0, inventories empty — our write |
| 2.0 s | version 1, our inventory cached, **the probe server disabled** |
| 3.6 s | version 1, our inventory cached, **the probe server enabled again** — our restore |

Aside disabled the server it could not reach, which is the behaviour the refusal guard exists
for. The run that produced this table reported `restored: ["codemode-unreachable-probe"]`.

## The race this found

The first implementation restored immediately after the discovery session exited, and reported
nothing to restore while the settings ended up with the probe disabled. The session process is
gone before Aside finishes the migration it started: 1.4 s against 2.0 s in this run. The
version key alone cannot tell the two moments apart, because it reads the same before the write
and after the migration. The marker that only the migration produces is a new `refreshedAt` on
this server's cached inventory, so that is what the restore waits for, with the version key as
the fallback for an account that had no inventory at all.

## The other thing the probe found

`aside repl` refuses a script that mentions a module loader: embedding the snapshot verbatim
failed with `External modules are not available in the REPL`, because the snapshot carries this
project's own tool description, which explains that `import()` and `require` do not exist in the
guest. The payload now travels base64-encoded and is decoded inside the daemon.

## What this does not claim

- The abort path, which writes the whole snapshot back after a failed discovery session, was
  not exercised against the real daemon. It is covered by an injected-failure test only.
- One unreachable server, one machine, one run of each shape. The 1.4 s and 2.0 s are that
  run, not a schedule.
- The cached inventory of the disabled server was not restored, by design. It came back on its
  own only in the sense that Aside will rediscover it; this run did not wait to watch that.
- Nothing here says a forced install is a good idea on a machine with servers you care about.
  It says what it costs and what it gives back.
