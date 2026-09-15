# 030 — wp3: 설치 수명 (감사 2차 반영본)

## 먼저 고쳐야 할 코드 결함

`runInstaller`의 upgrade는 `applyWrites`로 디스크를 먼저 덮고, 그다음
`snapshotForRollback`이 **그 덮인 디스크를** 읽는다. `previous.content`에 구 바이트가
아니라 방금 쓴 새 바이트가 들어간다. 바이트가 바뀌는 upgrade 뒤의 rollback은 구 helper를
되돌리지 못한다. 기존 테스트는 install과 upgrade가 같은 바이트일 때만 돌려서 못 잡았다.

순서: (1) 바이트가 바뀌는 upgrade → rollback 반례를 먼저 쓴다(지금 실패해야 한다).
(2) 스냅샷을 `applyWrites` 앞으로 옮긴다. (3) 통과를 본다.

`rollback`은 `inspectFile` 없이 previous를 전부 덮어써서 사용자가 이후 고친 파일도
덮는다. 이번 루프에서 동작을 바꾸지는 않되, **그 위험을 판정하는 테스트를 남긴다** —
upgrade 뒤 사용자가 고친 파일이 rollback에서 덮이는지를 고정한다. 고칠지 말지는 그
결과를 보고 정한다.

## wp8이 넘긴 결함 둘

wp8이 helper 바이트와 버전(1.0.0 → 1.1.0)을 바꾸면서 기존 설치본과의 관계에서 두 가지가
드러났다. 둘 다 이 단계에서 고친다. 라이브 계정은 wp3b 전까지 건드리지 않으므로 그때까지는
실제 위험이 아니다.

1. **doctor가 구 설치를 건강하다고 말한다.** `ok`는 디스크와 manifest에 적힌 해시를
   비교할 뿐이라, 1.0.0 설치본은 `installedVersion: "1.0.0"`과 `version: "1.1.0"`을 나란히
   찍으면서 파일은 전부 ok로 나온다. 고칠 것: planned 바이트와도 비교해 다르면 `stale`로
   보고한다. 버전이 다른데 ok라고 말하지 않는다.
2. **repair가 planned 해시를 디스크에 없는 바이트로 기록한다.** 존재하는 파일을 건너뛰면서
   manifest만 planned 해시로 갱신하므로, 그다음 upgrade가 디스크를 `modified`로 보고 구
   문서를 영구 보존한다. 고칠 것: 건너뛴 파일은 **디스크 해시**를 기록한다.

두 반례를 먼저 쓴다. (a) 1.0.0 바이트가 깔린 루트에서 doctor가 stale을 말하는가.
(b) repair → upgrade 순서가 새 바이트를 실제로 들여보내는가.

## 라이브 계정에서 할 것과 하지 않을 것

| | 라이브 실계정 | 임시 `--aside-home` |
|---|---|---|
| doctor | 한다 | 한다 |
| install / upgrade | 백업 뒤에만 한다 | 한다 |
| repair | **안 한다** | 한다 |
| uninstall | **안 한다** | 한다 |
| rollback | **안 한다** | 한다 |

라이브 rollback은 "거절 확인"조차 하지 않는다. 라이브 upgrade가 지나간 뒤에는
`previous`가 생기므로 그 명령은 더 이상 거절이 아니라 실제 덮어쓰기다. 현재 실계정 네
루트가 `previous: null`이라는 사실은 doctor의 `hasPrevious` 필드로 기록한다.

이유는 설치기에 backup/rename이 없기 때문이다. uninstall은 소유 파일을 지운 뒤
`codemode/manifest.json`을 지우는데 previous 내용은 그 manifest에만 있다.

## 임시 루트 리허설 순서

    install → 사용자 수정 한 줄 → upgrade(수정 보존 확인, previous 생성)
           → rollback(구 바이트 복원 확인, 후속 수정 덮어쓰기 판정)
           → 파일 삭제 → repair(복원 확인)
           → uninstall(수정된 파일만 남는지) → 재install

rollback을 repair보다 **앞**에 둔다. repair도 manifest를 planned 해시로 다시 쓰면서
`previous`를 갈아치우기 때문에, 순서가 반대면 rollback이 증명하는 대상이 사라진다.

## 동사별 통과 조건

| 동사 | 기대 |
|---|---|
| install | 없던 파일만 쓴다. 이미 있는 남의 파일은 preserved |
| upgrade | 사용자 수정 보존, 나머지는 새 바이트, previous에 **구** 바이트 |
| repair | 없어진 파일만 복원, 나머지는 skipped |
| uninstall | 해시가 맞는 소유 파일만 삭제, 수정된 파일은 남김, 블록만 제거 |
| rollback | previous 바이트 복원. 후속 사용자 수정이 덮이는지는 판정해 기록 |
| doctor | 위 각각 뒤의 상태를 그대로 보고 |

"여섯 동사가 사용자 수정을 보존한다"는 묶음 표현은 쓰지 않는다. rollback과 uninstall은
정의상 그 말이 성립하지 않는다.

## 라이브 단계(wp3b)

백업(wp6a)이 끝난 뒤에만 시작한다. `--account <id> --json`을 모든 호출에 붙인다. 인자를
비우면 `accounts.json`의 `currentAccountId`를 따라가서, 사용자가 계정을 바꾸면 엉뚱한
루트를 건드린다. 네 루트(mac u/0·u/1·u/2, mini u/0)를 같은 artifact로 올려 계정 간 해시를
하나로 맞추고, doctor로 상태와 sha256을 찍는다.
