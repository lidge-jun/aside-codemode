# 010 — locked copy

## Lead (EN)

On a local development folder, a `find`+`grep` combo took **55s** and one `codemode --code` search took **1s** (~**51x**). Finding 50 files used to stack 50 `read_file` cards; the same job is one bash card.

Older paired Aside-turn timings (model + daemon overhead) were 1.05–1.81x for single searches. Those do not cancel the folder wall-clock.

## Lead (KO, 존댓말)

로컬 개발 폴더에서 `find`+`grep` 조합은 **55초**, `codemode --code` 한 번은 **1초**였습니다. 대략 **51배**입니다. 파일 50개를 찾으면 `read_file` 카드가 50장 쌓였는데, 지금은 bash 카드 한 장입니다.

예전에 재 둔 Aside 턴 비교(모델·데몬 포함)는 단일 검색 1.05~1.81배입니다. 그 표가 폴더 벽시계 측정을 취소하지는 않습니다.

## Windows (APPEND to existing ## Windows — do not replace)

Keep vendored `bin/rg.exe`, `scripts/register-aside.ps1`, and `.gitattributes` LF / issue #2.

Then append: Git Bash is the default Aside shell on Windows. PowerShell is allowed for the same absolute `node` + `bin/codemode.mjs --code` call. Aside has no Linux product. Do not add an Ubuntu recipe.

`.ps1` stays the operator register path. Git Bash is the Aside exec default.

## macOS (do not rewrite)

Keep Homebrew rg + absolute `process.execPath` (issue #3). Do not mention Git Bash in `## macOS`.

## Table-tail (replace, do not keep the general-50x denial)

EN replace `README.md` “much less a general 50x speedup…” with: The folder wall-clock above is one development-folder pair (55s vs 1s). The table is older Aside-turn timings and does not cancel that pair. It is not a promise that every machine or every task is 51x.

KO replace “일반적인 50배 속도 향상은 검증하지 않았습니다…” with: 위 55초/1초는 개발 폴더 한 쌍입니다. 아래 표는 예전에 재 둔 Aside 턴 시간이며 그 측정을 취소하지 않습니다. 모든 머신·모든 작업이 51배라는 약속은 아닙니다.

Lock test must treat the old denial strings as forbidden, including the table-tail.

## AGENTS.codemode.md (one file, keep {{NODE}} {{CLI}} {{CWD_HINT}})

Keep the existing bans and Dual-path lines. Append, do not invent a fourth placeholder:

On Windows, Aside's default shell is Git Bash. PowerShell is allowed for the same absolute `{{NODE}} {{CLI}} --code` call. Do not recurse with `Get-ChildItem`. On macOS, use the default bash/zsh card the same way. Aside has no Linux install path.

## Thread 4/ (반말, emoji 0%)

실제로 개발 폴더에서 재봤어
예전 find+grep 이 55초
codemode CLI는 1초
대충 51배야

파일 50개면 read_file 카드가 50장 쌓이고 화면이 버벅였는데
이젠 bash 카드 한 장이면 끝
