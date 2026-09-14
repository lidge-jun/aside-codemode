# 060 — wp7: 읽기·캐시·출력의 P1 묶음

근거: [001](001_audit_findings.md) F6~F13. 감사 1라운드 지적 7·8·18·27 반영본.
공통 결론: **실패한 관측을 정상 관측으로 저장하지 않는다.**

## 적용 순서 (서로 전제가 아니므로 순서를 못박는다)

1. F6 readText 관측 품질 → 2. F9 watch(그 값을 소비) → 3. F7/F8 캐시 키와 소비 경로 →
4. F12 discovery 합의 → 5. F13 envelope → 6. F10 compactTree → 7. F11 media 스트리밍.
1~3은 한 줄기이고 4~7은 독립이다. 각 항목은 자기 테스트로 닫힌다.

## F6 readText — MODIFY src/host/browse/read-text.js

1. 브라우저 폴백에서 빈 본문을 성공으로 내지 않는다(128-132행):

        const body = item.ok ? (item.text || (item.render && item.render.sample) || '') : '';
        const useBrowser = body.length >= Math.max(1, opts.minChars || 1);
        return useBrowser
          ? { url, source: 'browser', markdown: body, chars: body.length, fallbackReason: verdict.reason, browserOk: true, ok: true }
          : { url, source: 'browser', markdown, chars: markdown.length, fallbackReason: verdict.reason,
              browserOk: true, ok: false, degraded: true, degradedReason: 'browser returned no text' };

2. fetch 경로(102-117행)에 상태와 로그인 감지를 넣는다. 현재는 `needsBrowser`만 본다:

        const httpBad = status === 401 || status === 403 || status === 429 || status >= 500;
        if (httpBad) {
          return { url, source: 'fetch', status, markdown, chars: markdown.length, ok: false,
            blockKind: status === 429 ? 'rate-limited' : (status >= 500 ? 'upstream' : 'auth'),
            fallbackReason: 'http-' + status };
        }
        const wall = detect(html, { url, status });   // policy.js의 기존 감지기를 여기서 호출한다
        if (wall && wall.kind === 'login') {
          return { url, source: 'fetch', status, markdown, chars: markdown.length, ok: false,
            blockKind: 'login', fallbackReason: 'login-wall' };
        }
        if (!verdict.needed) return { url, source: 'fetch', status, markdown, chars: markdown.length, ok: true, fallbackReason: null };

   `detect`는 `src/host/browse/policy.js`에서 import한다. 지금 이 경로에는 호출이 없다(감사 지적 18).

## needs_input 매핑 — MODIFY src/host/browse/session.js

[010](010_wp2_result_contract.md)이 슬롯만 두고 미룬 결정을 여기서 넣는다. 로그인 벽은 두 경로에서 같은 status를 쓴다:

        export function itemStatus(item) {
          ...
          if (item.code === 'EBLOCKED' || item.blockKind === 'login') return 'blocked';
          ...
        }

        export function runStatus({ marker, items, leakedUrls, killed, effects = [] }) {
          if (killed || marker === null) return 'indeterminate';
          if (items.some((i) => i.status === 'indeterminate')) return 'indeterminate';
          if (items.some((i) => i.status === 'blocked')) return 'needs_input';   // 새 규칙
          ... (나머지 010과 동일)
        }

`needs_input`은 「사람이 로그인해야 진행된다」는 뜻이고 실패가 아니다. browse의 `EBLOCKED`와 readText의 `blockKind:'login'`이
같은 값을 만들어야 호출자가 두 경로를 구분해 다루지 않아도 된다.

## F7/F8 캐시 — MODIFY search.js, browse.js

- `keyParts`(search.js:105)와 `cacheKey()`에 `since: since || null`을 넣는다.
- `createReadText`에 `cache`를 주입하고(`browse.js:65`) 읽기 전에 조회한다.
  `ok === false`인 관측은 **저장하지 않는다.** prefetch가 채운 값이 소비되는 경로가 이것이다.

## F9 watch — MODIFY watch.js

        const read = await readText(url, { timeoutMs: opts.timeoutMs });
        if (read.ok === false || read.degraded === true) {
          return { url, ok: false, changed: null, code: 'EOBSERVE', blockKind: read.blockKind || null, status: read.status || null };
        }

`put` 자체를 건너뛰므로 마지막 정상 baseline이 보존된다.

## F12 discovery 합의 — MODIFY src/host/actions.js, actions-schema.js

카탈로그만 고치면 안 된다. `actions.js:194`의 `typeOf(args[name]) !== spec.type`는 union을 모른다.
`actions-schema.js:26`은 이미 `type: 'boolean|string'`인데 `true`가 거절되는 이유가 그것이다.

        const wants = String(spec.type).split('|').map((s) => s.trim());
        if (name in args && !wants.includes(typeOf(args[name]))) {
          typeErrors.push({ name, want: spec.type, got: typeOf(args[name]) });
        }

그리고 값 검증을 browse에도 연결한다(현재는 `isSearch || fs.grepFile`만):

        const isBrowse = rec.path.startsWith('browse.');
        else if (name in args && (isSearch || isBrowse || rec.path === 'fs.grepFile')) {
          const problem = isSearch ? checkEntryOptionValue(rec.path, name, args[name])
            : (isBrowse ? checkBrowseOptionValue(rec.path, name, args[name]) : checkOptionValue(name, args[name]));
          if (problem) invalid.push(problem);
        }

`checkBrowseOptionValue`는 런타임 검증기(`schema.js`/`attach-schema.js`)를 호출해 같은 `EBADVAL`/`ENOTSUP`을 재사용한다.
별도 정의를 만들면 두 표면이 다시 갈라진다. `requireSelector`, `waitUntil`, `screenshot.*`, `pdf.*`,
attach `refsFingerprint`, captureMany/readText `timeoutMs`, watch `locale`를 카탈로그의 알려진 키로 등록한다.
`concurrency` 설명은 `Workers in flight; owned tabs are capped by browseCaps.maxTabs`로 고친다.

## F13 envelope — MODIFY src/execution-output.js

        if (out.ok && out.result && typeof out.result === 'object') {
          out.result = shrinkStructured(out.result, limit - size());
          out.truncated = true;
        } else { /* 기존 문자열 경로 */ }

`shrinkStructured`는 배열을 뒤에서 잘라 `omittedItems` 수를 남기고, 긴 문자열 필드는 자르되 키를 유지한다.
`status`, `runId`, `requested`, `completed`는 어떤 예산에서도 남긴다(그것이 잘리면 결과를 해석할 수 없다).

## F10 compactTree — MODIFY snapshot-cache.js

        const m = /^\s*-\s*([a-z][a-z-]*)/i.exec(line);

`test/browse-cache.test.js`의 픽스처를 실제 형식(`  - heading "Example" [ref=e1]`)으로 바꾼다.
`createSnapshotCache`가 `browse.js`에 연결돼 있지 않다는 사실을 모듈 주석에 적는다(연결은 이 phase의 범위가 아니다).

## F11 media — MODIFY media.js

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

## TESTS

- MODIFY `test/browse-readtext.test.js`: 401/403/429/503, 로그인 HTML, `item.text` 부재, 빈 본문 → `degraded`.
- MODIFY `test/browse-repetition.test.js`: since 교차 캐시, prefetch 후 실제 hit, 503 baseline 보존, 스트리밍 상한(수신 바이트 수 단언).
- MODIFY `test/browse-cache.test.js`: 실제 줄 형식 픽스처.
- MODIFY `test/browse-envelope.test.js`: 로그인 벽 항목 → run status `needs_input`.
- NEW `test/browse-discovery.test.js`: 001 F12 표의 키마다 `actions.check`와 런타임이 같은 답을 낸다(허용/거절 쌍으로).
- NEW `test/execution-output.test.js`: 객체 결과가 예산 초과에서도 객체로 남고 `omittedItems`가 보고되며 `status`가 살아남는다.

## Verification (C)

- `node --test test/browse-readtext.test.js test/browse-repetition.test.js test/browse-cache.test.js test/browse-discovery.test.js test/execution-output.test.js test/browse-envelope.test.js` — exit 0.
- hosted CI 5조합 success at head.
