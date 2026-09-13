# aside-codemode — 코드 모드 MCP 서버 로드맵

어사이드 에이전트가 로컬 파일을 만질 때 PowerShell 재귀 스캔과 파일별 툴콜
왕복 때문에 수십 초~수분이 걸린다. 이 유닛은 pi-runline식 "코드 모드"를 aside
프로세스 밖 MCP stdio 서버로 만들어, 검색-필터-읽기-요약을 코드 한 번 실행으로
끝내게 한다. aside 쪽은 settings.json 'mcp.servers' 등록만으로 붙고, 데몬
바이너리는 건드리지 않는다. 검색 프리미티브는 ripgrep으로 교체한다.

## Loop-spec

| 필드 | 내용 |
| --- | --- |
| Loop archetype | satisfy-spec (명세 충족 루프) |
| Trigger | 사용자 요청: 어사이드 로컬 파일 검색이 느린 문제를 코드 모드로 해결, 맥까지 호환, 검증·푸시까지 |
| Goal | aside exec가 aside-codemode MCP 툴을 호출해 동일 로컬검색 과제를 baseline 대비 유의하게 빠르게 끝낸다 |
| Non-goals | aside-daemon/앱 바이너리 패치, 앱 업데이트 채널 변경, codex CLI 연동, u1+ 계정, 어사이드 메모리 검색(이미 빠름), GUI 자동화 |
| Verifier | 리포 게이트 npm test (exit 0, src/** 를 읽음); aside exec --log-dump 에 codemode 툴 호출 이벤트; eval 측정 evidence 파일; git ls-remote |
| Stop condition | goalplan criteria 4개(c-gate, c-recognition, c-speedup, c-push) met |
| Memory artifact | 이 유닛(devlog/_plan/260913_codemode-server/) + .codexclaw/goalplans/aside-codemode-mcp-1-*/goalplan.json + evidence/ |
| Expected terminal outcomes | DONE=기준 4개 met / BLOCKED=데몬 재기동 후에도 MCP 미로드, gh 인증 부재 / UNSAFE=settings.json 백업 불가 / NEEDS_HUMAN=aside 로그인 만료 |
| Escalation condition | 같은 파견 패킷 2회 실패 시 main 회수; 리스크 R1(아래)이 실재하면 사용자에게 방향 질의 |

HOTL 리소스 범위: 쓰기 범위는 이 리포 + C:/Users/super/.aside/u/0/settings.json
의 mcp.servers 키 + 상위 묶음 리포의 .gitmodules/포인터뿐. credentials 파일
(accounts.json, models.json, credentials.json)은 읽지도 않는다.
외부 쓰기(푸시)는 사용자가 이번 세션에서 승인한 두 리모트뿐.

## 배경 확정 사실 (2026-09-13 측정)

- aside 데몬 1.26.913.337: quickjs-emscripten + QuickJSBridge 내장, 모델 게이트웨이
  radius.pi.dev(pi 기반). 에이전트는 MCP 서버를 지원하며
  C:/Users/super/.aside/u/0/settings.json 의 mcp.servers 가 사용자 등록점
  (현재 비어 있음).
- aside exec 에이전트는 repl(QuickJS) 툴을 이미 갖지만, MCP 툴/파일 툴을 코드
  안에서 합성할 수 없고 검색 프리미티브가 PowerShell이다(Windows에서 느림).
- pi-runline(pi.dev 패키지, v0.29.0, MIT)이 참조 구현: 단일 execute 툴 +
  샌드박스 내 actions.list/find/describe/check.
- 호스트 도구: node v24.16.0(C:/nvm4w/nodejs/node.exe), rg 15.2.0.

## 워크페이즈 맵 (의존 순서)

| wp | 내용 | 문서 | 검증 |
| --- | --- | --- | --- |
| wp1 | aside-codemode 서버 구현 + 리포 게이트 | 010_phase1_server.md | npm test exit 0 |
| wp2 | aside 등록 + exec 속도 검증 + 푸시 | 020_phase2_apply_verify.md | log-dump + evidence + ls-remote |

## 리스크

- R1 (최대): aside 데몬이 mcp.servers 변경을 재시작 없이 읽지 않을 수 있다.
  완화: wp2에서 등록 → exec 프로브 → 미인식 시 데몬 재기동(사용자 앱 재시작은
  InteractiveToken oneshot 스케줄 트릭, aside-jun host-windows 문서 참조).
- R2: 데몬이 MCP 서버를 spawn할 때 PATH가 달라 node/rg 해석 실패.
  완화: 등록 시 절대 경로 사용, 서버 기동 시 rg 해석을 늦게(lazy) 하고 실패를
  툴 응답으로 보고.
- R3: node:vm은 보안 경계가 아니다. 완화: 신뢰 모델 문서화(aside의 bash 툴과
  동급 신뢰), codeGeneration 비활성, fs 루트 allowlist, 실행 타임아웃/출력 캡.
- R4: baseline 측정이 모델 거동 차이로 오염. 완화: 동일 프롬프트/동일 코퍼스/
  기계 생성 needle, log-dump의 wall-clock과 툴콜 수 둘 다 기록.
