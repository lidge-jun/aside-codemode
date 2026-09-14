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
그리고 블록 본문은 `register.js` 안에 있지 않다. `register.js:230,257,288`이 읽는
**`templates/AGENTS.codemode.md`(현재 95줄)가 본문의 출처**다. 그 파일을 MODIFY하지 않으면
새 설치기가 짧은 블록을 써도 기존 register가 같은 표시자로 긴 템플릿을 되돌려 넣는다.
그래서 이 phase의 MODIFY 목록은 `templates/AGENTS.codemode.md`(본문 교체)와
`src/register.js`(짧아진 템플릿을 그대로 쓰는지 확인, 표시자·멱등 로직은 유지) 둘 다다.

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

## 착수 후 바뀐 결정과 실측 (2026-09-15)

**프로젝트 사본을 만들지 않는다.** 080의 파일 목록에는 `<projectRoot>/.aside/codemode/cm.js`가 조건부로 들어 있었다. 조건은 "REPL fs가 계정 루트를 거절할 때"였는데, [070](070_wp8_native_helper.md)에서 실제로 프로브해보니 계정 루트는 양 OS에서 읽힌다. 조건이 성립하지 않으므로 사본도 없다. manifest가 소유하는 파일은 다섯 개다.

    <accountRoot>/codemode/manifest.json
    <accountRoot>/codemode/cm.js
    <accountRoot>/codemode/catalog.json
    <accountRoot>/skills/user/aside-codemode/SKILL.md
    <accountRoot>/skills/user/aside-codemode/references/execution-paths.md
    <accountRoot>/skills/user/aside-codemode/references/windows-invocation.md

AGENTS.md는 목록에 없다. 우리가 소유하는 것은 표시자 사이의 블록뿐이고, 파일 자체는 사용자 것이다. uninstall은 블록만 걷어내고 문서는 남긴다.

**AGENTS 블록에 rg 금지와 Windows 셸 문장을 남겼다.** 080의 예시 본문은 그 둘을 스킬로 내보냈지만, 블록은 매 턴 읽히고 스킬은 불러야 읽힌다. "직접 rg/find/grep을 돌리지 마라"와 "`src/cli.js`를 부르지 마라"는 라우팅 규칙이라 블록에 있어야 하고, 긴 설명은 스킬로 갔다. 결과는 32줄이다. `test/readme-51x.test.js`가 블록 길이 상한과 "블록에서 뺀 내용이 스킬에 실제로 들어갔는지"를 둘 다 검사한다.

**바이트가 같은 기존 파일은 보존이 아니라 채택이다.** 처음 구현은 manifest가 모르는 파일을 전부 사용자 것으로 보고 건드리지 않았다. 그런데 wp8 프로브가 이미 `codemode/cm.js`를 깔아둔 기기에서는, 첫 설치가 자기가 쓰려던 것과 한 바이트도 다르지 않은 파일을 "사용자 수정"이라며 비켜간다. manifest는 맞는 파일을 두고 틀린 말을 하게 되고, 그 뒤 repair는 고칠 게 없다고 답한다. 해시가 같으면 채택해 manifest에 기록하고 `adopted`로 보고한다. 이 판정은 repair 필터 다음에 오므로 repair는 여전히 멀쩡한 파일을 skipped로 센다.

**manifest는 해시만 들고, 내용은 직전 세대 하나만 갖는다.** rollback 묶음은 업그레이드하는 순간 디스크에서 읽는다. 해시로 되살릴 수는 없고, 세대마다 내용을 쌓으면 manifest가 끝없이 자란다. 사용자가 고친 파일은 고친 그대로 기록된다 — 덮어쓰지 않고 보존했으니 그게 되돌아갈 상태다.

## 실기 검증 (mac + ssh mini)

임시 aside home에 계정 두 개(u/0, u/1)와 CRLF AGENTS.md를 두고 전 수명주기를 돌렸다. 양쪽 결과가 한 글자도 다르지 않다.

| 단계 | mac (darwin) | mini (win32) |
|---|---|---|
| install | exit=0 | exit=0 |
| doctor | exit=0, ok=false인 파일 0개 | exit=0, ok=false인 파일 0개 |
| upgrade (사용자 수정 뒤) | exit=0, 수정 보존됨 | exit=0, 수정 보존됨 |
| repair (cm.js 삭제 뒤) | exit=0, cm.js 복원, 수정은 그대로 | exit=0, cm.js 복원, 수정은 그대로 |
| rollback (cm.js 훼손 뒤) | exit=0, 원본 복원 | exit=0, 원본 복원 |
| uninstall | exit=0, 남은 파일 2개(AGENTS.md와 사용자가 고친 SKILL.md), 사용자 메모 보존, 블록 0개 | 동일 |
| 지정하지 않은 계정 u/1 | 파일 0개 | 파일 0개 |
| 설치 3회 뒤 표시자 수 | uninstall 후 0 | uninstall 후 0 |

실제 계정 루트에는 읽기 전용 `doctor`만 돌렸다. 계정 열거가 실기에서도 맞는다:
mac `/Users/jun/.aside/u/0`, mini `C:\Users\super\.aside\u\0`, 둘 다 `installed:false`.
wp8 프로브가 남긴 `codemode/probe.js`는 양쪽에서 지웠다.

로컬 단언: `test/install-manifest.test.js` 11건, `test/install-paths.test.js` 8건. 경로에 공백·한글·작은따옴표·`&`·`$`가 들어간 홈에서도 설치와 doctor가 통과하고, `accounts.json`의 토큰과 이메일은 manifest에도 반환값에도 들어가지 않는다.
