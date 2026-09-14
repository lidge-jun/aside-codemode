# 100 — RC 기록

RC 후보는 `codex/release-gates`에서 이 문서를 담은 커밋이다. 그 앞의 코드 변경은 아홉 개 work-phase로 들어갔다.

    wp1 22fad54 → f312d26   로드맵 고정
    wp2 de15b1a             결과 계약 코어 (runId/jobId, status 5종, 요청-반환 대조)
    wp3 0760cf3             capture 출처-산출물 jobId 연결
    wp4 5a9b568             부작용 수명 (timeout과 취소 분리, indeterminate)
    wp5 13c46e9             ref 읽기 계약
    wp6 736288d             post-action diff
    wp7 cc35fde             P1 묶음 (readText·캐시·media·discovery)
    wp8 c7bef2a             네이티브 배치 헬퍼 제품화
    wp9 2b00e09             설치 패키징

배포 묶음의 digest: 헬퍼 `cm` 1.0.0, sha256 `63562408f207da2b…`, 6317 bytes.
mac과 Windows MINI에 같은 바이트가 설치되는 것을 두 기기에서 확인했다.

## 게이트

| 게이트 | 돌린 것 | 결과 |
|---|---|---|
| G0 계약 | `node --test test/browse-discovery.test.js` | 20/20. 카탈로그가 광고하는 옵션과 런타임 검증기가 허용·거절 양쪽에서 일치 |
| G1 정답 | `node --test test/browse-envelope.test.js test/browse-capture.test.js` | 35/35. 틀린 출처 0건 |
| G2 수명 | `node --test test/browse-effect-state.test.js test/browse-tabs.test.js` | 26/26. 누락된 부작용 상태 0건 |
| G3 native 통합 | `node scripts/probe-native-helper.mjs` (mac, ssh mini) | 각 15/15. [070](070_wp8_native_helper.md) 하단 표 |
| G4 배포 | `node scripts/install-codemode.mjs` 6개 서브커맨드 (mac, ssh mini) | 8단계 전부 exit=0, 양쪽 출력 동일. [080](080_wp9_packaging.md) 하단 표 |
| G5 사용성 | **돌리지 않음** | 수동 세션 설계이고 이 루프에서 수행하지 않았다. 통과로 세지 않는다 |

전체 스위트는 변경 범위 기준 35개 파일 388건 통과. hosted CI는 RC 후보 head에서 5조합 success를 확인한다.

## 측정

질문은 몇 배 빨라졌느냐가 아니라 어떤 구간을 묶어야 완료 시간이 줄어드느냐다. 그래서 비교 대상에 "잘 쓴 네이티브 순차 REPL 배치"를 넣었다.

독립 6쪽 읽기, 순서 교차(ABBA) 10쌍, mac 1대:

| 경로 | 실행 | 중앙값(전체) | 중앙값(성공만) | 오류율 |
|---|---|---|---|---|
| native-sequential | 10 | 8420.5 ms | 8420.5 ms | 0.0% |
| cm-batch-limit2 | 10 | 4441 ms | 4441 ms | 0.0% |

각 실행값은 `eval/out/independent-reads.jsonl`에 그대로 있고 `eval/out/independent-reads.md`가 그것을 표로 편다. 중앙값 47% 단축으로 목표안(20% 이상)을 넘겼다.

**세지 않은 것을 분명히 한다.** 090의 측정 설계는 범주당 최소 30쌍, cold/warm 분리, 네 워크로드였다. 실제로 돌린 것은 한 워크로드 10쌍이고 cold/warm을 나누지 않았다. 표본이 30 미만이라 `eval/report.mjs`는 p95를 만들지 않고 그 사실을 본문에 적는다. 나머지 세 워크로드(알려진 버튼 1회 클릭, 처음 보는 페이지 탐색, API·파일 집계)는 정의도 실행도 하지 않았다. 단일 native 경로의 회귀 10% 이내 목표도 측정하지 않았다.

## 계획과 달라진 것

090 표의 fixture 중 `test/fixtures/batch/`, `test/fixtures/serve.mjs`, `test/fixtures/discovery/keys.json`, `test/fixtures/slow-click/`는 저장소에 없다. 앞의 둘은 wp8에서 만들었다가 지웠다 — Aside 브라우저가 이 기기의 loopback에 닿지 못해 로컬 http가 프로브 전송이 될 수 없었고(`data:` URL로 대체), 쓰지 않는 파일을 남기면 다음 사람이 그걸 경로라고 믿는다. 뒤의 둘은 해당 phase가 픽스처 파일 대신 테스트 안에서 데이터를 만드는 쪽을 택했다. 게이트 명령은 그에 맞춰 실제로 존재하는 테스트 파일을 가리킨다.

## 여기서 멈춘다

`main` 병합, 태그, release, npm publish, macmini 배포는 이 계획의 산출물이 아니다. 금고 자동입력, 캡차 실해결, 실제 계정 로그인 성공도 마찬가지다. 실계정 루트에는 읽기 전용 `doctor`만 돌렸고 설치는 하지 않았다 — 사용자 환경을 바꾸는 일이라 별도 결정이다.

**NEEDS_HUMAN.** RC 후보와 게이트 증거는 위에 있다. G5와 나머지 세 워크로드를 채울지, 이대로 승인할지는 사용자 판단이다.
