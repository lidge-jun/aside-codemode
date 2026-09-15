<p align="center"><img src="assets/logo.png" alt="aside-codemode" width="112"></p>
<h3 align="center">make aside 50x faster</h3>
<p align="center"><b>카드 50장이 한 장이 되는 지점</b><br>
검색하고, 읽고, 브라우저까지 자바스크립트 한 블록 안에서 끝낸 다음, 더미가 아니라 답만 돌려줍니다.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/aside-codemode"><img src="https://img.shields.io/npm/v/aside-codemode?color=cb3837&label=npm&logo=npm" alt="npm version"></a>
  <a href="https://github.com/lidge-jun/aside-codemode/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/aside-codemode?color=blue" alt="license"></a>
  <img src="https://img.shields.io/node/v/aside-codemode?logo=node.js&label=node" alt="node version">
  <a href="https://github.com/lidge-jun/aside-codemode/actions/workflows/ci.yml"><img src="https://github.com/lidge-jun/aside-codemode/actions/workflows/ci.yml/badge.svg?branch=main" alt="ci"></a>
</p>

```bash
npm install -g aside-codemode
codemode --doctor
```

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a></p>

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
대략 **51배**입니다. [측정 노트](evidence/dev-folder-51x.md)에는 argv 원문과 반올림하지 않은 시간,
두 명령이 같은 파일을 찾았다는 대조가 들어 있습니다. 폴더에서 잰 숫자와 합성 대조에서 나온 숫자를
따로 적어 둔 것도 같은 이유입니다. 둘은 같은 실행이 아닙니다.

예전에 재 둔 Aside 턴 비교(모델·데몬 포함)는 단일 검색 1.05~1.81배입니다. 그 표가 폴더에서 잰 시간을 없던 일로 만들지는 않습니다. [예전 표](#performance-evidence).

**aside-codemode**는 Aside의 로컬 검색·필터링·다파일 읽기·요약을 코드 호출 한 번으로 묶습니다.
브라우징을 켜면 페이지 스무 개를 세션 하나로 도는 일도 같은 자리에서 합니다. 중간 데이터를 모델에
다 넘기지 않고, 판단에 필요한 결과와 근거만 돌려줍니다.

지금 Aside exec는 MCP 서버를 붙이지 않습니다. 되는 길은 bash 한 번으로 `codemode` CLI를 돌리고, `~/.aside/u/0/AGENTS.md`에 그 규칙을 적는 것입니다. 화면에 뜨는 파일 카드는 네이티브 `read_file` / `write_file` / `edit_file`이고, 게스트 JS도 같은 모양을 씁니다.

## Requirements

- Node.js 18 이상
- PATH의 ripgrep(`rg`), 또는 `CODEMODE_RG` / `rgPath`. Windows는 번들 `bin/rg.exe`를 쓸 수 있습니다
- macOS, Windows

## Global install

```sh
npm install -g aside-codemode
codemode --doctor
```

고쳐 쓸 생각이면 클론에서 설치하세요.

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
| `browse.exec(job)` | URL 묶음을 Aside REPL 세션 하나로 처리합니다. 옵트인이라 `codemode --enable-browse`를 한 번 돌려야 켜집니다. 이 명령은 사용자 설정의 `browseCaps.enabled`만 바꾸고 다른 키는 건드리지 않습니다(계정 스킬을 지워도 다시 꺼지지 않습니다). `{ items, partial, leakedUrls }`를 돌려주고, 한 URL이 실패해도 나머지 결과가 비지 않습니다 |

**브라우징은 옵트인이고, Aside가 못 하는 일은 못 한다고 말합니다.** `page.route`, 스크린샷
`maxWidth`, `pdf({format:'A4'})`, `file://` 주소, `networkidle`은 프로세스를 띄우기 전에
`ENOTSUP`으로 막습니다. 전부 받아들여지는 척하고 조용히 무시되거나 바뀌는 것을 직접 재서
확인했기 때문입니다. `format:'A4'`는 레터를 만들고, `maxWidth`는 원본 크기를 그대로 돌려줍니다.
Aside CLI는 실패해도 종료코드가 `0`이라, 성공 판정은 끝줄 `[ok | Nms]` 마커와 만들었다는 파일을
직접 확인하는 것뿐입니다. CLI를 죽이면 그 탭은 영구히 남고 이후 세션에서 닫을 수 없어서,
스크립트 자체 데드라인이 호스트 데드라인보다 항상 먼저 끝나도록 잡았습니다. 강제 종료가 나면
깨끗한 결과인 척하지 않고 `partial: ['host-kill']`과 해당 URL을 함께 돌려줍니다.
`codemode --doctor --browse`로 전체 표를 볼 수 있습니다.

**기본은 `.gitignore`를 따릅니다.** 상위 ignore 한 줄이 프로젝트 전체를 가릴 수 있습니다. 어떤 트리에서는 356개 중 126개가 빠졌고, 그 프로젝트 README도 빠졌습니다. 없다고 단정하기 전에 `noIgnore: true`로 `search.count`를 한 번 더 보세요. 점파일은 `hidden: true`입니다.

포함형 `glob`(예: `**/*.js`)은 ripgrep `-g` / `--glob`입니다. `noIgnore`와 `hidden`이 false여도 gitignore나 숨김 파일 일부가 맞을 수 있습니다. 워크스페이스 탈출이 아니라 ripgrep의 glob 우선순위이며, `-uuu`와는 다릅니다. 제외 glob(`-g '!…'`)은 여전히 가립니다. ignore/점파일을 glob 없이 다루려면 `noIgnore` / `hidden`을 직접 켜세요.

**`max`는 전체 행 상한**입니다. 파일마다 자르는 ripgrep `--max-count`가 아닙니다. 한 행을 추가로 확인해 정확히 `max`개인 완전한 결과와 그보다 많은 결과를 구분한 뒤 중단합니다.

게스트 안에서는 검색 결과에 `.map`, `.filter`, `.length`를 그대로 사용할 수 있습니다. 검색 결과를 직접 또는 다른 객체 안에 넣어 반환하면 `{ rows, complete, truncated, partial, scope }` 형태로 직렬화됩니다. count는 `{ matches, files }`에 같은 메타데이터를 담아 반환합니다. `complete`는 선택한 검색 범위를 잘림·읽기 오류 없이 확인했다는 뜻이지, ignore나 제외 설정 밖의 파일까지 찾았다는 뜻이 아닙니다. 실제 범위는 `scope`로 확인합니다. `.length`나 가공한 배열만 반환할 때는 필요한 메타데이터를 명시적으로 함께 반환하세요.

`context`는 검색 행의 앞뒤 문맥을 반환합니다. 모르는 옵션과 잘못된 값은 거절합니다. `includeExcluded: true`는 설정된 제외 목록을 해제하며, `noIgnore`·`hidden`과는 별도입니다. **`followSymlinks: true`는 거절합니다.** 허용 루트 밖을 읽은 뒤 결과만 감추는 대신, 안전한 링크 탐색을 구현하기 전까지 사용을 막습니다.

거절한 탐색을 말없이 넘기던 것도 이번에 고쳤습니다. 항목 37개 중 35개가 링크인 디렉터리가 행 2개와
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

Aside 기본 셸은 Git Bash입니다. 같은 절대 경로 `node`와 `bin/codemode.mjs --code` 호출은 PowerShell에서도 됩니다. Aside에는 Linux 제품이 없습니다.

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

`node:vm`은 보안 경계가 아닙니다. Node 문서가 그렇게 말합니다. `--code`로 들어가는 게스트 JS는 이미 셸을 가진 Aside 에이전트가 씁니다. 신뢰 수준은 같습니다. 게스트 평가와 결과 직렬화는 별도 worker에서 실행하며, 바깥 watchdog이 비동기 무한루프와 멈춘 `toJSON`을 종료합니다. 파일·검색 함수는 부모 프로세스에서 허용된 RPC 이름을 통해 실행합니다. `actions.*`는 전용 RPC 채널을 통해 동기적으로 작동합니다.

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
