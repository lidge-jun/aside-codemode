# 080 — wp9: 설치 패키징과 복구

전제: wp8의 `cm.js`와 해시. 이 phase는 사용자가 실제로 들어오는 경로를 검사한다.

## 결정

- 관리 AGENTS 블록은 **경로와 선택 규칙만** 담는다. 현재 계정별 97줄/6.4KB를 30줄 이하로 줄이고,
  API 설명·오류 사례·플랫폼별 호출법은 스킬과 references로 옮긴다.
- 사용자 스킬은 `<accountRoot>/skills/user/aside-codemode/`에 둔다(`SKILL.md`, `references/`, `scripts/`).
  `skills/builtin`은 읽기만 한다. visual-browse·captcha-solver·password-manager를 복사하거나 덮어쓰지 않는다.
- account root를 `u/0`으로 추측하지 않는다. `~/.aside/u/*`를 열거하고, 어느 계정에 설치할지는 사용자 선택으로 받는다.
  account 파일을 읽더라도 토큰·email은 receipt와 로그에서 제외한다.
- 설치기는 runtime만 바꾸지 않는다. `runtime + cm.js + 스킬 + 생성 catalog + AGENTS 블록`을 한 묶음으로 전환하고 기록을 남긴다.

## NEW scripts/install-codemode.mjs

서브커맨드: `install | upgrade | repair | uninstall | rollback | doctor`.

- manifest `~/.aside/u/<id>/codemode/manifest.json`: `{ version, installedAt, files: [{ path, sha256 }], previous: <manifest|null> }`.
- 설치 전 기존 파일의 해시를 manifest와 대조한다. 다르면 **사용자 수정으로 보고 보존**하고 충돌을 이름으로 알린다. 덮어쓰지 않는다.
- 삭제는 manifest가 소유한 파일에만 한다. builtin 파일, 사용자 금고, 사용자 대화, 다른 프로젝트 지침은 건드리지 않는다.
- 재설치를 반복해도 AGENTS 블록·스킬·PATH 항목이 늘어나지 않는다(블록은 표시자 사이를 통째로 치환).
- `rollback`은 `previous` manifest의 묶음을 그대로 되돌린다. 부분 롤백을 하지 않는다.

## Windows 입력 경계

PowerShell 5.1, PowerShell 7, Git Bash, 직접 node 실행을 각각 검사한다.
복잡한 코드는 파일이나 stdin으로 넘기고, SSH에서는 인자 배열을 보존하는 launcher를 쓴다.
fixture에 공백·한글·작은따옴표·`&`·`$`·CRLF가 든 사용자명과 설치 경로를 넣는다.
(`267ccff`가 고친 명령행 길이 문제와 같은 계열의 결함을 미리 막는 것이 목적이다.)

## TESTS

- NEW `test/install-manifest.test.js`: 해시 대조, 사용자 수정 보존, 멱등 설치, manifest 소유 파일만 삭제, rollback 복원.
- NEW `test/install-paths.test.js`: 공백/한글/따옴표 경로, 계정 루트 열거(`u/0`, `u/1` 동시 존재), 토큰 미기록.

## Verification (C)

- `node --test test/install-manifest.test.js test/install-paths.test.js` — exit 0.
- 실기 검증 2기기: clean install → `doctor` → upgrade → 파일 하나 삭제 후 `repair` → uninstall → rollback.
  각 단계의 종료 코드와 manifest diff를 이 문서에 기록한다. 사용자가 권한을 넓히거나 파일을 복사해 수리하지 않아야 통과다.
- hosted CI 5조합 success at head.
