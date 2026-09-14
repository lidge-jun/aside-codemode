# 030 — wp3: 설치 수명 (감사 1차 반영본)

## 먼저 고쳐야 할 코드 결함

`runInstaller`의 upgrade는 `applyWrites`로 디스크를 먼저 덮고, 그다음
`snapshotForRollback`이 **그 덮인 디스크를** 읽는다. 그래서 `previous.content`에 구
바이트가 아니라 방금 쓴 새 바이트가 들어간다. 바이트가 바뀌는 upgrade 뒤의 rollback은
구 helper를 되돌리지 못한다. 기존 단위 테스트는 install과 upgrade가 같은 바이트일 때만
돌려서 이 결함을 못 잡았다.

순서: (1) 바이트가 바뀌는 upgrade → rollback이 구 바이트를 되돌리는지 보는 테스트를
먼저 쓴다(지금 실패해야 한다). (2) 스냅샷을 `applyWrites` 앞으로 옮긴다. (3) 테스트가
통과하는지 본다.

`repair`도 같은 문제를 갖는다. manifest를 planned 해시로 다시 쓰면서 `previous`를
갈아치운다. rollback 증명 전에 repair를 두지 않는다.

## 라이브 계정에서 할 것과 하지 않을 것

| | 라이브 실계정 | 복사한 `--aside-home` |
|---|---|---|
| doctor | 한다 | 한다 |
| install / upgrade | 백업 뒤에만 한다 | 한다 |
| repair (파일 삭제 후 복원) | **안 한다** | 한다 |
| uninstall | **안 한다** | 한다 |
| rollback | **거절 확인만** 한다 | 한다 |

이유는 설치기에 backup/rename이 없기 때문이다. uninstall은 소유 파일을 지운 뒤
`codemode/manifest.json`을 지우는데, previous 내용은 그 manifest에만 있다. 중간에 죽으면
되돌릴 핸들이 없다. rollback은 `inspectFile` 없이 previous를 전부 덮어써서 사용자가
이후 고친 파일도 덮는다.

현재 실계정 네 루트는 모두 `previous: null`이라 지금 rollback은 `ok:false`, exit 1이다.
그 거절을 doctor 출력과 함께 기록하는 것이 라이브에서 할 전부다.

## 순서

1. 라이브 백업: mac u/0·u/1·u/2와 mini u/0의 `codemode/`, `skills/user/aside-codemode/`,
   `AGENTS.md`를 `evidence/release-260915/backup/`에 복사한다.
2. 복사본 리허설: `--aside-home`을 임시 디렉터리로 두고 install → 사용자 수정 한 줄 →
   upgrade(보존 확인) → 파일 삭제 → repair(복원 확인) → rollback(구 바이트 확인) →
   uninstall(leftover 확인) → 재install.
3. 라이브 upgrade: `--account`를 명시해 계정마다 따로 돌린다. u/1·u/2도 같은 artifact로
   올려 계정 간 해시를 하나로 맞춘다.
4. 라이브 doctor로 네 루트의 상태와 sha256을 찍는다.

모든 파괴적 동사에 `--account <id> --json`을 붙인다. 인자를 비우면 `accounts.json`의
`currentAccountId`를 따라가서, 리허설 중 사용자가 계정을 바꾸면 엉뚱한 루트를 건드린다.

## 통과 조건

복사본에서 여섯 동사가 사용자 수정을 보존하며 끝나고, 라이브에서는 백업 뒤 upgrade와
doctor만으로 네 루트가 새 helper 바이트를 갖고, 재설치가 `aside-codemode:start` 개수를
루트당 1로 유지한다.
