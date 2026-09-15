# ADR-0010 — decision recorded under "Acting on a page"

- Contract owner: [browse-surface.md](../browse-surface.md#acting-on-a-page)

## Decision record

- 목적과 의도: `browse.attach`가 사용자의 로그인된 탭에 부작용을 남길 때 배치와 같은 선언을 요구하고, 그 부작용이 기록에 남게 한다.
- 기존 구현 및 제약 조건: `attach`는 `session.run`을 거치지 않는다. `compileAttach`로 자기 소스를 만들어 `session.raw`에 직접 넘기고(`attach.js:283-296`), 배치와 똑같은 동사 집합을 받는다. 그리고 `runActions`를 부를 때 `runId`도 `onEffect`도 넘기지 않아 effect 원장이 아예 생기지 않았다. `session.raw`는 마커가 `ok`가 아니면 `rows: []`만 돌려주고 transcript를 버렸다 — effect 줄이 사는 유일한 자리를 같이 버린 것이다.
- 검토한 주요 대안: 배치 게이트가 attach도 덮도록 `attach`를 `session.run`으로 합친다, attach는 사용자가 탭을 직접 지목했으므로 면제한다, attach에 별도의 더 약한 선언을 만든다, 같은 `approveWrites`를 같은 정의로 요구하되 거부 모양만 attach 것으로 한다.
- 선택한 방식: 마지막. `gatedVerbs`를 한 곳에서 export해 양쪽이 같은 집합을 읽고, 거부는 attach의 평평한 반환 모양(`{ok:false, code:'EWRITEAPPROVAL', wants}`)으로 답한다. 동시에 attach가 자기 `runId`를 발급하고 `onEffect`를 넘기며, `session.raw`가 실패 경로에서도 transcript를 실어 보낸다.
- 다른 대안 대신 이 방식을 선택한 이유: 두 경로를 합치는 건 잡 모양이 달라서(attach는 url이 없고 탐색도 아티팩트도 없다) 계약 하나를 둘 다에 억지로 맞추는 일이 된다. 면제는 틀렸다 — `targetId`를 고른 것은 **어디**를 고른 것이지 **무엇**을 허용한 게 아니고, 이 탭은 사용자가 지금 로그인해서 보고 있는 탭이라 배치가 여는 탭보다 위험하다. 더 약한 별도 선언은 두 개의 승인 개념을 만들어 어느 쪽이 무엇을 덮는지 아무도 모르게 한다. 거부 모양만 다르게 한 이유는, 한 표면을 읽는 호출자가 거절당한 이유를 이해하려고 다른 표면의 계약까지 배워야 한다면 그건 계약이 아니라 함정이기 때문이다.
- 장점, 단점 및 영향: 이제 클릭이 나간 뒤 프로세스가 죽어도 그 클릭이 `indeterminate`로 남는다 — 전에는 흔적조차 없었다. 대가는 계약 변경이다: 액션을 쓰던 기존 attach 호출은 선언을 붙여야 하고, 스위트에서 세 건이 그래서 깨졌다. 그리고 여전히 못 막는 것 하나를 계약서에 적어 뒀다 — GET만으로 상태를 바꾸는 URL은 이 도구가 보내는 동작이 아니라서 동사 위의 게이트로는 보이지 않는다.

