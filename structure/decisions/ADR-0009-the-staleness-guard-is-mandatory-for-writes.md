# ADR-0009 — decision recorded under "Acting on a page"

- Contract owner: [browse-surface.md](../browse-surface.md#acting-on-a-page)

## Decision record

- 목적과 의도: 페이지가 움직인 뒤에 옛 ref로 무언가를 저지르는 사고를 막되, 이미 있는 가드를 재발명하지 않는다.
- 기존 구현 및 제약 조건: `refsFingerprint` 가드는 5개 파일에 이미 구현돼 있고 각 스텝이 `refGuard`와 `guardAgeMs`를 보고한다. 없는 건 강제였다. 그리고 `allowStaleRefs: true`는 `actions-run.js:207-210`에서 비교를 통째로 건너뛰고 `refGuard`에 `'disabled'`를 적는다. 측정치: 클릭 한 번이 트리를 3,126자에서 23,530자로 키우고 번호를 새로 매겼다.
- 검토한 주요 대안: 권고로 남긴다, ref 스텝 전체에 지문을 요구한다, `guardAgeMs` 임계값을 함께 도입한다, 게이트 동사에 한해 지문·전체지문·`allowStaleRefs` 금지 셋을 강제한다.
- 선택한 방식: 게이트 동사(effect 원장)를 ref로 지목하는 스텝에 한해 세 가지를 spawn 이전에 거부한다 — 지문 없음, 구조 전용 지문(`s` 접두어), `allowStaleRefs` 동반. 배치와 attach가 같은 함수를 쓴다. `guardAgeMs` 임계값은 넣지 않는다.
- 다른 대안 대신 이 방식을 선택한 이유: 권고는 이미 존재했고 도구 자신의 경고문("파괴적인 것을 클릭하는 데 fingerprintStructure를 쓰지 말 것")이 지켜지지 않는 상태였다. 세 번째 규칙이 핵심인데, 이건 리뷰가 짚어줬다 — `allowStaleRefs`를 막지 않으면 앞의 두 규칙은 모양만 맞는 문자열 하나로 만족되고 검사는 꺼진다. 즉 강제가 아무것도 아니게 된다. `guardAgeMs` 임계값은 "얼마가 너무 긴가"에 답할 측정이 이 저장소에 없어서 반증 가능한 형태를 못 만든다.
- 장점, 단점 및 영향: 세 규칙 모두 호스트에서 검증하므로 와이어 비용 0자다. 대가는 계약 변경이다 — 기존 스위트에서 26개 테스트가 깨졌고, 그건 지문 없이 ref로 클릭하던 호출 모양이 실제로 그만큼 흔했다는 뜻이다. 그리고 부작용이 하나 따라온다: ref로 지목 가능한 동사는 전부 effect 동사이므로(`waitFor`·`waitForLoadState`·`sleepMs`는 셀렉터를 받거나 대상이 없다) `allowStaleRefs`는 ref 액션과 함께 쓸 수 없게 됐고, 사실상 액션 경로에서 쓸 자리가 사라졌다. 옵션 설명에 그대로 적었다.

