# 100 — wp4 결과: 세 기기 카나리아

## 백업이 먼저

라이브를 건드리기 전에 checkout 밖으로 복사했다. `evidence/`는 추적되는 경로라 계정 지침이
커밋될 수 있어서 저장소에는 경로와 해시만 남긴다.

    mac      ~/aside-codemode-backup-260915/mac-u{0,1,2}/{codemode,skill,AGENTS.md}   21개 파일
    mini     ~/aside-codemode-backup-260915/mini-u0/{codemode,skill,AGENTS.md}         7개 파일
    macmini  ~/aside-codemode-backup-260915/AGENTS.md  (설치 전이라 우리 파일은 없었다)

mac 쪽 백업에는 `MANIFEST.sha256`이 함께 있다. mac u/0의 백업 `cm.js`는 이미 1.1.0
(`f5584a8081bd`)인데, 090에 적은 대로 프로브가 계정 루트에 helper를 직접 쓰기 때문이다.
그 계정의 1.0.0 바이트는 git 이력에만 있다.

## 배포와 확인

| 기기 | 계정 | 동사 | 결과 |
|---|---|---|---|
| MacBook | u/0 | upgrade | written 5, preserved 0, block current |
| MacBook | u/1 | upgrade | written 5, preserved 0, block current |
| MacBook | u/2 | upgrade | written 5, preserved 0, block current |
| Windows MINI | u/0 | upgrade | written 5, preserved 0, block current |
| macmini-cf | **u/1** | install | written 5, preserved 0, block current |

macmini-cf가 이 단계의 시험이었다. 계정이 일곱(u/0~u/6)이고 `accounts.json`의
`currentAccountId`가 1이다. 설치기는 `u/0`으로 가지 않고 현재 계정을 따라갔다. 나머지 여섯
계정은 열지 않았다.

doctor는 다섯 루트 전부에서 같은 답을 낸다.

    installedVersion 1.1.0   upToDate true   agentsBlock current   모든 파일 ok

설치된 `codemode/cm.js`의 sha256은 다섯 루트 모두 `f5584a8081bdd41f…`로 같다.

## 문서가 말하는 줄이 실제로 읽히는가

`scripts/verify-loader.mjs`가 설치된 SKILL.md에서 로더 줄을 뽑아 그 줄 그대로를 실제
`aside repl` 세션에서 실행하고, 로드된 helper에게 버전을 묻는다.

    MacBook (u/0)    the documented line loaded cm 1.1.0
    Windows MINI     the documented line loaded cm 1.1.0
    macmini-cf (u/1) the documented line loaded cm 1.1.0

mac u/1과 u/2는 **skipped**다. `aside repl`은 CLI가 로그인한 현재 계정으로 돌고 그 fs
가드는 자기 계정 루트와 세션 디렉터리만 닿는다. 다른 계정의 파일을 읽으라고 하면 거절하는
것이 맞다. 그 두 계정의 증거는 doctor와, 그 계정으로 로그인했을 때 같은 검사를 돌리는
것이다. 처음에는 이 거절을 실패로 찍었는데, 검증기가 현재 계정인지 먼저 묻도록 고쳤다.

## 앱 내부 에이전트 REPL

이 단계에서 CLI 표면은 세 기기에서 증명됐다. 앱 내부 에이전트 REPL은 사용자가 직접 쓰는
표면이고, 2026-09-15에 사용자가 절대 경로로 `cm.run`까지 붙는 것을 확인해 준 것이 우리가
가진 증거다. 우리 쪽에서 그 표면을 자동으로 돌릴 방법은 없다. 그렇게 적는다.
