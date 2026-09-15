# 060 — wp7: 읽기·캐시·출력의 P1 묶음

근거: [001](001_audit_findings.md) F6~F13. 감사 1라운드 지적 7·8·18·27 반영본.
공통 결론: **실패한 관측을 정상 관측으로 저장하지 않는다.**

## 적용 순서 (서로 전제가 아니므로 순서를 못박는다)

1. F6 readText 관측 품질 → 2. F9 watch(그 값을 소비) → 3. F7/F8 캐시 키와 소비 경로 →
4. F12 discovery 합의 → 5. F13 envelope → 6. F10 compactTree → 7. F11 media 스트리밍.
1~3은 한 줄기이고 4~7은 독립이다. 각 항목은 자기 테스트로 닫힌다.

## F6 readText — MODIFY src/host/browse/read-text.js

1. 브라우저 폴백에서 빈 본문을 성공으로 내지 않는다(128-132행):

        const body = item.ok ? (item.text || '') : '';        // render.sample은 160자 요약이라 본문이 아니다
        const useBrowser = body.length >= Math.max(1, opts.minChars || 1);
        return useBrowser
          ? { url, source: 'browser', markdown: body, chars: body.length, fallbackReason: verdict.reason, browserOk: true, ok: true }
          : { url, source: 'browser', markdown, chars: markdown.length, fallbackReason: verdict.reason,
              browserOk: true, ok: false, degraded: true, degradedReason: 'browser returned no text' };

**`item.text`를 만들 경로가 지금 없다.** `browse.exec({snapshot:true})`의 성공 항목은 `snapshot`과 160자 `render.sample`뿐이다
(`script.js:331-341`). 그래서 `fullText` 플래그의 **네 홉을 전부** 뚫는다. 한 곳이라도 빠지면 `item.text`는 계속 없다:

1. `schema.js:65`의 `JOB_KEYS`에 `'fullText'`를 추가한다(`rejectUnknown`이 202행에서 모르는 키를 거절한다).
   `validateJob`은 `fullText`를 boolean으로 검증하고 기본값은 false다.
2. `script.js:115-140`의 `compile` payload에 `fullText: job.fullText === true`를 추가한다(payload는 나열된 키만 싣는다).
3. `script.js`의 렌더 구간은 `page.evaluate` **안**이라 `JOB`이 보이지 않는다. 인자로 넘겨야 한다.
   331-341행의 return 객체에 본문을 추가하고, 342행의 인자에 플래그를 넣는다:

        return {
          textChars: visibleText.length,
          ...
          sample: visibleText.slice(0, 160),
          full: opts.fullText ? visibleText.slice(0, opts.maxTextChars) : null,
        };
        }, { selectors: JOB.requireSelector || [], fullText: JOB.fullText === true, maxTextChars: JOB.maxTextChars || 200000 });

   그리고 evaluate 밖에서 만들어지는 `out`(364행)에 복사한다:

        if (out_render && out_render.full) { out.text = out_render.full; delete out_render.full; }

   `out.text`는 `fullText`를 요청했을 때만 생긴다. 기본 경로의 페이로드 크기는 그대로다.
4. `read-text.js:122`의 폴백 호출에 플래그를 넣는다:
   `await browse.exec({ urls: [url], snapshot: true, fullText: true, timeoutMs: opts.timeoutMs || timeoutMs })`

요약을 본문으로 승격하지 않는 것이 F6의 핵심이므로, 본문 경로를 만들지 않으면 이 결함은 닫히지 않는다.

2. fetch 경로(102-117행)에 상태와 로그인 감지를 넣는다. 현재는 `needsBrowser`만 본다:

        const httpBad = status === 401 || status === 403 || status === 429 || status >= 500;
        if (httpBad) {
          return { url, source: 'fetch', status, markdown, chars: markdown.length, ok: false,
            blockKind: status === 429 ? 'rate-limited' : (status >= 500 ? 'upstream' : 'auth'),
            fallbackReason: 'http-' + status };
        }
        // policy.js의 실제 시그니처는 객체 하나다: detect({ requestedUrl, finalUrl, title, tree }).
        // 반환 kind는 'login-wall'이다. fetch는 redirect: 'follow'이므로 최종 URL은 res.url에서 읽는다.
        // 현재 res는 try 블록 안의 const라(read-text.js:101) 이 검사 위치에서 보이지 않는다.
        // let fetched = null; 을 try 밖으로 올리고 101행을 fetched = await doFetch(...)로 바꾼다.
        const finalUrl = (fetched && fetched.url) || url;
        const wall = detect({ requestedUrl: url, finalUrl, tree: markdown });   // title 기본값은 ''이다
        if (wall && wall.kind === 'login-wall') {
          return { url, finalUrl, source: 'fetch', status, markdown, chars: markdown.length, ok: false,
            blockKind: 'login-wall', fallbackReason: 'login-wall' };
        }

   `LOGIN_PATH`는 `finalUrl`만 보므로 같은 URL에서 200으로 렌더되는 로그인 폼은 이 감지기로 잡히지 않는다.
   그 경우는 `tree`(본문 마크다운)의 신호로만 걸리고, 놓칠 수 있다는 사실을 문서에 남긴다. 놓친 것을 성공으로 적지 않는 것이
   이 절의 목표이지, 모든 로그인 벽을 잡는다고 주장하지 않는다.
        if (!verdict.needed) return { url, source: 'fetch', status, markdown, chars: markdown.length, ok: true, fallbackReason: null };

   `detect`는 `src/host/browse/policy.js`에서 import한다. 지금 이 경로에는 호출이 없다(감사 지적 18).

## needs_input 매핑 — MODIFY src/host/browse/session.js

[010](010_wp2_result_contract.md)이 슬롯만 두고 미룬 결정을 여기서 넣는다. 로그인 벽은 두 경로에서 같은 status를 쓴다:

`EBLOCKED`는 캡차와 하드 블록도 포함하므로 그것을 통째로 `needs_input`으로 올리지 않는다.
**사람이 로그인하면 풀리는 경우만** `needs_input`이다. 그 판별은 항목의 `blockKind`로 한다:

        export function itemStatus(item) {
          // 010의 순서를 유지하고, blocked 판정에 blockKind를 더한다
          if (item.code === 'EBLOCKED' || item.blockKind === 'login-wall') return 'blocked';
          ...
        }

        export function runStatus({ marker, items, leakedUrls, killed, effects = [] }) {
          if (killed || marker === null) return 'indeterminate';
          if (items.some((i) => i.status === 'indeterminate')) return 'indeterminate';
          if (effects.some((e) => e.state === 'indeterminate')) {     // 010의 effect 분기를 먼저 둔다
            return items.some((i) => i.status === 'completed') ? 'partial' : 'failed';
          }
          if (items.some((i) => i.blockKind === 'login-wall')) return 'needs_input';
          ... (나머지 010과 동일)
        }

순서가 중요하다. `needs_input`을 effect 분기보다 앞에 두면 불확실한 부작용이 로그인 안내에 가려진다.
010의 테스트(`EBLOCKED` 한 건 → `partial`)는 그대로 유효하고, 여기서 추가되는 것은 `blockKind: 'login-wall'` 케이스다.

**배선:** `readText`는 `session.js`의 envelope를 타지 않는다. 그래서 두 경로가 같은 status를 쓰게 하려면
`readText`의 반환을 배치에서 해석하는 지점(`searchMany`/`prefetch`/`watch`의 호출부)이 `blockKind`를 그대로 올려야 한다.
이 phase는 `readText` 반환에 `ok`/`blockKind`를 넣는 것까지만 하고, 단일 `readText` 호출의 반환 shape은 바꾸지 않는다.

## F7/F8 캐시 — MODIFY search.js, browse.js

- `keyParts`(search.js:105)에 `since: since || null`을 넣고, **`cache.js`의 `cacheKey()`도 MODIFY한다.**
  `cacheKey`는 알려진 키만 `parts`에 넣으므로(`cache.js:20-32`) 인자만 늘리면 키가 그대로다.
  `parts`에 `'since:' + String(since || '')`를 추가한다.
- `createReadText`의 시그니처를 MODIFY한다. 현재는 `{ fetchImpl, browse, timeoutMs }`뿐이라(`read-text.js:77`)
  추가 프로퍼티가 버려진다. `{ fetchImpl, browse, timeoutMs, cache = null, accountRoot = '' }`로 넓히고
  읽기 전 `cache.get({ namespace: 'readText', subject: url, accountRoot, locale })`를 조회한다.
- **호출부도 같이 바꾼다.** `browse.js:65`는 아직 `createReadText({ browse: ... })`다.
  `createReadText({ browse: caps.enabled === true ? { exec } : null, cache, accountRoot })`로 고치지 않으면
  시그니처만 넓어지고 캐시는 여전히 주입되지 않는다.
- `ok === false`인 관측은 **저장하지 않는다.** 이 규칙은 `watch.js:72-73`의 prefetch 쓰기에도 적용한다.
  거기서 `read.ok`를 보지 않고 `{markdown, source}`만 저장하면, 403/로그인 워밍이 캐시 hit로 되살아나
  F9의 `read.ok === false` 검사를 우회한다. 저장 값에 `ok`와 `blockKind`를 함께 넣는다.

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

        const isBrowse = rec.path.startsWith('browse.');   // 루프 앞에서 한 번 계산한다
        ...
        } else if (name in args && (isSearch || isBrowse || rec.path === 'fs.grepFile')) {
          const problem = isSearch ? checkEntryOptionValue(rec.path, name, args[name])
            : (isBrowse ? checkBrowseOptionValue(rec.path, name, args[name]) : checkOptionValue(name, args[name]));
          if (problem) invalid.push(problem);
        }

카탈로그의 타입도 같이 넓혀야 한다. `actions-schema.js:38`의 `requireSelector`는 `type: 'array'`라서
문자열을 넘기면 값 검증에 **도달하기 전에** 타입 검사에서 거절된다. 런타임은 문자열을 배열로 승격하므로
카탈로그를 `'array|string'`으로 바꾼다. union split은 그때 비로소 의미가 생긴다.

`checkBrowseOptionValue`는 런타임 검증기(`schema.js`/`attach-schema.js`)를 호출해 같은 `EBADVAL`/`ENOTSUP`을 재사용한다.
별도 정의를 만들면 두 표면이 다시 갈라진다. `requireSelector`, `waitUntil`, `screenshot.*`, `pdf.*`,
attach `refsFingerprint`, captureMany/readText `timeoutMs`, watch `locale`를 카탈로그의 알려진 키로 등록한다.
`concurrency` 설명은 `Workers in flight; owned tabs are capped by browseCaps.maxTabs`로 고친다.

## F13 envelope — MODIFY src/execution-output.js

        if (out.ok && out.result && typeof out.result === 'object') {
          out.result = shrinkStructured(out.result, limit - size());
          out.truncated = true;
        } else { /* 기존 문자열 경로 */ }

`shrinkStructured` 본문:

        const KEEP = ['schema', 'status', 'runId', 'requested', 'completed', 'unreturned', 'complete', 'truncated'];
        function shrinkStructured(value, budget) {
          if (!value || typeof value !== 'object') return value;
          const out = {};
          for (const k of KEEP) if (k in value) out[k] = value[k];
          let room = budget - Buffer.byteLength(JSON.stringify(out));
          for (const [k, v] of Object.entries(value)) {
            if (k in out) continue;
            if (Array.isArray(v)) {
              const kept = [];
              for (const el of v) {
                const cost = Buffer.byteLength(JSON.stringify(el)) + 1;
                if (cost > room) break;
                room -= cost; kept.push(el);
              }
              out[k] = kept;
              if (kept.length < v.length) out.omittedItems = (out.omittedItems || 0) + (v.length - kept.length);
            } else {
              const s = JSON.stringify(v);
              const cost = Buffer.byteLength(s);
              if (cost <= room) { out[k] = v; room -= cost; }
              else if (typeof v === 'string') { out[k] = v.slice(0, Math.max(0, room)) + '…'; room = 0; }
              else out.omittedKeys = (out.omittedKeys || []).concat(k);
            }
          }
          return out;
        }

`KEEP` 목록은 어떤 예산에서도 남는다. 그것이 잘리면 결과를 해석할 수 없다.

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

## 착수 후 바뀐 결정

계획을 쓴 뒤 구현하면서 네 가지가 달라졌다. 계획이 틀렸던 자리와, 구현이 계획보다 더 알게 된 자리를 구분해 적는다.

**와이어 예산 때문에 extract 블록을 조건부로 주입한다.** 생성 스크립트는 명령행 인자로 건너가고 호스트가 30000자에서 거절한다. F6~F13을 그대로 넣자 acting 경로가 한도를 넘었다. 그래서 `script.js`에 `EXTRACT_SRC`를 두고 `/*__EXTRACT__*/` 자리에 extract를 쓰는 잡에서만 채운다. 현재 acting u20 실측 27843자. `test/browse-tabs.test.js`의 "fits the Windows command line"이 이 한도를 지킨다.

**discovery 합의(F12)는 옵션 하나씩 묻지 않고 인자 전체를 런타임 검증기에 넘긴다.** 처음 구현은 `validateJob({urls, timeoutMs, [name]: value})`로 옵션을 하나씩 떠봤다. 두 가지가 깨졌다. 하나, `snapshotAfter: 'diff'`는 `snapshot: 'tree'`가 같이 있어야 합법인데 혼자 떠보면 언제나 거절이라 wp6이 실제로 내보낸 조합을 `check`가 거부했다. 둘, 프로브가 항상 job 스키마를 썼기 때문에 `browse.searchMany`의 `engine`·`since`, `browse.tabs`의 `urlIncludes`, `browse.downloadMedia`의 `maxBytes`가 전부 "unknown job option"으로 잘못 거절됐다. 지금은 `RUNTIME_VALIDATED`에 `browse.exec`와 `browse.attach`만 등록하고, 나머지 browse 액션은 자기 인자를 `browse.js` 안에서 파싱하므로 job 스키마로 재단하지 않는다. 거절이 어느 옵션 때문인지는 메시지에서 이름을 긁는 대신 옵션을 하나씩 빼보며 찾는다. `networkidle`처럼 옵션 이름을 되풀이하지 않는 거절 문구가 있기 때문이다.

**readText에 캐시를 붙이면서 watch와 prefetch를 같이 고쳐야 했다.** 계획은 F7/F8을 캐시 키 문제로만 봤는데, 캐시를 붙이자 두 가지가 따라왔다. watch가 `readText`를 통해 읽으므로 15분 TTL 안에서는 바뀐 페이지도 "안 바뀜"으로 보고한다 — watch는 이제 `fresh: true`로 읽는다. 그리고 prefetch가 같은 키에 `{markdown, source}`만 따로 써 넣고 있어서, readText가 그 항목을 돌려주면 `ok`도 `chars`도 없는 답이 나왔다 — prefetch의 두 번째 쓰기를 없애고 readText가 자기 항목을 소유한다. hit 재사용은 `ok === true`이고 `chars`가 호출자의 `minChars` 이상일 때로 제한했다. `minChars`는 키에 없으므로 재사용 시점에 재어야 한다.

**compactTree 정규식은 대시를 받되 대괄호 접두도 계속 받는다.** 계획의 `/^\s*-\s*(...)/`는 대시를 필수로 만들고 기존의 `[...]` 접두 지원을 버린다. 둘 다 조용히 빈 트리를 만드는 실패라서, 실제 형식은 `/^\s*-?\s*(?:\[[^\]]*\]\s*)?([a-z][a-z-]*)/i`로 둘 다 받는다.

테스트 파일도 계획의 MODIFY 목록과 다르다. `browse-readtext`·`browse-repetition`·`browse-cache`를 고치는 대신 `test/browse-observation.test.js`(관측 품질·캐시·watch·prefetch), `test/browse-discovery.test.js`(카탈로그와 런타임 합의), `test/execution-output.test.js`(구조 보존 축소)를 새로 만들었다. 기존 파일은 자기 주제가 따로 있어서, 여기에 얹으면 무엇이 무엇을 지키는지 읽히지 않는다.
