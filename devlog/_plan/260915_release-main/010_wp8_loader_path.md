# 010 — wp8: 로더 경로 계약 (감사 1차 반영본)

## 무엇이 틀렸나

설치된 스킬과 AGENTS 블록은 헬퍼를 이렇게 읽으라고 안내한다.

    const src = await fs.readFile('../../codemode/cm.js', 'utf8'); (0, eval)(src);

260914의 070은 이 상대 경로가 "REPL의 세션 디렉터리에서 풀린다"고 적었다. 그 프로브는
`aside repl` CLI 한 표면만 쟀고, 그 표면에서는 맞다.

## 두 표면

**`aside repl` CLI (mac, 2026-09-15, 우리가 직접 측정):**

    abs   OK 6317
    rel2  OK 6317                     ../../codemode/cm.js
    rel0  FAIL ENOENT .../sessions/2026-09-15_jZD9WRgznHW00NhC/codemode/cm.js
    rel1  FAIL ENOENT .../sessions/codemode/cm.js

기준은 `<accountRoot>/sessions/<id>/`다.

**앱 내부 에이전트 REPL (사용자 보고, 같은 날):** 같은 두 줄이
`Path escapes Project and session roots`로 거절됐고, 절대 경로
`/Users/jun/.aside/u/0/codemode/cm.js`로는 읽혀 `cm.run`까지 붙었다. 사용자는 기준이
계정 루트라고 보고했다. **우리는 이 표면의 기준 디렉터리를 직접 재지 않았다.** 계정
루트가 기준이라면 `../../`는 `~/.aside/codemode/cm.js`로 풀린다. 앱에서 `codemode/cm.js`
(한 단계도 올라가지 않는 형태)가 읽히는지도 측정한 적이 없다.

확실한 것은 교집합이다. CLI에서 되는 것은 `{abs, rel2}`, 앱에서 확인된 것은 `{abs}`.
**두 표면에서 모두 확인된 형태는 절대 경로 하나뿐이다.**

## 고칠 것

설치기는 이미 `{{NODE}}`와 `{{CLI}}`를 기기별 절대 경로로 채운다. 같은 자리에
`{{HELPER}}`를 더해 계정 루트의 절대 경로를 채운다. 안내 본문은 절대 경로를 쓰고,
`../../` 형태는 "CLI에서만 맞는 형태"로 각주에 남긴다.

| 파일 | 변경 |
|---|---|
| `src/host/browse/helper-bundle.js` | `helperLoadAbsPath(accountRoot)` 추가. `HELPER_LOAD_RELPATH`는 CLI 전용임을 주석으로 못 박되 이름은 그대로 둔다(소비처를 깨지 않는다). `HELPER_VERSION`을 1.1.0으로 올린다 |
| `scripts/install-codemode.mjs` | `fill()`과 `plannedFiles()`가 `accountRoot`를 받아 `{{HELPER}}`를 채운다. `runInstaller`의 호출부도 같이 바뀐다 |
| `src/register.js` | `applyRegister()`가 body를 계정 루프 **안에서** 계정마다 만든다. 한 계정 경로를 다른 계정에 복제하지 않는다 |
| `templates/skill/SKILL.md` | 로더 두 줄을 `{{HELPER}}`로, 아래에 두 표면 차이 한 문단 |
| `templates/skill/references/execution-paths.md` | "세션 디렉터리에서 풀린다"는 단정을 표면별 서술로 |
| `templates/AGENTS.codemode.md` | 블록 안 로더 예시를 `{{HELPER}}`로 |
| `templates/native-helper/cm.js` | 머리말은 **계정 비의존** 문장으로만 고친다. 절대 경로를 새기지 않는다 |
| `test/readme-51x.test.js` | 플레이스홀더 집합에 `{{HELPER}}`를 더한다 |
| `test/helper-bundle.test.js` | 상대 경로 단언을 CLI 전용으로 표시하고 절대 경로 헬퍼 단언을 더한다 |
| `test/install-paths.test.js`, `test/register.test.js` | 렌더된 SKILL/AGENTS가 계정별 절대 경로를 담는지 단언 |
| `eval/workloads/*.json` | CLI 워크로드임을 명시하거나 절대 경로로 옮긴다 |
| `scripts/probe-native-helper.mjs` | `HELPER_LOAD_RELPATH`를 쓰는 실제 소비자다. PROGRAM의 로더를 절대 경로로 바꾸고, 상대 경로는 CLI 전용 부가 검사로 남긴다 |

## Windows 문자열

`path.win32.join`이 만드는 역슬래시 경로를 작은따옴표 JS에 그대로 넣으면
`Invalid Unicode escape sequence`로 파싱이 죽는다. **방식은 하나로 고정한다: POSIX
슬래시.** `{{HELPER}}`는 항상 `/`로 정규화된 경로를 넣는다(`C:/Users/super/.aside/u/0/codemode/cm.js`).
`JSON.stringify`는 쓰지 않는다 — 템플릿이 placeholder를 이미 작은따옴표 안에 두고 있어서
따옴표가 중첩된다. 070의 CLI 프로브도 슬래시 형태가 Windows에서 읽히는 것을 보였다.
테스트는 렌더된 줄을 실제로 파싱해 `fs.readFile`의 첫 인자가 그 경로 문자열인지까지 본다.

## 먼저 실패해야 하는 반례

1. 렌더된 SKILL.md와 AGENTS 블록이 계정 루트 절대 경로를 담는다 — 지금 실패.
2. 렌더된 본문의 첫 로더 지시가 `../../`로 시작하지 않는다 — 지금 실패.
3. Windows 계정 루트로 렌더한 로더 줄이 파싱된다 — 지금은 해당 줄 자체가 없다.
4. 두 계정 루트로 렌더하면 서로 다른 절대 경로가 나온다 (register 경로 포함) — 지금 실패.

## 이 단계가 바꾸는 것

helper 바이트와 버전이 바뀐다. 이미 설치된 네 루트(mac u/0·u/1·u/2, mini u/0)는 모두
구 바이트 `63562408f207…`을 갖고 있고 `previous: null`이다. 재설치 동사는 **upgrade**로
고정한다. `repair`를 먼저 돌리면 manifest가 planned 해시로 갱신되면서 디스크의 구
`cm.js`가 `modified`로 보이고, 그다음 upgrade가 그것을 사용자 수정으로 보존해 새 helper가
영원히 안 들어간다. 그 순서를 금지한다.

그리고 upgrade 자체가 지금 안전하지 않다 — wp3의 첫 작업이 그 결함이다.
