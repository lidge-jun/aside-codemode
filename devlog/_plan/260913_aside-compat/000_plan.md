# aside-codemode — CLI-first Aside-shaped Code Mode

어사이드 exec는 MCP를 붙이지 않는다. 이미 선회한 성공 경로는 bash 한 번으로
`codemode --code`를 돌리고, 계정 `AGENTS.md`가 그걸 강제하는 것이다.
이번 유닛은 그 CLI를 Codex Code Mode에 가깝게 키운다. 게스트 JS의 파일 API는
어사이드 UI에 보이는 `read_file` / `write_file` / `edit_file`과 같은 모양이고,
전역 설치가 기본이며, `--cwd`로 프로젝트·자식 에이전트가 작업 폴더를 지정한다.
MCP `execute_code`는 미래 빌드용으로만 남긴다. 성공 게이트가 아니다.

## Loop-spec

| Field | Content |
| --- | --- |
| Loop archetype | satisfy-spec |
| Trigger | Codex Code Mode를 Aside에서 쓰게 하라. `~/Developer/codex` + `codex-rs`에서 인사이트. Aside는 전역·pi 기반, 프로젝트 cwd 가능. 파일 툴은 UI에 렌더되는 Aside 스키마. 이미 CLI로 선회. 이슈 #1 #2 #3. README 영/한. 푸시. `/loop` HOTL. |
| Goal | Aside 에이전트가 bash로 이 리포의 `codemode` CLI를 한 번 호출해 검색·읽기·요약을 끝내고, 보이는 단일 파일 수정은 네이티브 `edit_file`/`write_file`을 쓰며, 게스트 JS는 그 스키마와 같다. `--cwd`/`CODEMODE_CWD`로 상대경로가 프로젝트에 붙는다. |
| Non-goals | Aside/pi/codex 트리 수정, 데몬 패치, MCP를 exec 성공 경로로 되돌리기, Codex `exec`/`wait` 셀 포팅, npm publish, 부모 리포 푸시, 라이브 Windows 런타임 증명 |
| Verifier | `npm test` (2026-09-13 이 머신: 47 pass / 0 fail / exit 0, `test/*.test.js` → `src/**`). CLI `--doctor` / `--help`가 cwd를 보고하는지는 wp1 이후. 이슈 클로즈는 `gh issue view`. 푸시는 `git ls-remote`. |
| Stop condition | goalplan criteria c-1..c-5 met + wp0–wp6 done |
| Memory artifact | `devlog/_plan/260913_aside-compat/` + `.codexclaw/goalplans/bring-codex-code-mode-capabilities-into-aside-vi/` |
| Expected terminal outcomes | DONE=위 전부 / BLOCKED=푸시 거부 / UNSAFE=AGENTS.md 쓰기 실패 / NEEDS_HUMAN=Windows 실기 |
| Escalation | 파견 2회 실패 시 main 회수. 데몬이 CLI exec에 MCP를 붙이기 시작해도 이번 유닛은 CLI를 유지. |

HOTL bounds: write this repo + `~/.aside/u/0/AGENTS.md` (register). Do not edit accounts.json/models.json. Push of this remote is user-authorized. No token/time cap stated.

## Architect dispositions (wp0)

Source: [architect](1bac5ca3-0bb9-49ca-a002-012e1a11d9a6) CLI-first revision. Main accepts all seven.

| ID | Decision | Main |
| --- | --- | --- |
| D1 | Product surface is `bin/codemode.mjs` → `src/cli.js`. `server.js` future-only. | Accept |
| D2 | Guest JS injects Aside-shaped `read_file`/`write_file`/`edit_file`. No MCP file tools. No card claim. | Accept |
| D3 | Dual-path AGENTS.md: compound → CLI; visible single-file → native tools. | Accept |
| D4 | `apply_patch` optional guest helper → same host write/edit. Not an AGENTS verb. | Accept (ship in wp3) |
| D5 | `roots` stay allowlist. cwd = `--cwd` > `CODEMODE_CWD` > `process.cwd()`. | Accept |
| D6 | One-shot CLI. No Codex exec/wait cells. | Accept |
| D7 | Register writes AGENTS with `process.execPath`. MCP retarget optional, not a gate. | Accept |

Rejected permanently: MCP `read_file` tools for UI cards; gating on `tools/list`; `roots = [cwd]`.

## Work-phase map (dependency order)

| wp | Doc | Builds on | Verifiable close |
| --- | --- | --- | --- |
| wp0 | this file + 001 + decades | research | docs exist, A pass, no src patch |
| wp1 | 010 | — | `--cwd` resolves relatives; doctor prints cwd; tests |
| wp2 | 020 | wp1 cwd | guest `read_file`/`write_file`/`edit_file` match Aside; old `fs.read` byte offset retired as file contract |
| wp3 | 030 | wp2 host | `apply_patch("*** Begin Patch")` in `--code` |
| wp4 | 040 | wp3 API | templates + register idempotent AGENTS; issues #1 #3 |
| wp5 | 050 | wp4 recipes | `.gitattributes`, README + README.ko.md CLI-first |
| wp6 | 060 | wp5 | push + close #1 #2 #3 |

## SoT sync (SOT-SYNC-01)

This repo's SoT is `README.md` (and after wp5 `README.ko.md`). C of each impl cycle patches README only when that cycle changes the public CLI/AGENTS contract. No new `docs/` folder.

## Resource / bypass (PLAN-BYPASS-NAMED-01)

| Layer | Tier | Executing surface | Known bypass | Residual | Wording downgrade |
| --- | --- | --- | --- | --- | --- |
| roots allowlist | E2 | `src/paths.js` `assertInside` | Aside `bash` outside roots | same as today | no — still “refused”, not “enforced vs bash” |
| AGENTS.md rule | E8 | prompt text only | model ignores and runs `rg` | issue #1 | **yes** — early warning, not enforcement |
| write_file create-only | E2 | `fs.open` / `writeFile` with `wx` | TOCTOU if we `exists` then write; race with another process | `wx` is the layer; still not a lock | no — “create-only via wx” |
| --cwd required-value | E2 | `src/cli.js` `fail()` | omit the flag (falls through to env/process cwd) | missing value must not throw raw | no |
| final layer | none | — | — | `node:vm` is accident containment | n/a |

## Attestation log

- 2026-09-13 P opened. Previous D (none in this goal). Direction: CLI-first after user correction; stop treating MCP as the working path.
- 2026-09-13 A FAIL (reviewer 63658ce7): folded 6 High blockers — resolveCwd in fail(); field chains; wx create-only; full patch parser; register AGENTS-first + package.json files + user config; README locked headings; bypass table tiers.
- 2026-09-13 A FAIL round 2: locked createFs shape; register mkdir u/0 + missing-settings exit 0; package.json description CLI-first; exact patch markers; partial-apply test.
- 2026-09-13 A FAIL round 3 folded without 4th dispatch (LOOP-REPAIR-01): createFs is the fs object plus Aside names (existing tests keep `.read`); mkdir user-config parent; actions keep deprecated rows; UNSAFE is AGENTS write fail.
- 2026-09-13 B (docs-only): no `src/` patches. Decade docs 010–060 + 001 research are the locked artifact. Next cycle (wp1) implements cwd. Product surface remains CLI + AGENTS.md, not MCP.
- 2026-09-13 D wp3: `apply_patch` is a CLI guest helper (`src/host/patch.js`). `npm test` 79 pass. CLI QA `result: {}`. Next: wp4 register writes AGENTS first; MCP merge is optional hygiene only.
- 2026-09-13 D wp4: `applyRegister` writes AGENTS with abs node; missing settings is `{ok:true,settingsOk:false}` exit 0. `package.json` description is CLI-first. Next: wp5 rewrite README so the product page stops saying MCP server.
