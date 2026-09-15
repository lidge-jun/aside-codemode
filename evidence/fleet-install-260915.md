# Fleet install — 2026-09-15, main 65158ba

Every SSH host that has Aside now has code mode installed. Written from the machines rather
than from memory: each row below is a `doctor --json` read taken after the install.

## Which hosts have Aside

Thirteen SSH hosts were probed for `~/.aside/u` and an Aside CLI. Three have it, plus this
laptop:

| host | os | accounts present | installed into |
| --- | --- | --- | --- |
| MacBook (local) | darwin | 0, 1, 2 | 0, 1, 2 |
| macmini-cf | darwin | 0-6 | 1 |
| mini | win32 | 0 | 0 |
| suji | darwin | 0, 1, 2 | 2 |

The rest have no Aside and were left alone: `cli-jaw-server`, `clisu-oracle`, `cursor`,
`lidge` (Linux, and there is no Linux Aside build), `desktop-c795oh4` (Windows, no `~/.aside`),
and `intmb` (a Mac with neither the app nor the account root). `ocx-ci`, `oracle` and `win` did
not answer ssh and were not reached.

## State after the install

| host | account | helper | upToDate | AGENTS block | files |
| --- | --- | --- | --- | --- | --- |
| MacBook | 0 | 1.1.0 | true | current | all ok |
| MacBook | 1 | 1.1.0 | true | current | all ok |
| MacBook | 2 | 1.1.0 | true | current | all ok |
| macmini-cf | 1 | 1.1.0 | true | current | all ok |
| mini | 0 | 1.1.0 | true | current | all ok |
| suji | 2 | 1.1.0 | true | current | all ok |

All six carry the same helper, `f5584a8081bd…`, and none reported a preserved file, so nothing
on any machine had been edited by hand since its last install.

## Browsing is on, checked on each machine

This release turns browsing on by default, which is only true if the machine agrees:

    MacBook      {"enabled":true}  175ms
    macmini-cf   {"enabled":true}  1094ms
    mini         {"enabled":true}  664ms
    suji         {"enabled":true}  368ms

A guest round trip (`return 1+1`) was also run on each remote host and answered in 14-20ms.

## What was new here

`suji` had never had code mode. It got `install`, not `upgrade`, into account 2 - the account
`accounts.json` has as current. Accounts 0 and 1 there are untouched and report no install, which
is accurate rather than broken. Same for macmini-cf accounts 0 and 2-6.

The other three hosts were already on 0.3.0-era installs and were brought to main 65158ba.
Backups ran first on every host (`backup-accounts.mjs`), and no live `uninstall`, `rollback` or
`repair` was used, same rule as the last two releases.

## Node used, per host

    MacBook      node on PATH, v24.17.0
    macmini-cf   ~/.nvm/versions/node/v24.20.0/bin/node
    mini         C:\nvm4w\nodejs\node (node on PATH under Git Bash)
    suji         ~/.nvm/versions/node/v24.18.0/bin/node

suji and macmini-cf have no node on the non-login PATH, so the absolute path is what the install
ran under and what the AGENTS block records.
