# wp1 — aside-codemode 서버 구현 (diff-level, reflection 교정본)

전부 NEW 파일. 런타임 의존 0(Node 18+ 내장 모듈만), 테스트는 node:test.
Windows/macOS 공통 코드, 플랫폼 차이는 경로 해석 한 곳(src/paths.js, src/rg.js)으로 몬다.
이 문서는 아키텍트 D1-D6 + reflection 지적을 치환한 단일 실행 계획이다(011은 이력 보존용).

## 파일 맵 (아키텍트 D1 치환)

| 파일 | 책임 |
| --- | --- |
| package.json | name aside-codemode, type module, scripts.test = node --test test/, engines node >=18 |
| README.md | 무엇/왜/설치/등록/검증 요약 + 신뢰 모델(A-D2) — SoT 문서 |
| codemode.config.json | 설정 예시. roots는 빈 배열(deny-all), 등록 스크립트가 채움 |
| src/server.js | 엔트리. stdio NDJSON 루프 + 수명주기(A-D3) |
| src/mcp.js | 프로토콜 순수 함수: 파싱/직렬화/에러 빌더 |
| src/sandbox.js | vm 컨텍스트 + 브리지(A-D2) |
| src/tools.js | execute_code 정의(name/description/inputSchema) + 핸들러. description에 게스트 API 문서(A-D5) |
| src/rg.js | rg 해석 폐기 사다리 + spawn 래퍼(A-D4) |
| src/paths.js | realpath + allowlist 접두사 강제(Windows 드라이브/대소문자, 심볼릭링크) |
| src/host/search.js | 게스트 전역 search: files/content |
| src/host/fs.js | 게스트 전역 fs: read/write/list |
| src/host/actions.js | 게스트 전역 actions: list/find/describe/check (A-D5) |
| src/config.js | 설정 해석(A-D6) |
| test/mcp.test.js | 스모크: spawn → initialize → tools/list → execute_code 왕복 + stdout 순수성 |
| test/sandbox.test.js | 동기 무한루프 timeout, microtask 배수, console 캡처, 결과 캡, 차단 목록 |
| test/fs.test.js | 루트 이탈 거부(.., 심볼릭링크), 캡 |
| test/search.test.js | 픽스처 정확도, 캡, 셸 메타문자 안전, rg 부재 에러 |
| test/actions.test.js | list/find/describe/check 계약, did-you-mean |
| test/config.test.js | 우선순위(내장<리포<env<argv), roots 정규화, CODEMODE_* 개별 키 |

## 계약 (A-D1..A-D6, 아키텍트 ID와 1:1)

### A-D1 — 모듈 분해
- 위 파일 맵이 곧 계약. 낶부 barrel(index re-export) 금지. src/host/* 는 게스트 전역 3개, src/rg.js·src/paths.js는 어댑터.
- 엔트리는 src/server.js 하나(별도 bin 없음) — aside 등록 args가 이 파일을 가리킨다.

### A-D2 — execute_code 샌드박스
- MCP 공개 툴은 execute_code({ code, timeoutMs? }) 하나. input 스키마: code 필수 string, timeoutMs 기본 30000/상한 config.maxTimeoutMs=120000.
- vm.createContext(새 global, { codeGeneration: { strings:false, wasm:false } }). importModuleDynamically는 넘기지 않는다(동적 import 거부). [B 편차, 2026-09-13 실측: microtaskMode 'afterEvaluate'는 이 패턴에서 runInContext가 돌려준 promise를 영영 해결하지 않는다(Node v24 재현). 제거하고 Promise.race deadline을 비동기 상한으로 쓴다.]
- 주입 전역은 search, fs, actions, console(캡처)뿐. process/require/fetch/net/child_process/Worker 미주입(차단 목록 테스트).
- 실행: vm.Script(code).runInContext(ctx, { timeout }) 후 Promise면 await. timeout 옵션은 동기 구간(+afterEvaluate 마이크로태스크)만 끊으므로, 비동기 강제는 Promise.race의 별도 deadline이 담당하고 rg/fs 호출에는 자체 Abort/timeout을 둔다.
- 출력: { ok, result?, error?, logs: string[], elapsedMs, truncated? } 를 text 콘텐츠 JSON. result/error는 config.maxResultBytes(기본 64KB) 절단.
- 신뢰 모델: node:vm은 보안 경계가 아님(공식 문서 명기). aside bash 툴과 동급 신뢰로 README에 명시. 실제 경계는 호스트 어댑터(src/paths.js allowlist, rg만 spawn)다.

### A-D3 — MCP stdio 수명주기
- 전송 stdio, 메시지당 JSON 한 줄(NDJSON). stdout에는 MCP 메시지 외 0바이트, 로그는 stderr 전용.
- 순서: initialize → (protocolVersion 에코 또는 2024-11-05, capabilities.tools, serverInfo) → notifications/initialized → tools/list | tools/call | ping.
- tools/list 응답은 execute_code 1개. listChanged 미지원.
- stdin close: 진행 중 tools/call을 abort하고 종료. notifications/cancelled: 해당 call 중단·응답 생략.
- 알 수 없는 메서드 -32601, 잘못된 인자 -32602, 툴 낶부 실패는 isError:true 콘텐츠.
- ping은 params 무시하고 빈 result를 즉시 반환한다.

### A-D4 — rg 해석과 spawn
- 폐기 사다리(앞에서 성공 시 정지): config.rgPath 또는 env CODEMODE_RG(절대경로) > PATH의 rg/rg.exe > /opt/homebrew/bin/rg > /usr/local/bin/rg > (Windows) where.exe rg. 전부 실패 시 search.* 는 구조화 에러 { ok:false, error:'ripgrep not found', hint:'install rg or set CODEMODE_RG' }, 서버는 기동 유지(lazy: 첫 호출 시 해석).
- 고정 플래그: content = --json --path-separator=/ [-i] [-C n] [-g glob] --max-count n -- query path. files = --files --path-separator=/ [-g glob] path. --pre 금지, --hidden 기본 off.
- execFile만, 인자 배열, 셸 경유 금지. 호출 timeout 30s, stdout 캡 8MB. 결과: files는 경로 배열(상한 config.searchCaps.files=5000), content는 { file, line, text } 배열(상한 500).

### A-D5 — actions 발견 계층
- 게스트 전용(MCP 툴로 열지 않음). 게스트 API 문서는 execute_code description에 싣는다.
- 카탈로그 5개: search.files, search.content, fs.read, fs.write, fs.list. 각 { path, description, signature, inputs: { name: { type, required, description } } }.
- actions.list(filter?) 접두사 필터. actions.find(query) 공백 토큰 AND 점수 상위 10. actions.describe(path) 레코드. actions.check(path, args) 호출 없이 { ok, missing, unknown, typeErrors } 반환. unknown path는 후보 3개 did-you-mean.

### A-D6 — config
- 우선순위: 내장 기본 → 리포 codemode.config.json → env CODEMODE_CONFIG 파일 → argv --config 파일. env 개별 키: CODEMODE_ROOTS(pathsep 구분), CODEMODE_RG, CODEMODE_TIMEOUT_MS, CODEMODE_OUTPUT_BYTES.
- roots 기본값 없음: 비어 있으면 fs 전부 거부(deny-all). 등록 스크립트(020)가 [accountRoot, Developers]를 명시 기록. aside settings.json의 permission.files는 읽지 않는다.
- 기동 시 roots 절대경로 정규화. 키: roots[], rgPath?, maxResultBytes, maxTimeoutMs, searchCaps { files, content }.

## 수용 기준 (활성 시나리오)

1. initialize 전 stdout 0바이트, initialize → tools/list가 execute_code 1개 (mcp.test.js).
2. execute_code return 1+1 → ok:true result:2 (mcp.test.js).
3. 동기 무한루프 → vm timeout으로 ok:false (sandbox.test.js). [afterEvaluate 항목은 위 편차로 삭제]
4a. notifications/cancelled는 서버를 죽이지 않음 — 해당 call 응답 없이 이후 tools/list가 정상 응답 (mcp.test.js).
4b. stdin close는 진행 중 call을 abort하고 서버가 스스로 종료(exit 0) (mcp.test.js).
5. roots 밖 경로/심볼릭링크 이탈 → 거부 (fs.test.js).
6. search.content 픽스처 needle 적중 + 캡 동작 + 셸 메타문자 안전 (search.test.js).
7. rg 해석 사다리: CODEMODE_RG 최우선, 전부 부재 시 구조화 에러 (search.test.js).
8. actions.check('search.content', {}) → missing:['query','path'], unknown path did-you-mean (actions.test.js).
9. config 우선순위: argv --config가 env CODEMODE_CONFIG를, env가 리포 파일을 이김. roots 미설정 시 fs 거부 (config.test.js).
10. ping에 빈 result 즉시 응답 (mcp.test.js).

## SoT sync
- README.md가 SoT. C 단계에서 설치/등록 절차를 실측값으로 동기화.
