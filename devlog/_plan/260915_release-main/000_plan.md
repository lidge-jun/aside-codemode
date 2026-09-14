# 000 — main 릴리즈 계획 (감사 2차 반영본)

기준 커밋은 `origin/dev` f1a9b26이고 작업 브랜치는 `codex/release-main`이다. 앞선
260914_release-gates 루프가 R0~R3과 R5를 닫고 G0~G4 증거를 남겼다.

이 루프가 닫는 것은 셋이다. (1) 설치된 안내의 로더 경로 결함, (2) 로드맵 G3 네 fixture 중
**현재 표면에서 실행 가능한 부분**의 산 판정, (3) 세 기기 카나리아와 main 승격.
R4 전체를 닫는다고 말하지 않는다 — 원문 R4는 캡차·금고 복구까지 포함하고 범위 밖이다.
G5 수동 세션도 돌리지 않는다.

## 순서

    wp1   이 문서들            코드 변경 없음
    wp8   로더 경로 계약        templates, helper-bundle, install fill, register, 회귀 테스트
    wp3   설치 수명 (코드+복사본) 스냅샷 순서 결함 수정 → 임시 루트 리허설
    wp6a  백업과 복구 초안       라이브를 건드리기 전에, checkout 밖에 백업
    wp3b  라이브 변이           백업 뒤 네 루트 upgrade와 doctor만
    wp2   G3 fixture           iframe ref, native→배치→native, display 이미지, 공유 page 경쟁
    wp4   세 기기 카나리아       mac(u/0·u/1·u/2), ssh mini, macmini-cf
    wp5   G5 구분              자동으로 되는 것과 사람 몫의 경계만 기록
    wp6   출시 기록 4종         초안을 실제 경로·해시로 완성
    wp7   main 승격            bump 커밋 → push → 그 SHA CI → dev → main → 새 run → 태그 → release

wp8이 앞인 이유는 바이트다. 로더 안내를 고치면 `cm.js`가 바뀌고 helper 해시가 새로
잡힌다. wp3가 wp2보다 앞인 이유는 감사가 찾은 코드 결함이다 — 지금 `upgrade`는 구
바이트를 복구 불가능하게 만든다. wp6a가 wp3b 앞인 이유는 복구 기록이 가리킬 대상이
라이브 변이 뒤에는 만들어지지 않기 때문이다.

## 단계별 diff 수준

| 단계 | 건드리는 파일 | 남길 증거 |
|---|---|---|
| wp8 | `src/host/browse/helper-bundle.js`, `src/register.js`, `scripts/install-codemode.mjs`, `scripts/probe-native-helper.mjs`, `templates/**`, `test/{helper-bundle,install-paths,readme-51x,register}.test.js`, `eval/workloads/*.json` | 두 표면의 실제 read 결과, 렌더 결과 파싱 검사, 계정별 경로 단언 |
| wp3 | `scripts/install-codemode.mjs`, `test/install-manifest.test.js` | 바이트가 바뀌는 upgrade에서 rollback이 구 바이트를 되돌리는 반례, 임시 루트 리허설 로그 |
| wp6a | `evidence/release-260915/` (경로·해시만) | checkout 밖 백업의 위치와 해시, `recovery.md` 초안 |
| wp3b | 코드 변경 없음 | 네 루트의 upgrade·doctor 출력과 sha256 |
| wp2 | `scripts/probe-g3.mjs` 신규, 필요할 때만 `src/host/browse/**` | 산 fixture의 조작 전후 DOM, mac·mini 양쪽 출력 |
| wp4 | 코드 변경 없음 | 계정별 sha256 표, 각 기기 doctor와 `browse.probe()` |
| wp5 | `devlog` | 자동분의 출처와 사람 몫의 이름 |
| wp6 | `evidence/release-260915/` | manifest, receipt, 운영 안내, 복구 기록 |
| wp7 | `package.json` (0.1.0 → 0.2.0), `README` | bump SHA의 CI 5조합, main 병합 후 새 run, 태그와 release |

## 하지 않을 것

npm publish. **실계정에서의 uninstall·rollback·repair·파일 삭제 전부.** 캡차 실해결과
금고 자동입력. 외부 공지 발송. G5 수동 사용성 세션. 축소 좌표 매핑과 DPI·zoom·clip.
native mouse/keyboard 동등성 fixture. 마지막 넷은 "돌리지 않았다"로 기록에 남긴다.

## 완료 판정

| id | 충족 조건 |
|---|---|
| c-1 | 이 계획 문서들이 존재한다 |
| c-2 | iframe ref와 native→배치→native가 산 DOM 결과로 판정된다 |
| c-3 | `display` 이미지 전달과 공유 page 경쟁이 산 결과로 판정된다. **축소 좌표·DPI·zoom·clip·mouse 동등성은 이 기준 밖이며 미실행으로 기록된다** |
| c-4 | 임시 루트에서 여섯 동사가 **동사별 기대값**으로 판정된다 — install/upgrade/repair는 사용자 수정 보존, uninstall은 수정된 파일만 남김, rollback은 previous 바이트 복원과 후속 수정 덮어쓰기 위험을 명시적으로 판정. 라이브는 upgrade와 doctor만 |
| c-5 | 세 기기의 계정 루트별 helper sha256이 wp8 이후 값으로 같다 |
| c-6 | G5의 자동분과 사람 몫이 구분돼 기록되고, 기준 변경의 주체가 명시된다 |
| c-7 | 출시 기록 4종이 존재하고 digest가 실제 설치 바이트와 같다 |
| c-8 | 정확한 head의 CI 5조합 success, main이 그 SHA를 담고 태그와 release가 존재한다 |
| c-9 | 로더 경로가 CLI 표면에서 실측되고, 앱 표면에서는 사용자 확인으로 기록된다 |

"불가능하다"는 결론은 c-3의 **미실행 목록**으로만 센다. 실행 가능한 항목을 불가능으로
분류해 DONE에 넣지 않는다. 돌리지 않은 것을 통과로 적지 않는다.
