# 020 — architect proposal + reflection

Architect handle: [WINHIDE](59f0b8dc-58e6-4122-a091-913c00ee9c0d). First proposal: ALIGNED (C2).

## Main dispositions

| ID | Architect | Main |
| --- | --- | --- |
| WINHIDE-D1 | omit `windowsHide` unless env `'1'` | ACCEPT |
| WINHIDE-D2 | leaf `src/child-opts.js` `rgChildOpts` | ACCEPT |
| WINHIDE-D3 | no `shell: true` | ACCEPT |
| WINHIDE-D4 | no retry-without-hide | ACCEPT |
| WINHIDE-D5 | wire `rg.js:73,98` + `rg-stream.js:69`; `where.exe` OUT | ACCEPT; plan typo `timeoutMs` → `timeout`; pass resolver `env` |
| WINHIDE-D6 | env-only, not `loadConfig` | ACCEPT; README residual this cycle |
| WINHIDE-D7 | helper tests, not live Aside spawn | ACCEPT + test 4 env-wins-over-extra |
| WINHIDE-D9 | stream uses `process.env` | ACCEPT |

## Gaps folded into 000/010

1. `timeout` not `timeoutMs` (`src/rg.js:73`).
2. Resolver calls `rgChildOpts({...}, env)`.
3. Test 4: env `'1'` overwrites `extra.windowsHide: false`.
4. `where.exe` named OUT.
5. Version-probe spy dropped; helper-only tests.

Reflection (same architect 59f0b8dc): **ALIGNED**. No material gaps. A can proceed.
WINHIDE-D8 recorded as resolver-env pass-through (`010_spawn_opts.md:21`).
