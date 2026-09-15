# 150 — wp9: 기계마다 답이 달라지던 검사

## 증상

전체 스위트가 CI에서는 초록인데 이 개발 기계에서만 세 건이 빨갰다.

    --doctor --browse reports the measured capability matrix
    browse config defaults are opt-in and merge field-wise like searchCaps
    browse.exec refuses while it is disabled instead of half-working

셋 다 "browse는 기본 꺼짐"을 검사한다. 원인은 저장소 루트의 `codemode.config.json`이다.
gitignore 대상이고 `register-aside.mjs`가 기계마다 생성하며, 이 기계 것은
`browseCaps.enabled: true`다. 설정 우선순위가 built-in < 저장소 < 사용자 < env < argv이므로
그 파일이 기본값 검사 위에 얹힌다.

`test/browse-doctor.test.js`는 이미 `XDG_CONFIG_HOME`을 없는 경로로 돌려 사용자 설정을
막고 있었고, 그 주석이 "기계마다 판정이 달라지는 테스트는 없느니만 못하다"고 적어 두었다.
막지 못한 쪽이 저장소 설정이었다.

## 고친 방법

`src/config.js`에 두 가지를 더했다.

    CODEMODE_IGNORE_REPO_CONFIG=1   저장소 설정 레이어를 건너뛴다
    CODEMODE_REPO_CONFIG=<path>     그 레이어가 읽을 파일을 지정한다

검사 셋은 첫 번째를 쓴다. 주장은 그대로다 — 바뀐 것은 이제 "이 체크아웃의 기계 설정"이
아니라 "내장 기본값"을 잰다는 점이다.

프로덕션 기본은 꺼짐이다. 값이 정확히 `'1'`일 때만 동작하고, 설치기·register·CLI·런처·
AGENTS 템플릿 어디도 이 env를 넘기지 않는다.

## 감사가 고치게 한 것

처음 넣은 회귀 핀은 CI에서 공허했다. 저장소 설정이 없는 기계에서는 "`_sources`에 그 파일이
없다"가 아무것도 증명하지 않고, `typeof ... === 'boolean'`은 항상 참이다. 그래서
`CODEMODE_REPO_CONFIG`를 더해, 핀 테스트가 **자기가 쓴 임시 파일**로 두 방향을 모두 본다 —
주입하면 `enabled: true`와 `maxTabs: 3`이 실제로 반영되고, 스위치를 켜면 내장 기본값으로
돌아간다. 이제 CI와 노트북이 같은 것을 증명한다.

## 결과

기계-로컬 `codemode.config.json`을 그대로 둔 채 전체 스위트가 664개 중 663 pass / 1 skip /
0 fail, exit 0. 이 세션 내내 스위트를 돌리려면 그 파일을 옆으로 치워야 했는데, 그 임시
조치가 더는 필요 없다.

## 남은 것

`test/regressions.test.js`의 `loadConfig([], {})` 한 곳은 여전히 저장소 `excludeGlobs`를
읽는다. 지금은 통과하지만 같은 종류의 누수이고, 이번 범위 밖으로 남긴다.
