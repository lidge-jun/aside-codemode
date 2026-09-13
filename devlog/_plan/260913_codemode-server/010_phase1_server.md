# wp1 — aside-codemode 서버 구현 (diff-level)

전부 NEW 파일. 런타임 의존 0(Node 18+ 내장 모듈만), 테스트는 node:test.
Windows/macOS 공통 코드, 플랫폼 차이는 경로 해석 한 곳으로 몰아넣는다.

## 파일 맵

| 파일 | 책임 |
| --- | --- |
| package.json | name aside-codemode, type module, scripts.test = node --test test/, engines node >=18 |
| README.md | 무엇/왜/설치/등록/검증 요약, 신뢰 모델(아래 D-sec) 명시 |
| src/server.js | 엔트리. stdio NDJSON JSON-RPC 루프, MCP initialize/tools-list/tools-call, ping |
| src/mcp.js | 프로토콜 순수 함수: 메시지 파싱/직렬화, 에러 응답 빌더 |
| src/sandbox.js | node:vm 컨텍스트 생성, 전역 주입, timeout, console 캡처, 결과 직렬화(바이트 캡) |
| src/tools.js | execute_code 툴 정의(name/description/inputSchema) + 핸들러 |
| src/search.js | rg 해석(lazy) + spawn 래퍼: files/content, JSON 파싱, 하드 캡 |
| src/fsx.js | 루트 allowlist 강제 fs: readFile/writeFile/list. realpath 후 접두사 검사 |
| src/actions.js | 주입 전역의 레지스트리: list/find/describe/check |
| src/config.js | 설정 해석: --config 플래그 > env(ASIDE_CODEMODE_*) > 리포 codemode.config.json > 기본값 |
| codemode.config.json | 기본 설정 예시(roots는 빈 배열=deny-all, 등록 스크립트가 채움) |
| test/mcp.test.js | 스모크: 서버 spawn → initialize → tools/list → execute_code 왕복 |
| test/sandbox.test.js | timeout 강제, console 캡처, 결과 캡, require/process 부재 |
| test/fsx.test.js | 루트 이탈 거부(상대경로 .., 심볼릭링크), 캡 동작 |
| test/search.test.js | 픽스처 코퍼스에서 files/content 정확도, 캡 동작, rg 부재 시 에러 응답 |
| test/actions.test.js | list/find/describe/check 계약, unknown path의 did-you-mean |

## 계약 (D1-D8)

### D1 — MCP stdio
- 전송: stdin/stdout, 메시지당 JSON 한 줄(NDJSON). stderr는 로그.
- 구현 메서드: initialize, notifications/initialized, ping, tools/list, tools/call.
- initialize 응답: protocolVersion(요청값 에코, 없으면 '2024-11-05'), capabilities.tools, serverInfo { name: 'aside-codemode', version }.
- tools/list 응답은 정확히 툴 1개: execute_code.
- 알 수 없는 메서드: JSON-RPC -32601. 잘못된 인자: -32602. 툴 낶부 에러는 JSON-RPC 에러가 아니라 isError:true 콘텐츠로.

### D2 — execute_code 툴 스키마
- input: { code: string (필수), timeoutMs?: number (기본 30000, 상한 config.maxTimeoutMs=120000) }
- output: { ok, result?, error?, logs: string[], elapsedMs } 를 text 콘텐츠 JSON으로. result/error는 config.maxResultBytes(기본 64KB)에서 절단 + truncated 플래그.
- description 문구에 사용법 명시: Run JavaScript with injected globals: search(rg-backed), fs(root-scoped), actions(discovery). Return the final answer; only it and logs reach the model.

### D3 — 샌드박스
- vm.createContext(새 global, { codeGeneration: { strings: false, wasm: false } }).
- 주입 전역만 노출: search, fs, actions, console(캡처용). require/process/globalThis 오염 없음(명시적 차단 목록 테스트).
- 실행: vm.Script(code) → context에서 run, 반환값이 Promise면 await (timeout은 Promise.race로 강제).
- 신뢰 모델(D-sec): node:vm은 보안 경계가 아님. aside의 bash 툴과 동급 신뢰로 문서화. 방어는 사고 방지(codeGeneration off, 타임아웃, fs allowlist)이지 적대 코드 차단이 아님.

### D4 — search (rg 백엔드)
- 해석 순서: config.rgPath > env RG_PATH > PATH의 rg > 플랫폼별 후보(mac: /opt/homebrew/bin/rg, /usr/local/bin/rg). 전부 실패 시 첫 호출에서 ok:false, error: ripgrep not found 안내.
- search.files({ pattern?, path, glob?, max? }): rg --files path [-g glob] 후 pattern 필터, 경로 배열, 기본 상한 5000.
- search.content({ query, path, glob?, context?, max?, ignoreCase? }): rg --json, match 이벤트만 파싱해 { file, line, text } 배열, 기본 상한 500.
- execFile만 사용(셸 경유 금지), 인자는 배열. 호출당 timeout 30s, stdout 캡 8MB.

### D5 — fs (루트 스코프드)
- config.roots: string[]. 비어 있으면 모든 fs 호출 거부(deny-by-default).
- 모든 경로 realpath 후 roots 접두사 검사(Windows는 드라이브+대소문자 무시 비교, mac은 그대로). 심볼릭링크 이탈도 realpath로 차단.
- fs.readFile(path, { maxBytes? }): utf8 문자열, 기본 캡 256KB. fs.writeFile(path, content): 부모 존재 필요, 루트 납부만. fs.list(path, { max? }): 엔트리 { name, type, size } 배열, 기본 캡 1000.

### D6 — actions 발견 계층
- 레지스트리는 주입 전역의 자기 기술: [{ path: 'search.content', description, signature, inputs: { name: { type, required, description } } }].
- actions.list(filter?): filter는 접두사 문자열. actions.find(query): 공백 분리 토큰 전부 포함 점수, 상위 10. actions.describe(path): 레코드 1개. actions.check(path, args): 호출 없이 required 누락/unknown/type 불일치 반환.
- unknown path는 가까운 후보 3개를 did you mean으로 던진다.

### D7 — config
- 우선순위: process.argv --config file > env ASIDE_CODEMODE_CONFIG > server.js 기준 ../codemode.config.json > 내장 기본값.
- 키: roots[], rgPath?, maxResultBytes, maxTimeoutMs, searchCaps { files, content }.
- 기동 시 roots는 절대경로로 정규화. mac 예시와 Windows 예시를 README에.

### D8 — 게이트
- npm test = node --test test/ (Node 18+ 내장). 5개 파일 전부 통과가 wp1의 C 조건.
- test/mcp.test.js는 실제 서버를 child_process.spawn(node, [src/server.js])로 띄워 NDJSON 왕복. OS 무관.

## 수용 기준 (활성 시나리오 포함)

1. initialize → tools/list가 execute_code 1개를 반환 (mcp.test.js).
2. execute_code로 return 1+1 → ok:true, result:2 (mcp.test.js).
3. 무한루프 코드 → timeoutMs 후 ok:false (sandbox.test.js).
4. fs.readFile로 roots 밖 경로/심볼릭링크 → 거부 에러 (fsx.test.js).
5. search.content가 픽스처 needle을 line과 함께 반환, 상한 캡 동작 (search.test.js).
6. actions.check('search.content', {}) → missing:['query','path'] (actions.test.js).
7. 셸 메타문자가 든 query도 execFile 인자로 안전 통과 (search.test.js).

## SoT sync
- 이 리포는 신규라 SoT 문서가 없다. README.md가 SoT. C 단계에서 README의 설치/등록 절차를 실측값으로 동기화.
