# ADR-0006 — decision recorded under "Acting on a page"

- Contract owner: [browse-surface.md](../browse-surface.md#acting-on-a-page)

## Decision record

- 목적과 의도: 계정에 부작용을 남길 수 있는 배치가 호출자의 명시적 선언 없이 실행되지 않게 한다.
- 기존 구현 및 제약 조건: `browse.exec`는 이미 `click`·`fill`·`press`를 포함한 18개 동사를 받는데 승인 개념이 코드에 없었다(`approval` 검색 0건). `aside repl` 배치는 비대화형이고 자식 프로세스 stdin이 `ignore`라 실행 중에 사람에게 물을 채널이 없다. 호스트 전역은 실행마다 새로 만들어져서 일시정지 후 재개도 표현할 수 없다.
- 검토한 주요 대안: pi-code-tool처럼 호출 단위 3지선다(approve/deny/suspend)를 만든다, 스펙이 말한 6개 동사만 게이트한다, effect 원장 15개에서 `hover`·`focus`·`scrollIntoView`·`scroll` 넷을 뺀 11개를 게이트한다, effect 원장을 그대로 게이트한다.
- 선택한 방식: 잡 옵션 `approveWrites: true`를 선언으로 삼고, 게이트 대상은 effect 원장과 정확히 같은 집합(18개에서 `waitFor`·`waitForLoadState`·`sleepMs`를 뺀 15개)으로 둔다. 거부는 spawn 이전에 일어나고 정상 봉투와 같은 모양의 `needs_input` 결과로 답한다.
- 다른 대안 대신 이 방식을 선택한 이유: 호출 단위 승인은 대화형 단일 스크립트의 모양이라 20개 항목 배치에서는 제품이 죽고, 애초에 물을 채널이 없다. 부분 집합 게이트는 두 번 시도했고 두 번 다 틀렸다 — 11개 안은 면제 기준을 "제출도 저장도 할 수 없다"로 적었는데 `focus`가 편집 중인 필드를 blur시켜 자동저장을 부를 수 있어서 그 문장이 거짓이었고, 게다가 게이트 11개와 면제 6개를 손으로 나열하다가 `goForward`가 두 목록 어디에도 없이 새어 나갔다. 손으로 유지하는 목록 두 개는 반드시 갈라진다. 원장과 같은 선을 쓰면 갈라질 집합 자체가 없고, 승인하는 선과 보고되는 선이 같아진다.
- 장점, 단점 및 영향: 액션이 없는 잡은 이 게이트를 만나지 않으므로 읽기 흐름 전체가 영향을 받지 않는다. 대가는 `press: 'Escape'`만 쓰는 잡도 선언이 필요하다는 것인데, 그 잡은 이미 액션 목록을 들고 온 잡이라 플래그 하나로 끝난다. 막지 못하는 두 가지를 문서에 이름으로 적었다 — `browse.attach` 경로(별도 단계에서 닫는다)와 상태를 바꾸는 GET(이 도구가 보내는 동작이 아니다).

