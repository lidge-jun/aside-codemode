# 060 — w7: 안내 (감사 반영본)

첫 호출이 실제로 읽는 것은 셋이다. 설치된 문서, actions.describe의 시그니처, 그리고
게스트 API 문서(src/tools.js의 GUEST_API_DOC). 세 곳이 어긋나면 안내를 고쳐도 첫 호출은
그대로 틀린다.

| 자리 | 더할 것 |
|---|---|
| AGENTS 템플릿 | 게스트에 모듈 로더가 없다는 한 줄(주입 전역 이름 포함). 짧게 유지 |
| 스킬 본문 | 네이티브 배치 독자용이다. --code 게스트 표를 여기 넣지 않는다 |
| execution-paths 참조 | 샌드박스 규칙 한 절 — 동적 임포트 없음, 문자열 코드 생성 없음, process 없음, 대신 무엇이 있는지 |
| **새 call-shapes 참조** | search 두(세) 메서드, readText의 인자와 text 필드, attach의 nodes, 심볼릭 링크 신호 |
| plannedFiles() | 새 참조를 설치 목록에 **반드시** 넣는다. 안 넣으면 설치·doctor·rollback이 그 파일을 모른다 |
| actions-schema | attach 시그니처에 snapshot/nodes를 싣고, readText 입력을 실제 계약과 맞춘다 |
| GUEST_API_DOC | attach와 readText가 빠져 있다. 더한다 |

## 반례

렌더된 문서가 각 항목을 담는지 docs-guidance 회귀로 고정하고, plannedFiles가 새 파일을
포함하는지 install 테스트가 본다. G5를 흉내내지 않는다.
