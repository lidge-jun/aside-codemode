# aside-codemode

지금 Aside exec는 MCP 서버를 붙이지 않습니다. 되는 길은 bash 한 번으로 `codemode` CLI를 돌리고, `~/.aside/u/0/AGENTS.md`에 그 규칙을 적는 것입니다. 화면에 뜨는 파일 카드는 네이티브 `read_file` / `write_file` / `edit_file`이고, 게스트 JS도 같은 모양을 씁니다.

## Requirements

- Node.js 18 이상
- PATH의 ripgrep(`rg`), 또는 `CODEMODE_RG` / `rgPath`. Windows는 번들 `bin/rg.exe`를 쓸 수 있습니다
- macOS, Windows

## Global install

```sh
git clone https://github.com/lidge-jun/aside-codemode.git
cd aside-codemode
npm install -g .        # or: npm link
codemode --doctor
```

PATH의 `codemode`는 **운영자**용입니다. Aside 에이전트는 PATH에서 `node`나 `codemode`를 찾지 않습니다. register가 적어 준 절대 경로 쌍(`process.execPath` + 이 클론의 `bin/codemode.mjs`)을 씁니다.

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

코드는 async 함수 본문입니다. `return`이 답입니다. 샌드박스에는 `require`, `process`, `fetch`, 네트워크가 없습니다.

| 이름 | 역할 |
| --- | --- |
| `search.files` / `search.content` / `search.count` | ripgrep 목록, 내용, 사전 카운트 |
| `read_file({ path, offset?, limit? })` | Aside 모양 읽기. `offset` / `limit`는 1부터 세는 **줄**. 페이지 없이 262144바이트를 넘기면 던집니다 |
| `write_file({ file_path, content })` | Aside 모양, 생성만 (`wx`). 덮어쓰면 던집니다 |
| `edit_file({ path, appendText?, edits })` | 원본에서 유일한 `oldText` → `newText` |
| `apply_patch(text)` | 게스트 헬퍼. Codex `*** Begin Patch` 텍스트를 `write_file` / `edit_file`로 바꿉니다. 성공은 `{}`. AGENTS 동사가 아닙니다 |
| `fs.readMany` / `grepFile` / `mkdir` / `stat` / `exists` / `list` | 묶음 헬퍼. `fs.read` / `fs.write`는 바이트/덮어쓰기용 구형 별칭입니다 |
| `actions.list` / `find` / `describe` / `check` | 샌드박스 안 탐색 |

**기본은 `.gitignore`를 따릅니다.** 상위 ignore 한 줄이 프로젝트 전체를 가릴 수 있습니다. 어떤 트리에서는 356개 중 126개가 빠졌고, 그 프로젝트 README도 빠졌습니다. 없다고 단정하기 전에 `noIgnore: true`로 `search.count`를 한 번 더 보세요. 점파일은 `hidden: true`입니다.

**`max`는 전체 행 상한**입니다. 파일마다 자르는 ripgrep `--max-count`가 아닙니다. 상한에 닿으면 검색을 끊습니다.

덜 끝난 결과는 열거되지 않는 플래그를 답니다. `max`로 잘리면 `truncated`, 읽지 못한 경로가 있으면 `partial`. 모르는 옵션은 무시하지 않고 거절합니다.

## Dual path

- 화면에 파일 카드가 필요하면 네이티브 `read_file` / `write_file` / `edit_file`입니다. 게스트와 스키마가 같습니다.
- 검색, 여러 파일 읽기, 요약은 bash로 CLI를 한 번 부릅니다. 그건 bash 카드입니다.
- `rg`, `find`, `grep`, `Get-ChildItem -Recurse`를 직접 치지 마세요.

에이전트 호출은 절대 경로입니다. register가 찍은 값으로 바꿉니다.

```
/abs/node /abs/aside-codemode/bin/codemode.mjs --cwd /abs/project --code "return await search.count({ query: 'TODO', path: '.' })"
```

## Register

```sh
node /abs/aside-codemode/scripts/register-aside.mjs
```

`~/.aside/u/0/AGENTS.md`에 `<!-- aside-codemode:start -->` 마커를 씁니다. 노드는 `process.execPath`, CLI는 이 리포의 `bin/codemode.mjs`입니다. `settings.json`이나 MCP는 필요 없습니다. 설정 파일이 없어도 AGENTS만 쓰이면 종료 코드는 0이고 `settingsOk`는 false입니다.

Windows는 `pwsh -File scripts/register-aside.ps1`. macOS 래퍼는 `sh scripts/register-aside.sh`입니다. `$NODE`가 있으면 그걸 쓰고, 없으면 마지막에 `command -v node`를 찾습니다.

재귀 `rg`가 아니라 bash CLI 한 번이 나와야 합니다.

```sh
aside exec --permission full-access -- "/abs/project 에서 README 가 들어있는 파일을 모두 찾아 절대경로로 보고하라"
```

## macOS

ripgrep은 Homebrew로 설치합니다 (`brew install ripgrep`). `bin/rg.exe`는 Windows가 아닌 곳에서 무시됩니다. 비대화형 Aside PATH에는 `node`가 없는 경우가 많습니다. 그래서 AGENTS에는 register 당시의 절대 `process.execPath`를 넣습니다 (이슈 #3).

## Windows

`bin/rg.exe`를 같이 둡니다. `scripts/register-aside.ps1`을 쓰세요. `.gitattributes`가 `*.sh`를 LF로 고정해서, Windows에서 받아도 macOS 래퍼가 CRLF로 깨지지 않게 합니다 (이슈 #2).

## Config

뒤에 오는 값이 이깁니다.

1. 내장 기본값
2. 패키지 옆 `codemode.config.json` (개발 클론)
3. `~/.config/codemode/config.json` — 전역 설치용. `XDG_CONFIG_HOME`을 존중합니다
4. `$CODEMODE_CONFIG`
5. `--config <file>`

환경 변수가 더 강합니다. `CODEMODE_ROOTS`, `CODEMODE_RG`, `CODEMODE_EXCLUDES`, `CODEMODE_TIMEOUT_MS`, `CODEMODE_OUTPUT_BYTES`.

설정이 없으면 `roots`는 `$HOME`입니다 (`--doctor`에 `default:$HOME`). 넓은 루트는 `excludeGlobs`로 자릅니다 (`Library`, `node_modules`, 캐시, 미디어 등). 한 머신에서 기본 제외는 331,709개 / 0.77초, `includeExcluded: true`는 1,565,078개 / 7.37초였습니다. 가지치기를 끄려면 `"excludeGlobs": []`. `codemode.config.json`은 머신마다 다르고 gitignore됩니다.

## Trust model

`node:vm`은 보안 경계가 아닙니다. Node 문서가 그렇게 말합니다. `--code`로 들어가는 게스트 JS는 이미 셸을 가진 Aside 에이전트가 씁니다. 신뢰 수준은 같습니다. 샌드박스는 사고 방지입니다. 코드 생성 금지, 실행 시간 제한, 출력 상한, 루트 허용 목록. 적대 코드용 장벽이 아닙니다.

## Development

```sh
npm test   # node --test "test/*.test.js" — 의존성 없음
```

`test/regressions.test.js`는 실제로 나갔던 결함을 고정합니다. gitignore 맹점, `max` 과다 반환, stdout 버퍼 폭발, 조용히 무시되던 옵션, 다른 OS 루트 크래시, 상속된 `rgPath`를 못 지우는 `null`, Windows 드라이브 문자가 `:`로 쪼개지던 일.

## Future: MCP

지금 Aside CLI exec는 `mcp.servers`를 띄우지 않습니다. register는 나중에 MCP를 붙이는 빌드를 위해 이 블록을 남겨 둘 수 있습니다. 설치 경로는 아닙니다.

```json
{
  "mcp": {
    "servers": {
      "aside-codemode": {
        "command": "C:\\nvm4w\\nodejs\\node.exe",
        "args": ["C:\\path\\to\\aside-codemode\\src\\server.js", "--config", "C:\\path\\to\\aside-codemode\\codemode.config.json"]
      }
    }
  }
}
```

macOS의 `"command"`는 절대 node 경로입니다. args는 이 클론을 가리킵니다. 오늘 성공은 여전히 AGENTS + `codemode --code`입니다.
