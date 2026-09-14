# 060 — wp7: 읽기·캐시·출력의 P1 묶음

근거: [001](001_audit_findings.md) F6~F13. 한 phase에 묶는 이유는 모두 같은 결론을 공유하기 때문이다:
**실패한 관측을 정상 관측으로 저장하지 않는다.**

## F6 readText — MODIFY src/host/browse/read-text.js

1. 브라우저 폴백 반환(128-132행)에서 빈 본문을 성공으로 내지 않는다:

        const body = item.ok ? (item.text || item.render && item.render.sample || '') : '';
        const useBrowser = body.length >= Math.max(1, opts.minChars || 1);
        return useBrowser
          ? { url, source: 'browser', markdown: body, chars: body.length, fallbackReason: verdict.reason, browserOk: true }
          : { url, source: 'browser', markdown, chars: markdown.length, fallbackReason: verdict.reason,
              browserOk: true, degraded: true, degradedReason: 'browser returned no text' };

2. HTTP 상태를 관측 품질로 승격한다(102-117행):

        const httpBad = status === 401 || status === 403 || status === 429 || status >= 500;
        if (httpBad) return { url, source: 'fetch', status, markdown, chars: markdown.length,
          ok: false, blockKind: status === 429 ? 'rate-limited' : (status >= 500 ? 'upstream' : 'auth'),
          fallbackReason: 'http-' + status };

   로그인 화면 감지는 기존 `policy.detect`의 결과를 그대로 쓰되, 감지되면 `ok:false, blockKind:'login'`으로 낸다.
   `needs_input`의 매핑은 여기서 결정한다: **`blockKind === 'login'`인 항목이 있으면 run status는 `needs_input`이다.**

## F7/F8 search 캐시와 prefetch — MODIFY search.js, browse.js

- `keyParts`(search.js:105)에 `since: since || null`을 넣는다. `cacheKey()`에도 같은 필드를 넣는다.
- `createReadText`에 `cache`를 주입하고(`browse.js:65`), 읽기 전에
  `cache.get({ namespace: 'readText', subject: url, accountRoot, locale })`를 조회한다.
  `ok:false`인 관측은 **캐시에 넣지 않는다.** prefetch가 채운 값이 소비되는 경로가 이것이다.

## F9 watch baseline — MODIFY watch.js

        const read = await readText(url, { timeoutMs: opts.timeoutMs });
        if (read.ok === false || read.degraded === true) {
          return { url, ok: false, changed: null, code: 'EOBSERVE', blockKind: read.blockKind || null, status: read.status || null };
        }

실패 관측은 baseline을 덮지 않는다(`put` 자체를 건너뛴다). 마지막 정상 baseline이 보존된다.

## F10 compactTree — MODIFY snapshot-cache.js

정규식을 Aside 실제 줄 형식에 맞춘다:

        const m = /^\s*-\s*([a-z][a-z-]*)/i.exec(line);

그리고 `test/browse-cache.test.js`의 픽스처를 실제 형식(`  - heading "Example" [ref=e1]`)으로 바꾼다.
`createSnapshotCache`가 `browse.js`에 연결돼 있지 않은 상태는 그대로 둔다. 쓰지 않는 기능을 연결하는 것은 이 phase의 범위가 아니다.
대신 `browse.js`에서 export되지 않는다는 사실을 모듈 주석에 적는다.

## F11 media 스트리밍 상한 — MODIFY media.js

        const declared = Number(res.headers.get('content-length') || 0);
        if (declared && declared > maxBytes) throw new MediaError('declared ' + declared + ' bytes, over the ' + maxBytes + ' cap', 'ETOOBIG');
        const reader = res.body.getReader();
        let total = 0; const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) { await reader.cancel(); throw new MediaError('stream exceeded the ' + maxBytes + ' cap', 'ETOOBIG'); }
          chunks.push(value);
        }

## F12 discovery와 runtime 합의 — MODIFY actions-schema.js

카탈로그가 런타임과 같은 답을 내도록 키를 맞춘다. 확정 목록(001 F12의 표):
`snapshot`은 boolean|string 허용, `requireSelector`는 string|array 허용, `waitUntil`은 지원 값만 허용,
`screenshot`/`pdf`의 중첩 키는 런타임이 거절하는 것을 카탈로그도 거절, attach `refsFingerprint`·captureMany/readText `timeoutMs`·watch `locale`는 알려진 키로 등록.
`concurrency` 설명에서 `Tabs in flight`를 `Workers in flight; owned tabs are capped by browseCaps.maxTabs`로 고친다.

## F13 envelope 문자열화 — MODIFY execution-output.js

객체 결과는 문자열로 바꾸지 않는다. 예산을 넘으면 **항목을 줄이고 구조를 남긴다**:

        if (out.ok && out.result && typeof out.result === 'object') {
          out.result = shrinkStructured(out.result, limit - size());
          out.truncated = true;
        } else { ...기존 문자열 경로... }

`shrinkStructured`는 배열 항목을 뒤에서 잘라내고 `omittedItems` 수를 남긴다. 긴 문자열 필드는 자르되 키는 유지한다.

## TESTS

- MODIFY `test/browse-readtext.test.js`: 401/403/429/503, 로그인 HTML, `item.text` 부재.
- MODIFY `test/browse-repetition.test.js`: since 교차 캐시, prefetch 후 실제 hit, 503 baseline 보존, 스트리밍 상한.
- MODIFY `test/browse-cache.test.js`: 실제 줄 형식 픽스처.
- NEW `test/browse-discovery.test.js`: 001 F12 표의 각 키에 대해 `actions.check`와 런타임 검증이 같은 답을 낸다.
- NEW `test/execution-output.test.js`: 객체 결과가 예산 초과에서도 객체로 남고 `omittedItems`가 보고된다.

## Verification (C)

- `node --test test/browse-readtext.test.js test/browse-repetition.test.js test/browse-cache.test.js test/browse-discovery.test.js test/execution-output.test.js` — exit 0.
- hosted CI 5조합 success at head.
