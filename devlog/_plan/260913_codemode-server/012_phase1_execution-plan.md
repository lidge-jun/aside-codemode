# wp1 P — 010 재검증 + B 레인 계획

직전 D(wp0) 결론: diff-level 로드맵 확정, 다음 wp1은 010 그대로 서버 구현.
방향 변경 없음.

## 010 stale 체크 (2026-09-13)
- 대상 리포는 문서 외 코드가 없으므로 드리프트 0. 010 교정본 + A-gate fold(58faab8)가 최신.
- verifier 실측(PLAN-VERIFIER-REAL-01): npm test는 package.json 착수 전이라 지금은 실행 불가. C에서 첫 실행 결과를 기록한다. 이 수용 행의 게이트 주장은 C 시점에만 유효.

## B 레인 (grok-4.6 파견, 쓰기 범위 분리)
- 레인1 executor: package.json, codemode.config.json, README.md, src/ 전부(server, mcp, sandbox, tools, rg, paths, host/search, host/fs, host/actions, config). 010 계약 A-D1..D6 그대로.
- 레인2 executor: test/ 전부(mcp, sandbox, fs, search, actions, config). 010 수용 1-10을 그대로 테스트로. src는 010 계약 문서로만 알고, 생긴 src를 읽어 맞추는 건 레인1 완료 후 main이 통합 시 조정.
- main: 두 레인 diff 검수, 드리프트 조정, npm test 첫 실행, 커밋 분할.
