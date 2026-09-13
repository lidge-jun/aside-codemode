# README 51x + Windows Git Bash default

README가 50배를 “실측 아님”으로 깎아 두었다. 운영자가 개발 폴더에서 find+grep 55초 vs `codemode` 1초(~51배)를 재었고, 카드 50장 vs bash 1장도 같이 있다. 그 숫자를 앞에 두고, Windows만 Git Bash 기본·PowerShell 허용으로 적는다. 맥은 지금 경로. 리눅스 설치문은 없다.

## Loop-spec

| Field | Content |
| --- | --- |
| Loop archetype | satisfy-spec |
| Trigger | 실측 51배가 있는데 README가 부정함. Git Bash는 Windows만, PowerShell 호환. /loop HOTL. |
| Goal | README 쌍이 55s/1s/~51x와 50카드→1카드를 앞에 둔다. Windows=Git Bash 기본+PowerShell 허용. 맥 유지. 쓰레드 4/. |
| Non-goals | origin push; 런타임 스폰 변경; 리눅스 지원 주장; 55초를 다른 숫자로 다시 재서 덮어쓰기; #5 약화; 전 머신 SLA |
| Verifier | `test/readme-51x.test.js` via `npm test` (`test/*.test.js`) reads README.md, README.ko.md, templates/AGENTS.codemode.md. Human: thread 4/ exists. |
| Stop | 부정 문장 삭제 + 락 테스트 초록 + 4/ 있음 |
| Memory | this unit + `evidence/dev-folder-51x.md` |
| Terminal | DONE=문서·락·4/ / BLOCKED=meetup 경로 없음 / UNSAFE=역사 표 삭제 또는 전 머신 50배 약속 |
| Escalation | 푸시·재벤치는 NEEDS_HUMAN. 디스패치 2회 실패 시 main이 씀 |

HOTL bounds: this repo + meetup draft. No token/time cap from the user.

## File map

| Path | Op | Change |
| --- | --- | --- |
| `evidence/dev-folder-51x.md` | NEW | operator bench: dev folder, find+grep 55s, CLI 1s, ~51x, 50 cards vs 1. Not a SLA |
| `README.md` | MODIFY | lead with that bench; keep historical Aside-turn table as older pair |
| `README.ko.md` | MODIFY | same, 존댓말 |
| `## Windows` / `## macOS` | MODIFY | Win: Git Bash default, PowerShell allowed, no Linux. macOS: keep |
| `templates/AGENTS.codemode.md` | MODIFY | Windows Git Bash default; PowerShell same abs `--code`; macOS bash/zsh |
| `test/readme-51x.test.js` | NEW | locks lead + denial gone + Git Bash; forbid `## Linux` / Ubuntu / `apt`, not the word Linux |
| meetup `100_thread/.../post.md` | MODIFY | comment 4/ measured copy, 반말, emoji 0% |
| meetup `400_x_kr/.../post.md` | MODIFY | short 55s/1s reply |
| meetup `000_index/.../brief.md` | MODIFY | takeaway includes folder wall-clock; Avoid = no every-machine SLA |

`src/register.js` OUT unless template placeholders break (they do not).

## Conditional paths

| Path | Activate | Observe |
| --- | --- | --- |
| Windows reader | README `## Windows` | Git Bash default + PowerShell allowed; no Linux install |
| macOS reader | `## macOS` | still Homebrew rg + abs node; no Git Bash |
| denial gone | `rg` old strings | 0 hits |

## Bypass

| Layer | Tier | Surface | Bypass | Residual | wording |
| --- | --- | --- | --- | --- | --- |
| README lock test | E2 | npm test | delete the test | docs can drift | no |
| AGENTS text | E2 | model | agent ignores | same as today | no |
| final | none | — | — | — | — |

## Verifier ran at P

A ran `npm test`: 201 pass / 0 fail / exit 0. New file not yet in glob. After B the test `readFileSync`s the three product files (PLAN-VERIFIER-REAL-01). Meetup posts are human-read (test does not open Desktop).

A notes (PASS-WITH-NOTES, folded): lock `## Linux` / Ubuntu / `apt` not the substring Linux; write KO Windows append; replace the whole table-tail denial sentence (keep `<0.5`); cite `evidence/dev-folder-51x.md`; x_kr + brief still in write set.

## SoT

README pair is product SoT. `evidence/dev-folder-51x.md` is the 51x citation. Historical pair stays in `evidence/summary.md`.
