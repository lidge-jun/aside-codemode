# Windows rg spawn — windowsHide #5

어사이드 Windows 셸에서 `windowsHide: true`로 rg를 띄우면 0xC0000142로 검색이 전부 죽는다.
ssh mini Git bash에서는 같은 바이너리가 살아 있다. 고치는 값은 기본 스폰에서 hide를 빼는 것이다.

## Loop-spec

| Field | Content |
| --- | --- |
| Loop archetype | satisfy-spec |
| Trigger | 업데이트 후 이슈 #5. ssh mini에서 프로브하며 해결. /loop HOTL. |
| Goal | Windows 기본 스폰이 `windowsHide`를 쓰지 않는다. 호출부 소스 락 + npm test. #5는 Aside 재현 또는 리포터 표 + 정직한 미재현 코멘트로 닫는다. mini Git bash/Aside가 이미 초록이어도 코드 변경은 NOOP가 아니다. |
| Non-goals | MCP 제품화; shell:true; 루트 완화; origin push; 50배 벤치; #1–#4 재오픈 |
| Verifier | `npm test` glob `test/*.test.js` includes `test/windows-hide.test.js`. That file (1) locks helper opts and (2) reads `src/rg.js` + `src/rg-stream.js` as text and asserts they contain no `windowsHide: true` literal. Mini Git bash doctor/search is NOT #5 proof (already green with hide). Aside exec `node bin/codemode.mjs --doctor` + `--code search.count` if reachable; else issue #5 Aside-shell table + the call-site lock. |
| Stop | helper tests + call-site source lock (no `windowsHide: true` in rg.js / rg-stream.js) + npm test 0. Mini Git bash alone cannot close #5. Close #5 with Aside doctor/search after the patch, or with the reporter table plus the lock if Aside already green pre-patch. |
| Memory | this unit |
| Terminal | DONE=call-site lock + npm test 0 + (#5 closed with Aside post-fix doctor/search OR honest comment that mini Aside could not reproduce 0xC0000142 and we shipped omit-hide from reporter table) / BLOCKED=mini 불가 / UNSAFE=shell:true |
| Escalation | Aside GUI만 재현되면 NEEDS_HUMAN. 디스패치 2회 실패 시 main이 구현 |

HOTL bounds: this repo + ssh mini probe. No token/time cap from the user.

## Stale check (2026-09-14 P)

- `src/rg.js:73,98` `execFileP(..., { windowsHide: true })`
- `src/rg-stream.js:69` `spawn(bin, args, { windowsHide: true })`
- GitHub #5: hide=3221225794, hide 없음=정상. `.\bin\rg.exe --version` 성공
- 2026-09-14 mini Git bash (`bbb0477`): hide/default 모두 exit 0, doctor ok, search.count 8/1, search.files 2. Git bash ≠ Aside 셸
- 공유 helper 없음. `CODEMODE_WINDOWS_HIDE` 없음

## File map

| Path | Op | Change |
| --- | --- | --- |
| `src/child-opts.js` | NEW | `rgChildOpts(extra, env)` — 기본 hide 없음. `CODEMODE_WINDOWS_HIDE===1`만 `windowsHide:true` |
| `src/rg.js` | MODIFY | version 스폰 2곳이 `rgChildOpts({ timeout: 5000, signal, killSignal: 'SIGKILL' }, env)` — Node `execFile` 키는 `timeout` (timeoutMs 아님). resolver `env`를 넘겨 `CODEMODE_WINDOWS_HIDE`가 주입 env를 따른다. `where.exe`(`src/rg.js:45`)는 hide를 이미 안 쓰므로 OUT |
| `src/rg-stream.js` | MODIFY | `spawn(bin, args, rgChildOpts())` — stream은 `process.env` (WINHIDE-D9) |
| `test/windows-hide.test.js` | NEW | helper 단위 잠금 4건 (test 1 uses env `{}` not `process.env`) + source lock: `src/rg.js` and `src/rg-stream.js` have no `windowsHide: true` literal |
| README.md / README.ko.md | OUT | 이 사이클에서 문서 필수 아님. 이슈 코멘트에 기록 |

## Conditional paths (C-ACTIVATION)

| Path | Activate | Observe |
| --- | --- | --- |
| default | env unset | `rgChildOpts({})` has no `windowsHide` |
| opt-in hide | `CODEMODE_WINDOWS_HIDE=1` | `windowsHide === true` |
| env wins over extra | `rgChildOpts({ windowsHide: false }, { CODEMODE_WINDOWS_HIDE: '1' })` | `windowsHide === true` |

## Bypass (PLAN-BYPASS-NAMED-01)

| Layer | Tier | Surface | Bypass | Residual |
| --- | --- | --- | --- | --- |
| default no-hide | E2 | env | `CODEMODE_WINDOWS_HIDE=1` restores the broken Aside-shell path | documented opt-in; wording downgrade: no (early warning, not enforcement) |
| call-site lock | E2 | `npm test` reads src text | a later edit can re-add the literal | residual; not a runtime gate |
| final | none | — | caller can still pass windowsHide via a future extra | tests lock helper + literals |

## Verifier ran at P

`npm test` exists (`package.json` `"test": "node --test \"test/*.test.js\""`). Ran at P: 196 pass / 0 fail / EXIT 0. Does not yet observe hide call sites (file missing). After B the new test reads those two src files as text (PLAN-VERIFIER-REAL-01). mini Git bash doctor/search on unpatched `bbb0477`: ok — NOT #5 proof. Aside exec spawn table (2026-09-14): hide/nohide/execHide all exit 0 inside Aside bash/powershell. Nested `codemode --doctor` from Aside is the remaining live probe.

## SoT

README Future/Windows 절은 선택. 이슈 #5 코멘트가 Windows 스폰 SoT.
