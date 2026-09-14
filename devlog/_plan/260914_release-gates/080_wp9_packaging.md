# 080 — wp9: 설치 패키징과 복구

감사 1라운드 지적 9·21 반영본. 전제: wp8의 `cm.js`와 해시.

## 범위 예외 (000의 out-of-scope와의 관계)

000은 「Aside 앱 설정 변경」을 범위 밖으로 둔다. 이 phase는 그 예외를 명시적으로 좁혀 받는다:
**설치기는 `~/.aside/u/<id>/` 아래 우리 manifest가 소유한 파일과 관리 AGENTS 블록만 쓴다.**
앱 환경설정, 계정 자격, `skills/builtin`, 사용자 대화, 다른 프로젝트 지침은 건드리지 않는다.

## 설치가 소유하는 파일 (manifest 목록)

스킬 파일과 `codemode/` 아래 파일은 저장소에도 계정 루트에도 **아직 없다.** 전부 NEW다.

        <accountRoot>/codemode/manifest.json              NEW
        <accountRoot>/codemode/cm.js                      NEW  (wp8 번들, 버전·해시 포함)
        <accountRoot>/codemode/catalog.json               NEW  (생성물: actions 카탈로그 스냅샷)
        <accountRoot>/skills/user/aside-codemode/SKILL.md  NEW
        <accountRoot>/skills/user/aside-codemode/references/execution-paths.md     NEW
        <accountRoot>/skills/user/aside-codemode/references/windows-invocation.md  NEW
        <accountRoot>/AGENTS.md                           MODIFY (관리 블록 구간만 치환)
        <projectRoot>/.aside/codemode/cm.js               NEW, --project를 준 설치에서만
                                                          (REPL fs가 계정 루트를 거절할 때의 읽기 사본, [070](070_wp8_native_helper.md))

`<accountRoot>`는 `~/.aside/u/<id>`이고 `u/0`으로 추측하지 않는다. `~/.aside/u/*`를 열거해 후보를 만들고,
어느 계정에 설치할지는 인자로 받는다. account 파일을 읽더라도 토큰·email은 receipt와 로그에서 제외한다.

## 관리 AGENTS 블록 (30줄 이하, 전문)

**표시자는 새로 만들지 않는다.** `src/register.js:15-16`이 이미 `<!-- aside-codemode:start -->` /
`<!-- aside-codemode:end -->`를 쓰고 있다. 다른 표시자를 도입하면 재설치 때 블록이 두 개가 된다.
이 phase는 `src/register.js`를 MODIFY해서 **같은 표시자 안의 본문만** 아래 내용으로 바꾼다.

현재 계정별 블록은 97줄/6.4KB다. 교체 후 본문은 다음 형태다:

        <!-- aside-codemode:start -->
        ## code mode  (vX.Y.Z)

        기본은 네이티브다. 처음 보는 페이지, 단일 클릭, 새 시각 판단, 계정·승인이 필요한 순간에는
        이 블록을 보지 말고 평소대로 조작한다.

        반복 구조가 확인되고 항목들이 서로 상태를 공유하지 않을 때만 배치로 전환한다.
        배치 방법과 실패·재개 규칙은 스킬에 있다: skills/user/aside-codemode/SKILL.md

        헬퍼 로드(앱 내부):
            const src = await fs.readFile('.aside/codemode/cm.js', 'utf8'); (0, eval)(src);

        외부 CLI가 필요할 때: codemode --code <file>  (호스트 파일 계층과 구조화 결과)

        하지 않는 것: 같은 탭의 동시 조작, 낡은 ref 재사용, 불확실한 부작용의 자동 재시도.
        <!-- aside-codemode:end -->

블록은 표시자 사이를 **통째로 치환**한다. 재설치를 반복해도 블록이 늘어나지 않는 근거가 이것이다.

## NEW scripts/install-codemode.mjs

서브커맨드: `install | upgrade | repair | uninstall | rollback | doctor`.

        manifest = { version, installedAt, accountRoot, files: [{ path, sha256 }], previous: <manifest|null> }

- 쓰기 전 기존 파일 해시를 manifest와 대조한다. 다르면 사용자 수정으로 보고 **보존**하고 이름으로 알린다.
- 삭제는 manifest가 소유한 파일에만. `skills/builtin`과 manifest 밖 파일은 열지 않는다.
- `repair`는 없는 파일만 복원하고 수정된 파일은 그대로 둔다.
- `rollback`은 `previous` 묶음을 통째로 되돌린다. 부분 롤백을 하지 않는다.
- `doctor`는 JSON으로 `{ version, accountRoot, files: [{ path, ok, reason }], agentsBlock: 'current|stale|absent' }`를 낸다.

## Windows 입력 경계

PowerShell 5.1, PowerShell 7, Git Bash, 직접 node 실행을 각각 검사한다.
복잡한 코드는 파일이나 stdin으로 넘기고, SSH에서는 인자 배열을 보존하는 launcher를 쓴다.
fixture 경로에 공백·한글·작은따옴표·`&`·`$`·CRLF를 넣는다.

## TESTS

- NEW `test/install-manifest.test.js`: 해시 대조, 사용자 수정 보존, 멱등 설치(블록 1개 유지), manifest 소유 파일만 삭제, rollback 복원.
- MODIFY `test/register.test.js`: 새 본문으로 두 번 설치해도 `aside-codemode:start` 표시자가 문서에 하나만 남는다.
- NEW `test/install-paths.test.js`: 공백/한글/따옴표 경로, `u/0`·`u/1` 동시 존재 열거, 토큰 미기록.

## Verification (C)

- `node --test test/install-manifest.test.js test/install-paths.test.js` — exit 0.
- 실기 2기기: clean install → `doctor` → upgrade → 파일 하나 삭제 후 `repair` → uninstall → rollback.
  각 단계의 종료 코드와 manifest diff를 이 문서에 기록한다.
- hosted CI 5조합 success at head.
