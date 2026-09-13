# wp2 P — 020 재검증 + 실행 순서

직전 D(wp1) 결론: execute_code MCP 서버 완성(npm test 25/25, 수동 왕복 NEEDLE 46ms),
다음은 aside 등록+검증+푸시. 방향 변경 없음.

## 020 stale 체크 (2026-09-13)
- 020 계약과 현실 일치. 이미 확볐된 것: baseline 측정(evidence/20260913-163310-baseline.jsonl,
  에이전트 납부 15.2s, bash 2회 — 첫 호출은 경로 오타로 실패 후 재시도), 코퍼스 3000 파일.
- 변경 하나: 코퍼스 생성기가 이미 scratch로 실행돼 코퍼스가 존재한다. eval/make-corpus.mjs는
  그 scratch 스크립트를 리포에 정식 이식하는 것으로 대체(재생성 가능성 확보, needle 레이아웃 동일).
- 검증자 실측(PLAN-VERIFIER-REAL-01): aside exec 검증은 등록 후에만 가능 — 지금은 계획뿐.

## 실행 순서
1. B: scripts/register-aside.mjs + ps1/sh 래퍼 + eval/(make-corpus, run-task, compare) 작성.
   등록 실행 → settings 백업/머지 → semantic diff 확인(020 AC1).
2. B: 데몬 반영 프로브(aside exec 'execute_code로 40+2') — 미반영 시 데몬 재기동 프로브 순서(020 D2).
3. B: 측정(needle A3) → compare → evidence/summary.md. 판정 50% 미만.
4. B: 푸시(aside-codemode → gh repo create --push, 래퍼 submodule URL을 GitHub으로 교정 후 push).
5. C: npm test 재실행 + evidence 존재 + ls-remote.
