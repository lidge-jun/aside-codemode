# wp2 B 편차 — 통합 표면을 MCP에서 CLI로 (2026-09-13 실측)

## 무슨 일이 있었나
- settings.json mcp.servers 등록·semantic diff 검증·enabled/transport/env 스키마 정합까지 완료.
- 데몬 재기동 후에도 exec 세션에 execute_code가 나타나지 않았고, CODEMODE_DEBUG_LOG
  spawn 마커로 **데몬이 우리 서버를 아예 spawn하지 않음**을 확인.
- 데몬 번들에서 agent.refreshMcpTools 호출 지점은 routines.run 경로뿐(4회 매치).
  이 빌드(1.26.913.337)에서 CLI exec 세션은 MCP 툴을 받지 않는다. 등록은 남겨둔다
  (세션 MCP가 붙는 빌드에서 그대로 동작, README에 명시).

## 대응 (계획 편차, scope 확장 아님 — 목표 표면 변경)
- src/cli.js 추가: execute_code와 동일 샌드박스/rg/fs/actions를 one-shot CLI로 노출.
  exec 에이전트는 이미 갖고 있는 bash 툴 한 번으로 codemode를 호출한다.
- 통합 지점: ~/.aside/u/0/AGENTS.md(어사이드가 제공하는 사용자 규칙 파일, 원래 빈
  템플릿)에 '로컬 검색은 codemode CLI로' 규칙을 추가.
- goalplan c-recognition 시나리오를 CLI 경유로 수정(속도 기준은 그대로).
- 측정 공정성: after 실행의 프롬프트는 baseline과 동일하게 유지. 차이는 환경
  (AGENTS.md 규칙)뿐 — 실제 사용 조건 그대로의 비교다.
