# codemode exec 측정 요약

| 항목 | baseline (NEEDLE-A2) | after (NEEDLE-A3) |
| --- | --- | --- |
| dump | 20260913-180519-baseline4.jsonl | 20260913-180601-after6.jsonl |
| wall-clock (message.timestamp 스팬) | 28717 ms | 25390 ms |
| wall-clock (파일 스팬, 보조) | 28301 ms | 24869 ms |
| 툴콜 | bash, bash, bash (3) | bash, bash, bash (3) |
| needle 적중 | true | true |

ratio: 0.884 (판정 기준: < 0.5)
verdict: **REVIEW NEEDED**

오염 메모: baseline 첫 bash 호출은 경로 오타(codemod-eval)로 1회 실패 후 재시도했다(공개된 오염, 기각 사유 아님).
