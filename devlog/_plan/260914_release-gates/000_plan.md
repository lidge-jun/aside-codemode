# 000 — release-gates: 출시 게이트까지의 계획

기준: `origin/dev` 267ccff, 작업 브랜치 `codex/release-gates`. 재감사 증거는 [001_audit_findings.md](001_audit_findings.md).

## Objective

Aside code-mode의 배치 실행 계층을 "정답·출처·부작용 상태를 설명할 수 있는" 상태로 만든 뒤,
네이티브 배치 헬퍼와 설치 패키징까지 붙여 RC 후보를 고정한다. 네이티브 직접 조작을 대체하지 않는다.

관측된 실패(요약, 근거는 001):

- 배치 완료 순서와 입력 순서를 인덱스로 조인해 이미지 파일명과 출처가 어긋난다.
- 요청 9개 중 8개만 돌아와도 전체 성공이 된다.
- timeout 뒤 native 동작이 실제로 커밋됐는지 기록이 없다.
- close가 hang이면 닫힌 것으로 세고, 실제 탭은 남는다.
- readText가 빈 본문과 503/로그인 화면을 정상 관측으로 저장한다.
- discovery(actions.check)와 runtime(validateJob)이 서로 다른 키를 허용/거절한다.
- 출력 예산을 넘으면 구조화 envelope가 잘린 문자열이 된다.

## Loop-spec

- Loop archetype: verifier-defined. 각 work-phase는 먼저 실패하는 테스트를 만들고 그것을 통과시킨다.
- Write scope: `src/**`, `test/**`, `templates/**`, `scripts/**`, `README*.md`, `devlog/_plan/260914_release-gates/**`.
- Out of scope: `main` 병합, 태그, npm publish, macmini 배포, 사용자 금고/실제 계정 로그인/캡차 실해결,
  Aside 앱 설정 변경, `skills/builtin` 덮어쓰기, 다른 리포.
- 증거: 정확한 head의 hosted CI(5조합) + 변경 범위의 개별 테스트 + mac/`ssh mini` 실제 `aside repl` 프로브.
- 도구·자격 범위: 로컬 git(브랜치 `codex/release-gates`), `gh`(읽기와 브랜치 푸시), `ssh mini`(읽기·프로브),
  `aside repl`(공개 페이지와 로컬 fixture만). 사용자 금고와 실계정 로그인은 사용하지 않는다.
- 벽시계 한도: 한 work-phase당 실행 4시간. 초과하면 BUDGET_EXHAUSTED로 보고하고 다음 사이클로 넘기지 않는다.

## Work-phase map (한 phase = 한 PABCD 사이클)

| WP | Doc | Slice | Depends on |
|----|-----|-------|------------|
| wp1 | 000/001 | 재감사와 로드맵 고정 (코드 변경 없음) | - |
| wp2 | [010](010_wp2_result_contract.md) | 결과 계약 코어: runId/jobId/operationId, 요청 원장, status 5종 | wp1 |
| wp3 | [020](020_wp3_capture_provenance.md) | capture 출처-산출물 조인과 부분 완료 표기 | wp2 |
| wp4 | [030](030_wp4_effect_lifecycle.md) | 부작용 수명: started/confirmed/indeterminate, 탭 hang 회계 | wp2 |
| wp5 | [040](040_wp5_ref_read_contract.md) | ref 읽기 계약(wp2b)과 attach 체이닝 | wp2 |
| wp6 | [050](050_wp6_post_action_diff.md) | post-action diff(wp2c) | wp5 |
| wp7 | [060](060_wp7_p1_batch.md) | readText/search/prefetch/watch/media/discovery/envelope | wp2 |
| wp8 | [070](070_wp8_native_helper.md) | 네이티브 배치 헬퍼 제품화와 양 OS 프로브 | wp3, wp4, wp7 |
| wp9 | [080](080_wp9_packaging.md) | 설치 패키징과 복구 | wp8 |
| wp10 | [090](090_wp10_eval_rc.md) | 통합·성능 평가와 RC 고정 | wp6, wp9 |

순서는 일정이 아니라 의존 구조다. wp2의 식별자·원장이 wp3/wp4/wp7의 전제이고,
wp5의 읽기 계약이 wp6 diff의 전제이며, 실행 계층이 정직해진 뒤에야 헬퍼와 패키징이 의미를 갖는다.

## Accept criteria (goalplan c-1..c-13 미러)

- c-1 로드맵 P0/P1 각 항목이 267ccff에서 재현되는지 실패 테스트 또는 소스 인용으로 판정된다 (wp1)
- c-2 이 unit에 000_plan.md와 모든 단계의 diff-level 문서가 존재한다 (wp1)
- c-3 capture가 역순 완료와 중복 URL에서도 출처와 이미지를 정확히 연결한다 (wp3)
- c-4 session이 요청 ID와 반환 ID를 대조하고 누락을 partial로 표기한다 (wp2)
- c-5 timeout 뒤 native 동작이 started/indeterminate로 기록되고 자동 재시도가 없다 (wp4)
- c-6 탭 예산이 진행 중 open 예약과 close 실패/hang에서도 peak <= maxTabs를 지킨다 (wp4)
- c-7 액션 뒤 새 관찰의 ref 읽기는 허용되고 이전 관찰의 ref 재사용만 거절된다 (wp5)
- c-8 diff가 체크/선택 상태와 주요 본문 변경을 보존하고 navigation에는 reset을 반환한다 (wp6)
- c-9 readText가 실제 본문을 반환하고 HTTP 오류와 차단을 정상 관측으로 저장하지 않는다 (wp7)
- c-10 search since 캐시 재필터와 prefetch 소비 경로가 실제 hit로 검증된다 (wp7)
- c-11 헬퍼가 mac과 ssh mini 양쪽 aside repl에서 실증된다 (wp8)
- c-12 설치 패키징이 두 기기에서 install/upgrade/repair/uninstall/rollback을 완료한다 (wp9)
- c-13 정확한 head의 hosted CI가 5조합 success다 (전 phase 공통)

## 검증 명령 (PLAN-VERIFIER-REAL-01)

- `node --test test/<대상>.test.js` — 변경 파일 범위의 개별 테스트. 실제로 대상 모듈을 import하는지 파일 상단 import로 확인한다.
- `node scripts/run-tests.mjs` — 전체 스위트. 로컬 실행은 사용자 정책 확인 전까지 보류하고 hosted CI에 맡긴다.
- `gh run list --branch codex/release-gates -L 3` 후 `gh run view <id> --json conclusion,headSha` — 정확한 head 대조.
- `aside repl "<probe>"` 와 `ssh mini 'aside repl "<probe>"'` — 양 OS 실행 표면.
