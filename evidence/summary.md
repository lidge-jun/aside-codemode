# codemode exec 측정 종합 (2026-09-13)

## 환경
- Aside CLI/데몬 1.26.913.337, Windows, 계정 u0, 코퍼스: 20,000 소형 파일 + 127MB heavy 로그
- 비교 조건: baseline은 codemode 규칙(AGENTS.md) 제거 상태, after는 규칙 활성 상태, needle 회전

## 측정 쌍

| 쌍 | 과제 | baseline | after | ratio |
| --- | --- | --- | --- | --- |
| A2→after4 | 단일 needle 검색(3,000 파일) | 15,202ms (bash 2, 오타 재시도 포함) | 8,408ms (bash 1) | 0.553 |
| B2→after5 | 단일 needle 검색(20,000 파일+127MB) | 9,083ms (bash 1) | 8,650ms (bash 1) | 0.952 |
| C1(baseline3) | 단일 needle(127MB heavy) | ~11s (wrapper) | — | — |
| D→E | 복합(마커 10개 경로+크기) | 28,717ms (bash 3) | 25,390ms (bash 3) | 0.884 |

in-sandbox 프리미티브: 20,000 파일+127MB 검색 56~189ms (after4/after5의 elapsedMs).

## 읽는 법 (정직한 해석)
- 이 호스트에서 툴콜 1회의 턴 고정비는 ~8s(모델 사고 + 데몬 왕복). 단일 검색처럼 양쪽이
  같은 호출 수가 되는 과제는 프리미티브 차이(수초 → 0.2s)가 턴 고정비에 묻힌다.
- 방향은 네 쌍 모두 after 우위(0.55~0.95). 가장 큰 폭은 baseline에 재시도가 있던 A2 쌍(45%).
- 구조적 이득은 호출 수 감소: 실제 실행 중 하나(after1)는 탐색 9회 호출로 수 분이
  걸렸고, codemode는 복합 작업을 1회 호출로 닫는다. 사용자가 보고한 'Waiting for tool
  result' 장기 대기는 이 호출 수에서 오므로, 이득은 작업이 복합적일수록 커진다.
- 50% 미만 판정 기준(wp2 A 합의)은 네 쌍 중 충족 0 — 기준 미달로 기록한다.

## 근거 파일
- evidence/20260913-163310-baseline.jsonl / ...-180032-after4.jsonl
- evidence/20260913-180145-baseline2.jsonl / ...-180209-after5.jsonl
- evidence/20260913-180519-baseline4.jsonl / ...-180601-after6.jsonl
- 인식 증거: after1(175441), after2(175645) 전사 — AGENTS.md 규칙을 읽고 CLI 호출
