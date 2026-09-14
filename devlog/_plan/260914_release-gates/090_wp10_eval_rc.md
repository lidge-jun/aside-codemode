# 090 — wp10: 통합·성능 평가와 RC 고정

감사 1라운드 지적 9 반영본(fixture 경로와 명령 포함).

## 게이트와 실행 방법

| 게이트 | fixture | 명령 | 합격 |
|---|---|---|---|
| G0 계약 | `test/fixtures/discovery/keys.json` | `node --test test/browse-discovery.test.js` | 허용/거절 전 항목 일치 |
| G1 정답 | `test/fixtures/batch/` (6쪽, 중복 URL 1쌍, 404 1개) | `node --test test/browse-envelope.test.js test/browse-capture.test.js` | 틀린 출처 0건 |
| G2 수명 | `test/fixtures/slow-click/` (300ms 지연 핸들러) | `node --test test/browse-effect-state.test.js test/browse-tabs.test.js` | 누락된 부작용 상태 0건 |
| G3 native 통합 | `test/fixtures/batch/` + 로컬 http | mac·mini `aside repl` 프로브 5건([070](070_wp8_native_helper.md)) | 실제 화면 결과와 일치 |
| G4 배포 | 임시 accountRoot | `node scripts/install-codemode.mjs <sub> --account-root <tmp>` | 사용자 수리 없이 성공 |
| G5 사용성 | 아래 측정 설계 | 수동 세션 + 기록 | 정답 유지, 불필요한 우회 없음 |

표의 fixture는 전부 **NEW**다. 저장소에 현재 있는 것은 `test/fixtures/browse/*.pdf`뿐이다.
`test/fixtures/serve.mjs`, `test/fixtures/batch/`, `test/fixtures/discovery/keys.json`, `test/fixtures/slow-click/`는
각각 그것을 처음 쓰는 phase가 만든다(batch와 serve는 [070](070_wp8_native_helper.md), slow-click은 [030](030_wp4_effect_lifecycle.md),
discovery는 [060](060_wp7_p1_batch.md)).
fixture 서버는 `node test/fixtures/serve.mjs --port 0`으로 띄우고 포트를 프로브에 전달한다.
스크립트가 `file://`를 거절하므로 정적 파일을 직접 열지 않는다.

## 측정 설계

질문은 「몇 배 빨라졌나」가 아니라 **어떤 구간을 묶어야 전체 완료 시간이 줄어드는가**다.
비교 대상에 잘 작성된 네이티브 REPL 배치를 포함한다. 코드모드가 그보다 느리면 그대로 적는다.

| 워크로드 | 비교 경로 | 지표 |
|---|---|---|
| 알려진 버튼 1회 클릭 | native ref / native CUA / helper / CLI | 준비 포함 지연, wrong-target 수 |
| 처음 보는 페이지 탐색 | native 자유 / 강제 code mode | 정답, 왕복 수, 복구 시간 |
| 독립 6쪽 읽기 | native 순차 / REPL 배치 / helper / CLI | 완료시간, 회수율, peak tabs, 실패 격리 |
| API·파일 집계 | 기존 native / batch | 토큰, bytes, 호출 수, 동등 정답 |

- 범주당 최소 30쌍, 순서 교차, cold/warm 분리.
- 중앙값과 각 실행값과 오류율을 함께 공개한다. 적은 표본의 p95를 운영 지표로 쓰지 않는다.
- 목표안(합의 대상, 실측 아님): 대표 batch 중앙값 20% 이상 단축, 단일 native 경로 중앙값 회귀 10% 이내.
- 시각·인증 혼합 흐름은 자동 측정에서 제외하고 사용자 개입 구간으로 따로 기록한다.

## NEW / MODIFY 맵

        NEW  eval/paired-run.mjs        범주별 순서 교차 실행기. 입력은 workload 정의 JSON, 출력은 실행별 raw JSONL
        NEW  eval/workloads/*.json      위 표의 네 워크로드 정의(경로, 기대 정답, 반복 수)
        NEW  eval/report.mjs            JSONL을 받아 중앙값, 각 실행값, 오류율을 표로 낸다. p95는 내지 않는다
        NEW  devlog/_plan/260914_release-gates/100_rc_record.md   RC 후보 커밋, digest, 게이트별 증거 링크
        MODIFY README.md                코드모드 경로 선택 규칙 한 절(네이티브 우선, 배치 전환 조건)

`eval/` 디렉터리는 저장소에 이미 있다(현재는 bench 스크립트용). 새 파일은 그 아래에 둔다.

## TESTS

- NEW `test/eval-paired-run.test.js`: 워크로드 정의가 잘못되면(반복 수 0, 경로 없음) 실행 전에 거절한다.
  같은 seed로 두 번 돌리면 실행 순서가 교차(ABBA)되고, 중앙값 계산이 홀수/짝수 표본 모두에서 맞다.
- NEW `test/eval-report.test.js`: 표본이 30 미만이면 리포트가 p95를 만들지 않고 그 사실을 본문에 적는다.
  실패한 실행이 중앙값 계산에서 제외되지 않고 오류율로 보고된다.

## Verification (C)

- `node --test test/eval-paired-run.test.js test/eval-report.test.js` — exit 0.
- `node eval/paired-run.mjs --workload eval/workloads/independent-reads.json --dry-run` — exit 0, 실행 계획만 출력.
- G0-G4의 각 명령을 실제로 돌린 로그를 `100_rc_record.md`에 붙인다. 돌리지 않은 게이트는 비워 두고 통과로 적지 않는다.
- hosted CI 5조합 success at RC 후보 head.

## RC 고정

- G0–G5를 통과한 커밋을 RC로 고정하고 검증 중 `dev`의 최신 HEAD를 따라가지 않는다.
- 한 묶음을 mac과 Windows MINI에 설치하고 같은 digest를 확인한다. macmini는 이번 범위 밖이다.

## 여기서 멈추는 것

`main` 병합, 태그, release, 정식 배포는 이 계획의 산출물이 아니다.
RC 후보와 증거를 갖춘 상태에서 **NEEDS_HUMAN**으로 보고하고 승인을 기다린다.
금고 자동입력, 캡차 실해결, 실제 계정 로그인 성공도 같은 이유로 사용자 확인 항목이다.
