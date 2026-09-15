# 002 — 로드맵 감사 기록 (4라운드)

wp1의 계획 감사 기록이다. 설계 diff는 여기 없다. 무엇이 지적됐고 어떻게 닫혔는지만 남긴다.
감사자는 여섯이고 전부 read-only였다. 모델은 xai/grok-4.6, 역할은 explorer 넷 + reviewer + architect다.

| 라운드 | 담당 | 결과 |
|---|---|---|
| 1 | reviewer 전체 | FAIL — BLOCKING 9, MAJOR 12, MINOR 6 |
| 1 | architect A1-A4 정합 | MISALIGNED — 4건 |
| 2 | 여섯 갈래 병렬 | FAIL — reviewer 2, B 2, C 다수, D 6, A FAIL, architect 5 |
| 3 | 각자 자기 항목 | reviewer 1, architect 1, B 1, C 3, D 1, A PASS |
| 4 | 잔여 확인 | reviewer PASS, architect PASS/ALIGNED, A PASS, B PASS, D PASS, C 1건 → b316c60에서 반영 |

## 지적이 실제로 바꾼 것

계획이 소스와 어긋난 곳이 대부분이었고, 그 어긋남이 곧 구현 시 버그가 될 것들이었다.

- **거짓 인과를 지웠다.** 초안은 `runStatus`가 `item.status`만 보므로 `stopOnError:false`가 `completed`를 만들지 못한다고 적었다.
  `script.js:404`는 `stopOnError`일 때만 `out.ok`를 내리므로 그 문장은 틀렸다. `itemStatus`가 `actionsOk === false`를
  `ok`보다 먼저 보도록 고쳐서 주장과 코드를 일치시켰다.
- **식별자 단일 발행을 실제로 강제했다.** 초안의 capture는 `j000`을 다시 찍었고, 원장이 없으면 완료 순서로 조인을 재구성했다.
  후자는 F1을 그대로 되살리는 코드였다. 지금은 원장이 없으면 `ECONTRACT`로 거절한다.
- **효과 면제 집합을 분리했다.** `__INERT`는 `{ sleepMs: 1 }` 하나뿐이고 `waitFor`/`scroll`은 트리를 더럽힌다는 이유로
  의도적으로 제외돼 있다. 그것을 효과 판정에 재사용하면 dirty-tree 가드가 흔들린다. `__NOEFFECT`를 새로 뒀다.
- **네 홉을 끝까지 뚫었다.** `fullText` 플래그는 `JOB_KEYS` → compile payload → `page.evaluate` 인자 → 폴백 호출까지
  전부 뚫어야 `item.text`가 생긴다. 특히 렌더 요약은 evaluate 안이라 `JOB`이 보이지 않는다.
- **설치 표면의 충돌을 찾았다.** 초안은 새 AGENTS 표시자를 만들었는데 `register.js:15-16`에 이미 표시자가 있고,
  본문은 `templates/AGENTS.codemode.md`에서 온다. 고치지 않으면 재설치 때 블록이 두 개가 된다.

## 이번 감사로 확정된 미해결 가정

- live Aside에서 timeout된 click이 실제로 커밋되는지는 소스로 알 수 없다. wp4의 프로브가 측정한다.
- 같은 URL에서 200으로 렌더되는 로그인 폼은 `LOGIN_PATH` 감지기로 잡히지 않는다. 놓칠 수 있다는 사실을 문서에 남겼고,
  놓친 것을 성공으로 적지 않는 것이 wp7의 목표다.
- 계정 루트(`~/.aside/u/<id>`)가 REPL `fs`에서 읽히는지는 측정하지 않았다. wp8 착수 전에 프로브한다.

## 이 unit을 읽는 순서

[000](000_plan.md) 목표와 work-phase 지도 → [001](001_audit_findings.md) 현재 헤드의 결함 판정 →
각 phase 문서(010-090). 구현자는 자기 phase 문서 하나와 001의 해당 항목만 읽으면 된다.
각 phase는 착수 시 자기 문서의 줄 번호를 현재 트리에 다시 맞춘다. 앞 phase가 줄을 옮기기 때문이다.
