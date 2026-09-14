# 000 — main 릴리즈 계획 (감사 1차 반영본)

기준 커밋은 `origin/dev` f1a9b26이고 작업 브랜치는 `codex/release-main`이다. 앞선
260914_release-gates 루프가 R0~R3과 R5를 닫고 G0~G4 증거를 남겼다.

이 루프가 닫는 것은 셋이다. (1) 설치된 안내의 로더 경로 결함, (2) 로드맵 G3 네 fixture의
산 판정, (3) 세 기기 카나리아와 main 승격. **R4 전체를 닫는다고 말하지 않는다** — 원문
R4는 캡차·금고 복구까지 포함하고 그건 이 루프의 범위 밖이다. G5 수동 세션도 돌리지
않으며 통과로 세지 않는다.

## 순서

    wp1  이 문서들            코드 변경 없음
    wp8  로더 경로 계약        templates, helper-bundle, install fill, register, 회귀 테스트
    wp3  설치 수명            스냅샷 순서 결함 수정 → 복사본 리허설 → 백업 후 라이브 upgrade
    wp2  G3 네 fixture        iframe ref, native→배치→native, display 이미지, 공유 page 경쟁
    wp4  세 기기 카나리아      mac(u/0·u/1·u/2), ssh mini, macmini-cf
    wp5  G5 구분             자동으로 되는 것과 사람 몫의 경계만 기록
    wp6  출시 기록 4종         백업·복구 초안은 라이브 변이 전에
    wp7  main 승격           버전 bump 커밋 → CI → dev → main → 태그 → release

wp8이 앞인 이유는 바이트다. 로더 안내를 고치면 `cm.js`가 바뀌고 helper 해시가 새로
잡힌다. 그 전에 찍은 카나리아 해시는 출시 기록에 쓸 수 없다.

wp3가 wp2보다 앞으로 온 이유는 감사가 찾은 코드 결함 때문이다. 지금 `upgrade`는 구
바이트를 복구 불가능하게 만든다. 라이브 계정에 새 helper를 넣기 전에 그것부터 고친다.

## 단계별 diff 수준

| 단계 | 건드리는 파일 | 남길 증거 |
|---|---|---|
| wp8 | `src/host/browse/helper-bundle.js`, `src/register.js`, `scripts/install-codemode.mjs`, `templates/**`, `test/helper-bundle.test.js`, `test/install-paths.test.js`, `test/readme-51x.test.js`, `test/register.test.js`, `eval/workloads/*.json` | 두 표면의 실제 read 결과, 렌더 결과 단언, Windows 문자열 파싱 검사 |
| wp3 | `scripts/install-codemode.mjs` (스냅샷 순서), `test/install-manifest.test.js` | 바이트가 바뀌는 upgrade에서 rollback이 구 바이트를 되돌리는 반례, 복사본 리허설 로그, 라이브 백업 |
| wp2 | `scripts/probe-*.mjs`, 필요할 때만 `src/host/browse/**` | 산 fixture의 클릭 전후 DOM, mac·mini 양쪽 프로브 출력 |
| wp4 | 코드 변경 없음 | 계정별 sha256 표, 각 기기 doctor와 `browse.probe()` |
| wp5 | `devlog` | 자동분의 출처와 사람 몫의 이름 |
| wp6 | `evidence/release-260915/` | manifest, receipt, 운영 안내, 복구 기록 |
| wp7 | `package.json` (0.1.0 → 0.2.0), `README` | bump SHA의 CI 5조합, main 병합 후 CI, 태그와 release |

## 하지 않을 것

npm publish. 실계정에서의 uninstall·rollback·파일 삭제. 캡차 실해결과 금고 자동입력.
외부 공지 발송. G5 수동 사용성 세션. 마지막 둘은 "돌리지 않았다"고 기록에 남긴다.

## 완료 판정

등록된 criteria는 아홉이다.

    c-1  이 계획 문서들이 존재한다
    c-2  iframe ref와 native+batch 혼합이 산 표면에서 판정된다
    c-3  이미지 전달과 CUA 경쟁이 산 대상 기준으로 판정되거나 불가능하다고 기록된다
    c-4  upgrade/repair/uninstall/rollback이 사용자 수정 보존과 함께 판정된다
    c-5  세 기기가 같은 커밋의 같은 helper sha256을 쓴다
    c-6  G5의 자동분과 사람 몫이 구분돼 기록된다
    c-7  출시 기록 4종이 존재하고 digest가 실제 설치 바이트와 같다
    c-8  정확한 head의 CI 5조합 success, main이 RC를 담고 태그와 release가 존재한다
    c-9  로더 경로가 두 REPL 표면에서 실제로 읽힌다

DONE은 이 아홉이 fresh 증거를 갖는 상태다. c-3과 c-6은 "불가능" 또는 "사람 몫"이라는
결론도 증거가 있으면 충족으로 센다. 돌리지 않은 것을 통과로 적지 않는다.
