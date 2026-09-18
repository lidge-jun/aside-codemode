<p align="center"><img src="assets/logo.png" alt="aside-codemode" width="112"></p>
<h3 align="center">make aside 50x faster</h3>
<p align="center"><b>페이지 대신 행, 카드 50장 대신 한 장</b><br>
실제 페이지 다섯 개는 HTML 1.87MB입니다. 거기서 알고 싶은 것의 답은 4.4KB입니다. 호출 한 번이 그 4.4KB를 돌려줍니다.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/aside-codemode"><img src="https://img.shields.io/npm/v/aside-codemode?color=cb3837&label=npm&logo=npm" alt="npm version"></a>
  <a href="https://github.com/lidge-jun/aside-codemode/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/aside-codemode?color=blue" alt="license"></a>
  <img src="https://img.shields.io/node/v/aside-codemode?logo=node.js&label=node" alt="node version">
  <a href="https://github.com/lidge-jun/aside-codemode/actions/workflows/ci.yml"><img src="https://github.com/lidge-jun/aside-codemode/actions/workflows/ci.yml/badge.svg?branch=main" alt="ci"></a>
</p>

```bash
npm install -g aside-codemode
codemode --install-mcp
codemode --doctor
```

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a></p>

### 브라우징: 1.87MB가 들어가고 4.4KB가 나옵니다

페이지 다섯 개에서 하나씩, 제목과 첫 링크를 찾습니다.

|  | 페이지를 읽을 때 | `browse.exec` 한 번 |
| --- | --- | --- |
| fetch 기반 도구가 모델에 넣는 것 | HTML 1,865,043바이트 | 타입 있는 행 4,430바이트 |
| 네이티브로 읽는 에이전트가 넣는 것 | 접근성 트리 71,983자, 다섯 중 셋은 상한에서 잘림 | 같은 4,430 |
| 왕복 | 5번 | 1번 |
| 다섯 페이지 실측 시간 | — | 2.5초 |

```js
const res = await browse.exec({
  urls,
  extract: { title: 'title', firstLink: { selector: 'a', attr: 'href' } },
});
return res.items;   // 타입 있는 행 다섯 개, 4,430바이트, status completed
```

**원본 페이지 대비 421배, Aside가 모델에 보여줬을 것 대비 16배입니다.** 두 숫자 모두
[측정 노트](evidence/browse-compression-260915.md)에 페이지별 바이트, 세 번의 실행, 그리고 captcha로
답해서 뺀 페이지 두 개까지 적혀 있습니다. 압축되는 것은 **답**입니다. 페이지 전체를 달라고 하면
페이지 전체가 옵니다. 접근성 트리 다섯 중 셋이 20,000자 상한에 걸렸으니, 그 세 페이지에서는
네이티브 경로도 완전한 답을 들고 있지 않았습니다.

### 파일: 55초가 1초가 됩니다

프로젝트에서 `TODO`가 들어간 파일 50개를 찾아 경로만 돌려받는 일입니다.

|  | 네이티브 | `codemode --code` 한 번 |
| --- | --- | --- |
| Aside 화면에 쌓이는 카드 | 50장 | 1장 |
| 왕복 | 50번 | 1번 |
| 모델에 들어가는 것 | 파일 50개의 모든 바이트 | 요청한 경로 5개 |

```js
const hits = await search.content({ path: ".", query: "TODO", max: 50 });
return [...new Set(hits.rows.map((r) => r.file))].slice(0, 5);
```

실제 개발 폴더에서 `find`+`grep`은 **55초**, `codemode --code` 한 번은 **1초**였습니다.
대략 **51배**입니다. 이 한 쌍은 운영자가 직접 재서 알려준 값이고, [측정 노트](evidence/dev-folder-51x.md)도
그렇게 적혀 있습니다. 어느 폴더였는지, 반올림하지 않은 시간과 실제 옵션이 무엇이었는지는 남기지
않았습니다. 노트에 남아 있는 건 이 저장소에서 누구나 다시 돌릴 수 있는 합성 대조 쪽입니다. 둘을
따로 적어 둔 이유도 같습니다. 같은 실행이 아니니까요.

예전에 재 둔 Aside 턴 비교(모델·데몬 포함)는 단일 검색 1.05~1.81배입니다. 그 표가 폴더에서 잰 시간을 없던 일로 만들지는 않습니다. [예전 표](#performance-evidence).

**aside-codemode**는 Aside의 로컬 검색·필터링·다파일 읽기·요약을 코드 호출 한 번으로 묶습니다.
브라우징을 켜면 페이지 스무 개를 세션 하나로 도는 일도 같은 자리에서 합니다. 중간 데이터를 모델에
다 넘기지 않고, 판단에 필요한 결과와 근거만 돌려줍니다.

네이티브 MCP가 코드 모드의 주 경로입니다. 도구 목록을 캐시에 채우면 Aside가
`mcp__aside-codemode__execute_code`를 바로 붙입니다. MCP 서버를 붙이지 못하는 호스트나 화면에
bash 카드가 보이는 방식을 선호하는 사용자는 CLI 경로를 이어서 쓸 수 있습니다. 화면에 뜨는 파일
카드는 네이티브 `read_file` / `write_file` / `edit_file`이고, 게스트 JS도 같은 모양을 씁니다.

## Requirements

- Node.js 18 이상
- CLI 경로에서 쓸 ripgrep. MCP 경로는 macOS와 Windows에서 Aside 번들 네이티브 ripgrep을 자동으로 찾습니다. `CODEMODE_RG` / `rgPath`는 명시적 재정의로 남습니다
- macOS, Windows

## 설치

패키지는 한 번 설치한 뒤 경로 1인 네이티브 MCP를 설정합니다. 호스트가 MCP 서버를 붙이지 못하거나
계정 안내와 화면에 보이는 bash 카드가 필요하면 경로 2를 씁니다.

```sh
npm install -g aside-codemode
codemode --install-mcp
codemode --doctor
```

고쳐 쓸 생각이면 클론에서 설치하세요.

```sh
git clone https://github.com/lidge-jun/aside-codemode.git
cd aside-codemode
npm install -g .        # or: npm link
codemode --doctor
```

### 경로 1: 네이티브 MCP

Aside에는 MCP 클라이언트가 들어 있습니다. 설치한 CLI가 `aside-codemode`를 등록하고, 실행 중인
Aside 데몬 안에서 도구 목록 마이그레이션을 초기화한 다음 일반 세션 하나로 도구를 찾습니다. 마지막에는
Aside가 저장한 도구 목록까지 확인합니다.

```sh
codemode --install-mcp --account u1
```

`--account`는 생략할 수 있습니다. 지정할 때는 `~/.aside/u/`에 있는 `u<n>` 이름을 씁니다. 결과를
기계가 읽어야 하면 `--json`을 붙입니다. Aside CLI 1.26.906.1630을 쓴 macOS 실측에서는 데몬 설정
단계가 종료 코드 0으로 끝났고, 마이그레이션 버전 0과 빈 도구 목록 맵을 다시 읽었습니다. 이어진 찾기
세션도 종료 코드 0이었고, `settings.json`에는
`inventories["aside-codemode"].tools = ["execute_code"]`가 남았습니다. 설정 창이나 데몬 재시작 없이
[처음 실측한 실행은 17초](evidence/aside-mcp-activation-260918.md)였고, 이미 등록된 서버를 상대로
다시 실행했을 때는 3초였습니다. 두 경우 모두 설정 창을 열거나 데몬을 재시작하지 않았습니다.
같은 명령을 Windows에서 전역 설치로도 실측했고, `activated: true`와 `execute_code` 캐시까지
같은 결과가 나왔습니다.

MCP 서버는 macOS와 Windows에서 Aside 번들 네이티브 ripgrep을 자동으로 찾습니다. 다른 바이너리를
쓰고 싶을 때만 codemode 설정의 절대 `rgPath`나 `CODEMODE_RG`로 재정의합니다. CLI가 도구 목록을
꾸며서 넣지는 않습니다. Aside 데몬이 `execute_code`를 직접 찾아 캐시에 넣고, 새 세션에는
`mcp__aside-codemode__execute_code`로 붙입니다.

데몬의 `set()`은 `mcp` 객체 전체를 바꾸므로 다른 서버의 도구 목록 캐시도 모두 사라집니다. 이어지는
찾기 과정은 그 서버들을 다시 방문합니다. 이때 연결할 수 없는 서버는 Aside가 끄고 자동으로 다시
시도하지 않습니다. 그래서 `codemode --install-mcp`는 다른 활성 MCP 서버나 다른 도구 목록 캐시가
하나라도 있으면 거부합니다. 위험한 서버 이름과 원래 실행할 두 명령을 보여주고 설정은 바꾸지 않습니다.
도구를 전부 다시 찾는 데 동의한다면 `codemode --install-mcp --account u1 --force`를 씁니다.

`--force`는 그냥 밀어붙이는 옵션이 아닙니다. 쓰기 전에 계정의 `mcp` 객체 전체를 데몬에서 꺼내
설정 파일 옆에 `settings.json.codemode-bak-<stamp>`로 저장합니다. 찾기 세션이 실패하거나 그 뒤에
`execute_code`가 목록에 없으면 그 스냅샷을 그대로 되돌리고 결과에 `rolledBack`을 적습니다.
성공하면 Aside의 마이그레이션이 끝날 때까지 기다린 뒤, 전에는 켜져 있었는데 지금 꺼져 있는 서버를
다시 켜고 그 이름을 `restored`에, 캐시를 잃은 서버 이름을 `lostInventories`에 적습니다. 캐시는
손으로 다시 쓰지 않습니다. 그건 아무도 다시 읽지 않은 도구 정의를 사실처럼 적는 일이고, Aside가
다음 세션에서 알아서 만듭니다. 도달 불가 서버를 넣고 [실측한 결과](evidence/mcp-force-restore-260918.md),
Aside는 2.0초에 그 서버를 껐고 복원은 3.6초에 다시 켰습니다.

다른 MCP 서버를 쓰는 기계에서는 예전 파일 기반 경로도 그대로 쓸 수 있습니다. 패키지 체크아웃에서
`node scripts/install-codemode.mjs install --account 0 --json`을 실행해 `settings.json`을 쓴 다음,
**Settings > Plugins & MCPs > MCPs**에서 `aside-codemode`를 고르고 **Refresh tools**를 실행합니다.
다른 방법은 Aside 데몬을 재시작해 `settings.json`을 다시 읽힌 뒤 일반 세션 하나로 도구를 찾는
것입니다. 새 작업 세션을 열기 전에 `execute_code`가 캐시에 들어왔는지 확인합니다.

지금 어느 상태인지는 직접 짐작하지 않아도 됩니다. `codemode --doctor`가 계정마다 하나씩
알려줍니다. `not-registered`, `registered-not-activated`, `activated`, 그리고 예전 설치를
가리키고 있으면 `stale-entry`입니다. `activated`가 아니면 다음에 할 일을 같이 적어줍니다.
CLI는 Aside의 도구 목록 캐시를 손으로 쓰지 않습니다. 그렇게 만든 캐시는 도구 정의가 바뀌는
순간 조용히 낡습니다.

이제 에이전트는 `mcp__aside-codemode__execute_code`를 바로 호출합니다. **2,019바이트**짜리 도구
설명은 모든 MCP 세션의 문맥에 항상 들어갑니다. CLI의 3,808바이트짜리 계정 블록보다 상주 문맥이
작다는 점도 MCP를 주 경로로 삼은 이유입니다.

데몬이 서버를 띄울 때 넘기는 환경 변수는 여섯 개뿐이고 cwd도 데몬의 앱 디렉터리입니다. PATH에는
ripgrep이 없습니다. 서버는 PATH 대신 Aside 번들 네이티브 바이너리를 직접 찾습니다. macOS 번들은
PCRE2 지원 ripgrep 15.2.0, Windows 번들은 PCRE2 지원 15.1.0입니다. 절대 `rgPath`나 `CODEMODE_RG`를
설정하면 자동으로 찾은 값보다 우선합니다.

### 경로 2: CLI와 계정 안내

이 경로에서는 CLI만 설치해도 에이전트가 바로 쓰지는 못합니다. Aside에 절대 node/CLI 경로 쌍을
알려주고 호출 모양을 적은 스킬을 건네야 합니다. 계정을 지정한 명령 하나로 설치합니다.

```sh
node scripts/install-codemode.mjs install --account 0 --json
```

그 계정 루트에 파일 여섯 개를 쓰고, `AGENTS.md` 안에 마커로 감싼 블록 하나를 넣습니다.

```
codemode/cm.js                                     Aside REPL이 읽는 배치 헬퍼
codemode/catalog.json                              액션 카탈로그
codemode/manifest.json                             이 설치가 소유한 것, 해시로
skills/user/aside-codemode/SKILL.md                언제 묶고, 결과를 어떻게 읽는지
skills/user/aside-codemode/references/*.md         호출 모양, 실행 경로, Windows 따옴표
AGENTS.md  <!-- aside-codemode:start … end -->     매 턴 읽히는 블록
```

경로 2가 소유하는 것은 위에 적은 파일과 마커 블록뿐입니다. 자격증명, 세션, 메모리, 다른 스킬은
우리 것이 아니라 열지도 않습니다. 사용자가 고친 파일은 덮어쓰지 않고 `preserved`에 이름을 적어 남기고,
`doctor`는 기계가 릴리스보다 뒤처졌을 때 그렇게 말하며, `uninstall`은 해시가 여전히 맞는 파일만
지우고 `AGENTS.md`에서 자기 블록만 빼며 나머지는 그대로 둡니다.

`--account`는 항상 주세요. 없으면 `accounts.json`의 `currentAccountId`를 따라가는데, 그 값은
모르는 사이에 바뀔 수 있습니다. 업그레이드할 때마다 다시 돌리세요. 안내 문서만 바뀐 릴리스도
계정을 stale로 만들고, `doctor`가 그렇게 말합니다.

브라우징에는 세 번째 단계가 없습니다. 기본으로 켜져 있습니다.

에이전트는 절대 node/CLI 경로 쌍을 bash 한 번으로 불러 코드 모드에 들어갑니다. 항상 문맥에
들어가는 계정 `AGENTS.md` 블록은 **3,808바이트**이고, 설치된 사용자 스킬 **8,973바이트**는
필요할 때만 읽습니다. MCP 서버를 붙이지 못하는 호스트나 계정 안내와 화면에 보이는 bash 호출을
선호하는 사용자를 위한 지원 경로입니다.

### MCP로 옮긴 뒤 CLI 경로 파일 지우기

네이티브 MCP가 정상 동작하면 계정 하나의 경로 2 파일을 다음 명령으로 지웁니다.

```sh
node scripts/install-codemode.mjs uninstall --account 0 --json
```

제거기는 `AGENTS.md`의 관리 대상 `aside-codemode` 마커 블록, 설치된 사용자 스킬과 참조 문서,
`codemode/cm.js`, `codemode/catalog.json`, manifest를 지웁니다. 설치 파일은 당시 해시와 같은 것만
지우며, 사용자가 고친 파일은 `preserved`에 이름을 남기고 보존합니다. 소유권 확인이 끝나면
manifest 자체는 지웁니다. `AGENTS.md`의 나머지 내용,
자격증명, 세션, 메모리, 다른 스킬, `settings.json`, MCP 설정과 도구 목록은 건드리지 않습니다.
네이티브 MCP 등록도 그대로 남습니다. npm으로 설치한 패키지, 저장소 체크아웃,
`codemode.config.json`, 사용자가 고친 파일, 비어 있지 않은 사용자 디렉터리도 남습니다.

명령 대신 Aside에 부탁하려면 아래 문장을 그대로 붙여 넣습니다.

```text
~/.aside/u/<n>/ 계정에서 aside-codemode의 CLI 경로 파일을 정리하세요. AGENTS.md에서는 관리 대상 aside-codemode 마커 블록인 <!-- aside-codemode:start -->부터 <!-- aside-codemode:end -->까지만 지우고 블록 밖의 내용은 모두 그대로 두세요. 설치된 skills/user/aside-codemode 스킬과 참조 문서, codemode/cm.js, codemode/catalog.json, codemode/manifest.json은 이 설치가 소유한 파일일 때만 지우고 사용자가 고친 파일은 보존하세요. settings.json과 모든 MCP 설정은 건드리지 마세요.
```

### PATH의 명령은 누가 쓰나

경로 1은 설정된 MCP 서버를 바로 부르므로 PATH에서 `codemode`를 찾지 않습니다. 경로 2에서
PATH의 `codemode`는 **운영자**용입니다. Aside 에이전트는 설치가 AGENTS 블록에 적어 준 절대 경로
쌍(`process.execPath`과 이 설치의 `bin/codemode.mjs`)을 쓰며, PATH에서 `node`나 `codemode`를
찾지 않습니다.

```sh
codemode --code "return (await search.files({ path: '/Users/me/proj', glob: '**/*.ts' })).length"
codemode --doctor
```

`npm prefix -g`가 PATH에 없으면(Aside는 `NPM_CONFIG_PREFIX`를 켜고, 이게 기본보다 앞섭니다) prefix를 직접 줍니다.

```sh
npm install -g --prefix=/opt/homebrew .
```

## Project cwd

우선순위는 `--cwd <abs>` > `CODEMODE_CWD` > `process.cwd()`입니다. 게스트의 상대경로는 그 디렉터리를 기준으로 붙습니다. 자식 에이전트는 고치는 프로젝트의 `--cwd`를 넘기면 됩니다. `--cwd`를 빼는 건 오류가 아닙니다. 값 없이 `--cwd`만 주면 `{ok:false,error:"--cwd requires a directory path"}`입니다.

## Guest API

코드는 async 함수 본문입니다. `return`이 답입니다. 게스트 API에는 `require`, `process`, `fetch`, 네트워크 도구를 노출하지 않습니다. 적대적인 코드의 접근을 차단한다는 보장은 아닙니다.

| 이름 | 역할 |
| --- | --- |
| `search.files` / `search.content` / `search.count` | ripgrep 목록, 내용, 사전 카운트 |
| `read_file({ path, offset?, limit? })` | Aside 모양 읽기. `offset` / `limit`는 1부터 세는 **줄**. 페이지 없이 262144바이트를 넘기면 던집니다 |
| `write_file({ file_path, content })` | Aside 모양, 생성만 (`wx`). 덮어쓰면 던집니다 |
| `edit_file({ path, appendText?, edits })` | 원본에서 유일한 `oldText` → `newText` |
| `apply_patch(text)` | 게스트 헬퍼. Codex `*** Begin Patch` 텍스트를 `write_file` / `edit_file`로 바꿉니다. 성공은 `{}`. AGENTS 동사가 아닙니다 |
| `fs.readMany` / `grepFile` / `mkdir` / `stat` / `exists` / `list` | 묶음 헬퍼. `fs.read` / `fs.write`는 바이트/덮어쓰기용 구형 별칭입니다 |
| `actions.list` / `find` / `describe` / `check` | 샌드박스 안 탐색 |
| `browse.probe()` | 설치된 Aside 빌드를 실제로 재서 만든 기능표. 어떤 page 메서드가 있는지, 어떤 옵션이 조용히 무시되는지, 왜 거절되는지를 돌려줍니다 |
| `browse.exec(job)` | URL 묶음을 Aside REPL 세션 하나로 처리합니다. `{ items, partial, leakedUrls }`를 돌려주고, 한 URL이 실패해도 나머지 결과가 비지 않습니다 |

### 브라우징은 기본으로 켜져 있습니다

설치한 그대로 `browse`를 부를 수 있습니다. 끄고 싶은 기계는 설정에서 `browseCaps.enabled`를
false로 두면 되고, 그러면 모든 호출이 `EDISABLED`와 함께 되돌리는 명령 하나
(`codemode --enable-browse`)를 알려주며 거절합니다.

### `ok`는 "페이지를 읽었다"가 아닙니다

`ok`는 실행이 끝났다는 말이지 페이지가 그려졌다는 말이 아닙니다. Threads는 제목까지 맞게 `ok: true`를
돌려줬는데 본문은 부트스트랩 JSON뿐이고 글은 하나도 없었습니다. 판정을 원하면 요청하세요.
`requireSelector`나 `minTextChars`가 `contentVerified`를 채우고, `requireContent: true`는 확인에
실패한 항목을 실패로 만듭니다. 아무것도 주지 않으면 `contentVerified`는 `null`입니다. 아무도 묻지
않았으니까요. `scriptRatio`는 보고만 하고 판정에 쓰지 않습니다. 요즘 SPA는 전부 인라인 스크립트가
크기 때문에, 그걸로 판단하면 거짓 성공을 거짓 실패로 바꾸는 것뿐입니다.

### Aside가 못 하는 일은 띄우기 전에 말합니다

다섯 가지는 받아들이는 척하지 않고 `ENOTSUP`으로 막습니다. `page.route`, 스크린샷 `maxWidth`,
`pdf({format:'A4'})`, `file://` 주소, `networkidle`. 전부 받아들여진 뒤 조용히 무시되거나 바뀌는
것을 직접 재서 확인했습니다. `format:'A4'`는 레터를 만들고 `maxWidth`는 원본 크기를 그대로
돌려줍니다. 읽을 수 있는 거절이 믿을 수 없는 결과보다 낫습니다.

바탕에 깔린 동작도 두 가지 알아 두면 좋습니다. Aside CLI는 실패해도 종료코드가 `0`이라,
성공 판정은 끝줄 `[ok | Nms]` 마커와 만들었다는 파일이 실제로 있는지 확인하는 것뿐입니다. 그리고
CLI를 죽이면 그 탭이 영구히 남아 이후 세션에서도 닫을 수 없어서, 스크립트는 자기 데드라인이
호스트 데드라인보다 먼저 끝나도록 잡습니다. 그래도 호스트가 죽이면 깨끗한 결과인 척하지 않고
`partial: ['host-kill']`과 해당 URL을 함께 돌려줍니다.

`codemode --doctor --browse`로 설치된 빌드의 전체 표를 볼 수 있습니다.

**기본은 `.gitignore`를 따릅니다.** 상위 ignore 한 줄이 프로젝트 전체를 가릴 수 있습니다. 어떤 트리에서는 히트 대부분이 빠지고 그 프로젝트 README까지 빠지는 걸 실제로 확인했습니다. 없다고 단정하기 전에 `noIgnore: true`로 `search.count`를 한 번 더 보세요. 점파일은 `hidden: true`입니다.

포함형 `glob`(예: `**/*.js`)은 ripgrep `-g` / `--glob`입니다. `noIgnore`와 `hidden`이 false여도 gitignore나 숨김 파일 일부가 맞을 수 있습니다. 워크스페이스 탈출이 아니라 ripgrep의 glob 우선순위이며, `-uuu`와는 다릅니다. 제외 glob(`-g '!…'`)은 여전히 가립니다. ignore/점파일을 glob 없이 다루려면 `noIgnore` / `hidden`을 직접 켜세요.

**`max`는 전체 행 상한**입니다. 파일마다 자르는 ripgrep `--max-count`가 아닙니다. 한 행을 추가로 확인해 정확히 `max`개인 완전한 결과와 그보다 많은 결과를 구분한 뒤 중단합니다.

게스트 안에서는 검색 결과에 `.map`, `.filter`, `.length`를 그대로 사용할 수 있습니다. 검색 결과를 직접 또는 다른 객체 안에 넣어 반환하면 `{ rows, complete, truncated, partial, scope }` 형태로 직렬화됩니다. count는 `{ matches, files }`에 같은 메타데이터를 담아 반환합니다. `complete`는 선택한 검색 범위를 잘림·읽기 오류 없이 확인했다는 뜻이지, ignore나 제외 설정 밖의 파일까지 찾았다는 뜻이 아닙니다. 실제 범위는 `scope`로 확인합니다. `.length`나 가공한 배열만 반환할 때는 필요한 메타데이터를 명시적으로 함께 반환하세요.

`context`는 검색 행의 앞뒤 문맥을 반환합니다. 모르는 옵션과 잘못된 값은 거절합니다. `includeExcluded: true`는 설정된 제외 목록을 해제하며, `noIgnore`·`hidden`과는 별도입니다. **`followSymlinks: true`는 거절합니다.** 허용 루트 밖을 읽은 뒤 결과만 감추는 대신, 안전한 링크 탐색을 구현하기 전까지 사용을 막습니다.

거절한 탐색을 말없이 넘기던 것도 이번에 고쳤습니다. [항목 37개 중 35개가 링크인 디렉터리](evidence/symlink-skip-260918.md)가 행 2개와
`complete: true`로 답했고, 어떤 옵션으로도 그 차이를 볼 수 없었습니다. 이제 `scope.skippedSymlinks`가
`{ dirs, files, examples, capped, scanned }`를 보고하고, 건너뛴 것이 **디렉터리**면 `complete: false`가
됩니다. 그 아래 트리가 통째로 가려질 수 있고 `noIgnore`·`hidden`으로도 되돌아오지 않으니, `path`를 링크
대상으로 직접 겨누세요. 건너뛴 **파일** 링크는 세기만 하고 완전성을 낮추지 않습니다. 하위 트리를 감출 수
없는 데다, 심링크된 bin 스텁 세 개 때문에 검색이 불완전하다고 말하면 신호가 쓸모없어지는 것을 재서
확인했습니다. 이 집계는 `.gitignore`를 읽지 않고, 정해진 항목 수에서 멈춥니다(`capped: true`가 그렇게 말합니다).

`browse.readText`는 문자열 URL과 `{ url }` 객체를 모두 받습니다. 본문은 `text` 한 필드로 오고, `format`이
그것이 무엇인지 말합니다 — fetch 경로가 html을 변환했으면 `markdown`, 브라우저가 렌더한 본문이면 `text`.
`browse.exec`와 `browse.attach`에 `treeNodes: true`를 주면 접근성 트리가 문자열뿐 아니라
`snapshot.nodes`의 `{ depth, role, name, ref, attrs, line }` 배열로도 옵니다. 기본값은 꺼짐입니다.
```sh
codemode --cwd /abs/project --code '
const hits = await search.content({ path: ".", query: "TODO", max: 50 });
const paths = [...new Set(hits.map(hit => hit.file))];
const excerpts = await fs.readMany(paths, { maxBytes: 4096, totalBytes: 32768 });
return { hits, excerpts };
'
```

### 읽기 상한과 호환성

페이지 없이 읽거나 한 번에 반환하는 페이지 내용은 256KiB까지입니다. 페이지 읽기는 물리적인 한 줄이 256KiB를 넘으면 거절하며, `fs.grepFile`의 물리적 한 줄 상한은 1MiB입니다. 상한을 넘는 줄을 조용히 건너뛰지 않고 오류로 알립니다. 더 긴 줄은 `fs.read`에 바이트 범위를 지정해 확인합니다. 청크 사이에서 나뉜 UTF-8 문자는 보존합니다. 파일 편집은 여전히 원본 전체를 읽으므로 전역 메모리 상한은 아닙니다.

호환성 변경: 검색 배열을 직접 반환한 JSON을 파싱하는 호출자는 `result.rows`와 메타데이터를 읽어야 합니다. 게스트 안의 `.map`·`.length`는 그대로입니다. Add 패치는 마지막 개행을 생성하며 96바이트 미만의 실행 출력 예산은 거절합니다. 의도된 계약 변경이며 Codex 패치 문법 전체의 호환성을 뜻하지 않습니다.

### 파일 수정과 패치

`edit_file`과 덮어쓰기 헬퍼는 정규화한 파일 경로의 프로세스 간 잠금을 사용합니다. 원본 읽기부터 교체 검증과 반영까지 잠금을 유지합니다. 같은 도구를 사용하는 두 프로세스의 수정 유실을 막기 위한 장치이며, 잠금을 무시하는 외부 편집기나 다른 하드링크 경로까지 보호하지는 않습니다. 잠금은 `os.tmpdir()/codemode-locks`에 저장하므로, 협력하는 프로세스는 같은 임시 디렉터리를 사용해야 합니다. 서로 다른 `TMPDIR` 값은 조정하지 않습니다.

`apply_patch`는 Add와 여러 hunk를 가진 Update를 지원합니다. Delete·Move·Environment는 지원하지 않습니다. Add는 마지막 개행이 있는 텍스트 파일을 생성합니다. Update hunk는 줄 단위로 맞추며(줄 중간 부분 문자열은 실패), 줄을 지울 때 빈 줄을 남기지 않고, 원래 줄바꿈(LF 또는 CRLF)을 유지합니다. 성공 응답은 기존과 같은 `{}`입니다. 중간 실패 시 오류의 `applied`·`failedFile`로 앞서 적용된 파일과 실패 대상을 알립니다. 출력 예산이 충분하면 CLI 오류에도 보존됩니다. 앞선 변경은 남으므로 **여러 파일 전체의 트랜잭션이나 rollback을 보장하지 않습니다.**

## 코드 모드 사용

- 화면에 파일 카드가 필요하면 네이티브 `read_file` / `write_file` / `edit_file`입니다. 게스트와 스키마가 같습니다.
- 검색, 여러 파일 읽기, 요약은 코드 모드를 한 번 부릅니다. 경로 1이면 `mcp__aside-codemode__execute_code`, 경로 2이면 bash 호출입니다.
- `rg`, `find`, `grep`, `Get-ChildItem -Recurse`를 직접 치지 마세요.

### 네이티브와 코드 모드 고르기

검색하기 전에 경로부터 고릅니다. 디렉터리나 프로젝트 범위의 내용·파일명 검색은 예상 적중 수와
관계없이 코드 모드를 씁니다. find, search, locate, grep, count, occurrences, references, usages,
TODO, all, every, each, across, repository, project라는 말은 검색 결과가 나오기 전까지 여러 파일을
뜻합니다. 서로 독립인 파일·URL·페이지·질의·API 조회·캡처가 두 개 이상이어도 코드 모드입니다.

낯선 페이지를 처음 보는 일, 알고 있는 파일 하나, 사용자가 볼 클릭 한 번, 새로운 화면 판단은
네이티브에 남깁니다. 파일 카드가 결과물인 일, 진행을 지켜봐야 하는 일, 로그인·SSO·MFA·CAPTCHA·승인,
결과를 확신할 수 없는 부수 효과, wizard·cart·form 상태를 이어 가는 단계도 같습니다. 페이지 모양을
알게 된 뒤 독립 URL이나 질의가 두 개 이상이면 작업에 맞춰 고릅니다. 렌더링 추출은 `browse.exec`,
본문 읽기는 `browse.readText`, 결과물 캡처는 `browse.captureMany`, 여러 질의는 `browse.searchMany`입니다.
“이 페이지”나 이미 열린 탭은 `browse.attach`가 맡습니다.

네이티브 `read_file` 반복, bash `find`/`grep` 파이프라인, grep 여러 번 호출은 피합니다. 대신
`search.content`, `search.files`, `search.count` 가운데 하나를 한 번 부르고, 같은 코드 본문에서
결과를 거른 뒤 적중한 파일만 읽습니다.

**상주 문맥 비용, 실측값.** MCP 경로는 **2,019바이트**짜리 도구 설명을 모든 MCP 세션에 계속 둡니다.
CLI 경로는 **3,808바이트**짜리 계정 `AGENTS.md` 블록을 계속 두고, **8,973바이트**짜리 사용자 스킬은
필요할 때만 읽습니다. 상주 문맥이 더 작은 MCP가 주 경로에 유리합니다. MCP를 붙이지 못하거나 bash
카드를 선호할 때는 지원되는 CLI 경로를 씁니다. 이 비용은 작업을 묶어 줄인 왕복 횟수와 별개입니다.

묶을 만한 작업이라도 효과는 작업 모양마다 다릅니다. 아래 네 작업은 한 기계에서 실패 없이 차갑고
따뜻한 실행을 섞어 각각 30쌍씩 측정했습니다.

| 작업 | 직접 수행 | 묶어서 수행 | 줄어든 것 |
|---|---|---|---|
| 알고 있는 클릭 한 번 | 1249ms | 1244ms | 없음, 사실상 동률 |
| 새 페이지에서 항목 찾기 | 3257ms, 3회 호출 | 1249ms, 1회 호출 | 페이지 로드 2회 |
| 독립된 페이지 여섯 개 읽기 | 8413ms | 4429ms | 탭 두 개를 동시에 처리 |
| 파일 여섯 개에서 일치 항목 세기 | 399ms, 6회 호출 | 82ms, 1회 호출 | 프로세스 5개 |

이 수치를 하나로 합치지 마세요. 클릭 한 번은 묶어도 이득이 없습니다. 가운데 행의 62% 차이는 더
영리한 탐색법이 아니라 `aside repl` 세션을 두 개 더 여는 비용입니다. 잘못된 셀렉터를 고치는 데는
6ms가 걸렸습니다. 원본 실행 기록은 [eval/out](eval/out)에 있습니다.

묶음 결과는 참·거짓이 아닙니다. `completed`는 요청한 항목이 모두 돌아왔고 열린 탭이 남지 않았다는
뜻입니다. `partial`, `indeterminate`, `needs_input`도 각각 다른 대응이 필요한 결과입니다.
`indeterminate`인 부수 효과를 다시 실행하면 주문이 두 번 들어갈 수 있습니다.

경로 2의 에이전트 호출은 절대 경로입니다. 등록 명령이 출력한 값으로 바꿉니다.

```
/abs/node /abs/aside-codemode/bin/codemode.mjs --cwd /abs/project --code "return await search.count({ query: 'TODO', path: '.' })"
```

## 경로 2 등록

```sh
node /abs/aside-codemode/scripts/register-aside.mjs
```

경로 2에서는 `~/.aside/u/0/AGENTS.md`에 `<!-- aside-codemode:start -->` 마커를 씁니다. 노드는 `process.execPath`, CLI는 이 리포의 `bin/codemode.mjs`입니다. 이 경로에는 `settings.json`이나 MCP가 필요 없습니다. 설정 파일이 없어도 AGENTS만 쓰이면 종료 코드는 0이고 `settingsOk`는 false입니다.

Windows는 `pwsh -File scripts/register-aside.ps1`. macOS 래퍼는 `sh scripts/register-aside.sh`입니다. `$NODE`가 있으면 그걸 쓰고, 없으면 마지막에 `command -v node`를 찾습니다.

재귀 `rg`가 아니라 bash CLI 한 번이 나와야 합니다.

```sh
aside exec --permission full-access -- "/abs/project 에서 README 가 들어있는 파일을 모두 찾아 절대경로로 보고하라"
```

## macOS

경로 1은 Aside 번들 네이티브 ripgrep을 자동으로 찾습니다. 절대 `rgPath`나 `CODEMODE_RG`는 재정의가 필요할 때만 씁니다. 경로 2의 ripgrep은 Homebrew로 설치합니다 (`brew install ripgrep`). `bin/rg.exe`는 Windows가 아닌 곳에서 무시됩니다. 비대화형 Aside PATH에는 `node`가 없는 경우가 많습니다. 그래서 AGENTS에는 등록 당시의 절대 `process.execPath`를 넣습니다 (이슈 #3).

## Windows

`bin/rg.exe`를 같이 둡니다. 경로 2에서는 `scripts/register-aside.ps1`을 쓰세요. `.gitattributes`가 `*.sh`를 LF로 고정해서, Windows에서 받아도 macOS 래퍼가 CRLF로 깨지지 않게 합니다 (이슈 #2).

Aside 기본 셸은 Git Bash입니다. 같은 절대 경로 `node`와 `bin/codemode.mjs --code` 호출은 PowerShell에서도 됩니다. Aside에는 Linux 제품이 없습니다.

## Config

뒤에 오는 값이 이깁니다.

1. 내장 기본값
2. 패키지 옆 `codemode.config.json` (개발 클론)
3. `~/.config/codemode/config.json` — 전역 설치용. `XDG_CONFIG_HOME`을 존중합니다
4. `$CODEMODE_CONFIG`
5. `--config <file>`

환경 변수가 더 강합니다. `CODEMODE_ROOTS`, `CODEMODE_RG`, `CODEMODE_EXCLUDES`, `CODEMODE_TIMEOUT_MS`, `CODEMODE_OUTPUT_BYTES`.

설정이 없으면 `roots`는 `$HOME`입니다 (`--doctor`에 `default:$HOME`). 넓은 루트는 `excludeGlobs`로 자릅니다 (`Library`, `node_modules`, 캐시, 미디어 등). `node scripts/measure-excludes.mjs`로 [한 머신에서 실측](evidence/exclude-pruning-260918.md)한 값은 기본 제외 348,353개, `includeExcluded: true` 756,239개이고, 첫 쌍의 소요 시간은 0.69초와 1.22초였습니다. 얼마나 줄어드는지는 루트에 무엇이 들어 있느냐에 달렸으니 각자 재보는 편이 낫습니다. 가지치기를 끄려면 `"excludeGlobs": []`. `codemode.config.json`은 머신마다 다르고 gitignore됩니다.

## Trust model

`node:vm`은 보안 경계가 아닙니다. Node 문서가 그렇게 말합니다. `--code`로 들어가는 게스트 JS는 이미 셸을 가진 Aside 에이전트가 씁니다. 신뢰 수준은 같습니다. 게스트 평가와 결과 직렬화는 별도 worker에서 실행하며, 바깥 watchdog이 비동기 무한루프와 멈춘 `toJSON`을 종료합니다. 파일·검색 함수는 부모 프로세스에서 허용된 RPC 이름으로 실행합니다. `actions.*`는 전용 RPC 채널에서 동기적으로 작동합니다.

watchdog의 대상은 게스트 평가와 직렬화입니다. 임의의 동기 호스트 함수까지 중단시키지는 못합니다. 내용 검색은 ripgrep 기반 `search.content`를 권장합니다. `fs.grepFile`에 극단적으로 느린 JavaScript 정규식을 넘기면 호스트 이벤트 루프가 막힐 수 있습니다.

`hostCallFailures`는 게스트가 의도적으로 잡은 오류를 포함해 실패한 호스트 호출 수를 표시합니다. 파일 작업은 반드시 `await`로 기다리세요.

취소 시 새 게스트 호출을 막고 신호를 지원하는 호스트 작업을 중단합니다. 이미 제출된 파일 I/O의 rollback은 보장할 수 없습니다. 정리 대기 후에도 작업이 남으면 `pendingHostCalls`·`sideEffectsMayContinue`로 알립니다. 외부 강제 종료나 프로세스 충돌 후에는 잠금이 남아 확인이 필요할 수 있으며, 소유자를 알 수 없는 잠금을 자동으로 빼앗지 않습니다. OS·네트워크 격리나 전체 메모리 상한은 아닙니다.

`maxResultBytes` / `CODEMODE_OUTPUT_BYTES`는 한글·JSON 이스케이프·로그·오류·마지막 개행을 포함한 **실행 응답 JSON 전체**의 바이트 상한입니다. 96바이트~16MiB 정수만 허용합니다. 잘못된 설정은 실행 전에 오류로 반환합니다. MCP 외부 래퍼와 `--doctor` 진단 출력은 이 실행 응답 예산에 포함하지 않습니다. 바깥 `truncated`는 출력 잘림이며, 검색 응답 안의 `truncated`는 검색 중단입니다.

## Performance evidence

아래는 **기존 Aside 실행 기록**입니다. 이번 안정화 버전의 새 성능 측정이 아닙니다. worker 시작 비용이 추가되므로 테스트 통과를 속도 향상 증거로 해석하면 안 됩니다.

| 작업 | Baseline | Codemode | 기록상 속도 비율 |
| --- | ---: | ---: | ---: |
| 3,000개 파일 단일 검색 | 15,202ms | 8,408ms | 1.81배 |
| 20,000개 파일 + 127MB 로그 | 9,083ms | 8,650ms | 1.05배 |
| 마커 10개의 경로와 크기 | 28,717ms | 25,390ms | 1.13배 |

[기존 측정 요약](evidence/summary.md)과 [복합 작업 비교](evidence/summary-compound.md)가 출처입니다. 첫 비교와 복합 작업의 baseline에는 경로 오류·재시도가 포함됐습니다. 복합 작업은 양쪽 모두 bash 3회였으므로 호출 수 감소를 입증하지 못합니다. 원래 목표인 after/baseline `<0.5`도 달성하지 못했습니다. 위 55초/1초는 개발 폴더 한 쌍입니다. 아래 표는 예전에 재 둔 Aside 턴 시간이며 그 측정을 취소하지 않습니다. 모든 머신·모든 작업이 51배라는 약속은 아닙니다. 표본이 적어 평균적인 효과를 약속할 수 없습니다.

새 비교에서는 실제 작업 마커를 명시합니다.

```sh
node eval/compare.mjs baseline.jsonl after.jsonl summary.md BASELINE-MARK AFTER-MARK
```

비교기는 파일 생성 시각 대신 실행 이벤트·완료 시각을 사용하고, 실패한 도구 호출과 문자열 발견을 구분합니다. 문자열이 있다는 이유로 정답 판정을 내리지 않습니다. 성능을 주장하려면 반복 실행, 최종 답의 정확한 검증, 호출 수, 반환 바이트·토큰, 잘 작성된 shell/Python 배치와의 비교가 필요합니다.

## Development

안정화 검증(2026-09-13): [196개 테스트 통과, 소스 해시와 남은 한계](evidence/review-hardening-20260913.json).

```sh
npm test   # node scripts/run-tests.mjs — 의존성 없음
```

`test/regressions.test.js`는 실제로 나갔던 결함을 고정합니다. gitignore 맹점, `max` 과다 반환, stdout 버퍼 폭발, 조용히 무시되던 옵션, 다른 OS 루트 크래시, 상속된 `rgPath`를 못 지우는 `null`, Windows 드라이브 문자가 `:`로 쪼개지던 일.

라이선스: MIT (LICENSE 참고).
