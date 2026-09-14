# 001 — 267ccff 재감사 결과

2026-09-14 로드맵은 `bf5725d` 기준으로 쓰였다. 그 뒤 `00992f8`(탭 intent 카운터)과 `267ccff`(Windows 명령행 길이)가 들어왔다.
아래는 현재 head에서 다시 확인한 판정이다. 네 갈래 read-only 감사(grok-4.6)와 main의 직접 확인을 합쳤다.
이 문서에는 설계 diff를 쓰지 않는다. 구현 계약은 010~090이 소유한다.

## P0 — 결과와 출처

**F1 capture 인덱스 조인 — 재현.** `src/host/browse/capture.js:65-71`이 `res.items[i]`를 `names[i]`에 묶는다.
`src/host/browse/script.js:498-502`의 워커 풀은 `queue.shift()`로 돌고 `items.push`는 완료 시점이라 순서가 입력과 다르다.
기본 concurrency는 4다. 반례: `urls=[A,B]`에서 B가 먼저 끝나면 B의 결과에 A의 파일명이 붙는다.
`urls=[A,A]`면 URL로도 교환을 감지할 수 없다. 호스트가 이미 `artifactName`을 plan에 넣는데(capture.js:20) 조인에 쓰지 않는다.
커버: `test/browse-capture.test.js`(현재 조인 케이스 없음).

**F2 session 전체 성공 판정 — 재현.** `src/host/browse/session.js:171-183`의
`ok: marker === 'ok' && items.length > 0 && items.every(i => i.ok) && leakedUrls.length === 0`에
`items.length === job.urls.length` 검사가 없다. 스크립트는 deadline 이후 큐에 남은 URL을 `one()`조차 호출하지 않으므로
(`script.js:237-238`의 ESKIP은 이미 shift된 항목만 해당) 미실행 항목은 결과에서 사라진다.
반례: 3개 요청에 2개 성공 items만 오면 `ok:true`다. `partial` 문자열은 `ok`를 끄지 않는다.
커버: `test/browse-session.test.js`.

**F3 timeout과 실제 취소 — 재현.** `actions-run.js:36-49`의 `__withTimeout`은 `Promise.race`이고 native promise를 abort하지 않는다.
기록은 `ok:false` + `ESTEPTIMEOUT`/`EDEADLINE`뿐이라 클릭이 커밋됐는지 알 수 없다.
`spawn.js:40`은 host 시간이 끝나면 SIGKILL만 하고 `{stdout,stderr,exitCode,killed}`를 돌려준다.
같은 step 자동 재시도 루프는 없다(브레이커는 skip이지 retry가 아니다). 즉 "재시도 금지"는 유지되고, 빠진 것은 상태 기록이다.
커버: `test/browse-actions.test.js` + 신규 `test/browse-effect-state.test.js`.

**F4 탭 회계 — 부분완화.** `00992f8`의 intent 카운터(`script.js:258-271`)는 open reject와 close throw를 반영한다.
남은 구멍 둘: (1) `script.js:494`의 `withCap(page.close(), 1500)`은 hang일 때 throw하지 않고 `__capped__`로 resolve하므로
`markClosed`가 실행되어 닫히지 않은 탭이 닫힌 것으로 세어진다. (2) `script.js:511-515`에서 pending open의 `allSettled`가 cap되면
이미 열린 탭의 close 루프 전체가 스킵되고, cap된 in-flight open은 `opened[]`에 없어 `leakedUrls`에도 안 실린다.
커버: `test/browse-tabs.test.js`.

**F5 concurrency vs maxTabs — 해당없음(계약 정착).** `schema.js:263-298`은 둘을 비교하지 않는다.
070이 clamp를 폐기하고 090이 `owned()` 런타임 스로틀로 대체했으므로 스키마 미검증 자체는 결함이 아니다.
다만 카탈로그 `actions-schema.js:36`이 concurrency를 아직 "Tabs in flight"로 설명한다. 이것은 F12의 문서 불일치로 다룬다.

## P1 — 읽기, 캐시, 출력

**F6 readText — 재현.** `read-text.js:128-132`는 `item.ok ? (item.text || markdown) : markdown`이다.
`browse.exec({snapshot:true})`는 `item.text`를 만들지 않으므로 브라우저 폴백 성공 경로에서 빈 문자열이 나올 수 있다.
`read-text.js:102-117`은 HTTP 상태를 실어오지만 401/403/429/503과 짧은 로그인 HTML을 `fallbackReason:null`로 정상 반환한다.
커버: `test/browse-readtext.test.js`.

**F7 search since 캐시 키 — 재현.** `search.js:105-115`의 `keyParts`에 `since`가 없다.
필터가 다른 두 호출이 같은 캐시 항목을 공유한다. DuckDuckGo 경로는 `published`가 없어 필터가 사실상 no-op이므로
오염은 youtube/aside 경로에서 관측된다. 커버: `test/browse-repetition.test.js`.

**F8 prefetch 소비 경로 없음 — 재현.** `watch.js:72-73`이 `namespace:'readText'` 키로 저장하지만
`createReadText`는 `cache.get`을 하지 않고 `browse.js:65-79`도 캐시를 주입하지 않는다. 채우기만 하고 읽는 쪽이 없다.

**F9 watch baseline 오염 — 재현.** `watch.js:14-22`가 `read.status`/`degraded`/`blockKind`를 보지 않고 항상 `put`한다.
503 본문이 새 baseline이 되고 다음 호출은 그것을 "안정"으로 본다.

**F10 compactTree 역할 필터 — 재현.** `snapshot-cache.js:36-45`의 정규식이 `- heading "Example" [ref=e1]` 형식을 못 읽는다.
역할 필터를 켜면 실제 트리가 빈 문자열이 된다. `createSnapshotCache`는 `browse.js`에 연결돼 있지도 않다.

**F11 media 스트리밍 상한 없음 — 재현.** `media.js:29-31`이 `arrayBuffer()`로 전부 받은 뒤 `maxBytes`를 검사한다.
거절 코드는 맞지만 거절 시점에 이미 전부 메모리에 있다.

**F12 discovery와 runtime 불일치 — 재현.** `actions.check`(src/host/actions.js:187-197)는 search와 grepFile에만 값 검증을 붙인다.
browse는 카탈로그(`actions-schema.js`)와 런타임(`schema.js`, `attach-schema.js`)이 갈라진다. 확인된 갈림:
`snapshot:true`(check 거절/runtime 허용), `requireSelector` 문자열(거절/허용), `waitUntil:'networkidle'`(허용/ENOTSUP),
`screenshot.maxWidth`·`pdf.format` 중첩 미검사(허용/ENOTSUP), attach `refsFingerprint`·captureMany/readText `timeoutMs`·watch `locale`(unknown 거절/허용).
커버: 신규 `test/browse-discovery.test.js`.

**F13 envelope 문자열화 — 재현.** `execution-output.js:70-90`이 예산 초과 시 `JSON.stringify(out.result)`를 잘라 문자열로 바꾼다.
`items`/`partial`이 사라진다. search는 `toJSON`으로 메타를 보존하지만 browse에는 그 경로가 없다.

## 설계 입력 (architect A1–A4, 채택 여부는 010이 기록)

- **A1** 식별자는 호스트가 발행한다. `session.js:92`의 plan 조립이 이미 `artifactName`/`pdfName`을 만든다.
  `runId` 1회, 요청마다 `jobId`, 효과마다 `operationId`. 스크립트는 받은 id를 메아리만 한다.
  근거: host-kill 경로(`session.js:138`)는 final 없이 `urls`로 가짜 item을 만들므로 id가 스크립트 전용이면 그 경로가 공백이 된다.
- **A2** 요청-반환 대조는 `session.js`에 두고 키는 `jobId`다. URL 키는 중복 URL에서 붕괴한다.
  호스트 `requested[]`를 원장으로 두고 미반환은 `EUNRETURNED`로 채운다.
- **A3** envelope는 파괴적 교체가 아니라 필드 추가. `ok`는 `status === 'completed'`에서 유도해 기존 테스트를 유지한다.
  `cache.js`의 `SCHEMA_VERSION`은 캐시 키이므로 올리지 않는다.
- **A4** 효과는 스크립트가 native await 직전 `started`, 직후 `confirmed`를 `type:effect` 줄로 흘리고,
  호스트가 `confirmed`가 없으면 `indeterminate`로 확정한다. `killed`면 전부 `indeterminate`다.

미해결 가정: live Aside에서 timeout된 click이 실제로 커밋되는지는 소스로 알 수 없다. wp4에서 실제 프로브로 측정한다.
`needs_input`을 로그인 벽(`EBLOCKED`)에 매핑할지는 wp7에서 결정한다.
