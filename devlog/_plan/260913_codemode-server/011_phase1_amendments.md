# 010 수정분 — 아키텍트(grok-4.6) 제안에 대한 main 처분

아키텍트 제안 D1-D6에 대한 채택/수정/기각을 기록한 이력 문서.
실행 계획은 010_phase1_server.md(reflection 교정본)가 유일한 SoT다 —
이 파일의 세부 표현(카탈로그 4개 등)은 010 재작성으로 폐기됐다.

| 아키텍트 | 처분 | 이유 |
| --- | --- | --- |
| D1 모듈 분해(bin 엔트리 + src/host/* + src/rg.js + src/paths.js, barrel 금지) | 채택(파일명만 조정) | 엔트리는 src/server.js 유지(010 등록 계약과 일치), 나머지 분해는 채택: src/host/search.js, src/host/fs.js, src/host/actions.js, src/rg.js, src/paths.js 추가. 010의 src/search.js·src/fsx.js·src/actions.js는 host/ 아래로 이동한 것으로 읽는다 |
| D2 microtaskMode afterEvaluate, importModuleDynamically 미지정, 호스트 어댑터가 실제 경계 | 채택 | 010 D3에 합류. vm timeout이 비동기를 못 끊는 한계를 테스트에 명시: 타임아웃 시나리오는 동기 무한루프 기준 |
| D3 stdin close 시 실행 중 call abort 후 종료, notifications/cancelled 처리, 로그는 stderr 전용 | 채택 | 010 D1에 합류. stdout 오염 금지를 mcp.test.js가 검증(initialize 전 stdout 바이트 0) |
| D4 rg 폐기 순서 + --path-separator=/ + --pre 금지 + 구조화 에러 | 채택 | 010 D4 대체. env 이름은 CODEMODE_RG 로 통일(D6과 접두사 일치) |
| D5 게스트 API 문서는 execute_code description에 싣는다, MCP 다중 툴로 열지 않는다 | 채택 | 왕복 1회 목적 유지. actions 카탈로그 항목은 search.files/search.content/fs.read/fs.write 4개로 확정(기존 fs.list는 fs.read의 디렉터리 케이스로 합류는 하지 않고 별도 유지 — 구현 단순화) |
| D6 설정: 내장 → 워크스페이스 상향 탐색 → 계정 → env, 기본 roots=[cwd], aside settings 미재사용 | 부분 기각 | 기본 roots=[cwd]는 aside 데몬 spawn cwd를 신뢰할 수 없어 부적합. 010/020 유지: 등록 스크립트가 codemode.config.json roots를 [accountRoot, Developers]로 명시 기록. env 접두사는 CODEMODE_ 로 채택(ASIDE_CODEMODE_ 폐기), aside settings의 permission.files는 읽지 않음(채택) |

## 갱신된 최종 파일 맵 (wp1 구현 기준)

package.json, README.md, codemode.config.json,
src/server.js(엔트리+stdio 루프), src/mcp.js, src/tools.js(execute_code 정의+description),
src/sandbox.js(vm+브리지), src/rg.js(해석+spawn), src/paths.js(realpath+allowlist),
src/host/search.js, src/host/fs.js, src/host/actions.js, src/config.js,
test/mcp.test.js, test/sandbox.test.js, test/fs.test.js, test/search.test.js, test/actions.test.js.
