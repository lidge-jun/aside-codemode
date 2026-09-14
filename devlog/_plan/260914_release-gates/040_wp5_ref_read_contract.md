# 040 — wp5: ref 읽기 계약 (기존 wp2b)

근거: `devlog/_plan/260914_a11y-actions/070_wp2_decisions.md`의 D1, D5, D6, D9 + 2026-09-14 로드맵의 반론.
현재 상태: `schema.js:232-243`의 `extract`는 css selector만 받는다. `{ ref }` 형식도 `snapshotAfter`도 아직 없다.

## 결정 (070과 달라지는 부분을 먼저 적는다)

- **070 D1 유지:** `extract`의 `{ ref }`는 `refsFingerprint`를 **요구**한다. 없으면 validation에서 `EBADVAL`로 거절한다.
  런타임에서 renumber된 트리를 읽고 확신에 찬 틀린 문자열을 돌려주는 것보다 낫다.
- **070 D2 범위 축소(로드맵 반영):** `actions`와 `{ ref }` extract를 **같은 호출 안에서** 금지하는 규칙은 유지한다.
  이유는 안전이 아니라 산술이다. fingerprint를 넘긴 상태에서 mutation이 성공하면 그 fingerprint는 반드시 어긋난다.
  다만 이것을 제품 전체의 금지로 확대하지 않는다. **액션 → 새 관찰 → 새 ref 읽기는 허용한다.**
  그 경로는 `browse.attach`이고, 이번 phase가 그것을 실제로 연다(070 D9는 attach의 ref 읽기를 범위 밖으로 남겼다).
- **070 D6 유지:** 읽기는 역할을 안다. `textbox searchbox combobox spinbutton slider checkbox radio`는 `inputValue()`,
  나머지는 `innerText()`. `{ ref, attr }`은 `getAttribute(attr)`, `{ ref, text: true }`는 `innerText()` 강제.
  checkbox의 `value` 문자열은 checked 상태가 아니다. 그래서 상태는 `state`로만 읽고 value로 읽지 않는다.
- **계정·문서·프레임이 다르면 ref를 재사용하지 않는다.** fingerprint는 그 세 가지를 포함한 관찰의 지문이다.

## MODIFY src/host/browse/schema.js

1. `extract` 검증(232-243행)에 ref 형식을 추가한다:

        for (const [field, spec] of Object.entries(raw.extract)) {
          if (spec && typeof spec === 'object' && 'ref' in spec) {
            if (typeof spec.ref !== 'string' || !/^f?e\d+$/.test(spec.ref)) throw new BrowseOptionError('extract.' + field + '.ref must look like e12 or f2e7', 'EBADVAL');
            if (!refsFingerprintPresent) throw new BrowseOptionError('extract.' + field + ' uses a ref, which requires refsFingerprint from the observation that produced it', 'EBADVAL');
            if (actionsPresent) throw new BrowseOptionError('a ref read cannot share a call with actions; act, then read with browse.attach using snapshotAfter', 'EBADVAL');
            continue;
          }
          ... (기존 css selector 검증 그대로)
        }

   `refsFingerprintPresent`/`actionsPresent`는 같은 함수 안에서 이미 파싱된 값을 쓴다(290행 `refsFingerprint`, 그리고 actions 파싱 결과).
   거절 메시지가 **대안 경로를 가리킨다**는 점이 중요하다. 기능을 막는 것이 아니라 옮기는 것이다.

2. `JOB_KEYS`(65행)에 `snapshotAfter`를 추가하고 boolean으로 검증한다.

## MODIFY src/host/browse/attach-schema.js

`browse.attach`가 `extract`(ref 형식 포함), `refsFingerprint`, `snapshotAfter`를 받도록 키를 추가한다.
attach는 탭을 재사용하므로 액션 뒤 같은 문맥에서 새 관찰을 만들 수 있는 유일한 경로다.

## MODIFY src/host/browse/script.js

1. 역할 인식 읽기(생성 스크립트 안, 기존 `fingerprintOf` 근처):

        const VALUE_ROLES = ['textbox','searchbox','combobox','spinbutton','slider','checkbox','radio'];
        async function readRef(page, ref, spec, rows) {
          const row = rows.find((r) => r.ref === ref);
          if (!row) return { ok: false, code: 'ENOREF' };
          const loc = page.locator('aria-ref=' + ref);
          if (spec.attr) return { ok: true, value: await loc.getAttribute(spec.attr), read: 'attribute', role: row.role };
          if (spec.text === true) return { ok: true, value: await loc.innerText(), read: 'innerText', role: row.role };
          if (VALUE_ROLES.includes(row.role)) return { ok: true, value: await loc.inputValue(), read: 'inputValue', role: row.role };
          return { ok: true, value: await loc.innerText(), read: 'innerText', role: row.role };
        }

   반환에 `read`와 `role`을 실어 호출자가 무엇으로 읽혔는지 알 수 있게 한다. 빈 문자열은 값이지 부재가 아니다.
   `missing`은 `ENOREF`일 때만이다.
2. fingerprint 검증: 읽기 전에 현재 관찰의 지문과 `JOB.refsFingerprint`를 비교하고 다르면 그 필드를
   `{ ok: false, code: 'ESTALEREF', guard: 'fingerprint' }`로 돌려준다. 좌표나 텍스트로 추측해 대체하지 않는다.
3. `snapshotAfter: true`면 액션 뒤 최종 관찰의 `fingerprint`를 결과에 싣는다. 그 값이 다음 attach 호출의 입장권이다.

## TESTS

NEW `test/browse-ref-read.test.js`:

- fingerprint 없는 `{ ref }`는 `EBADVAL`로 거절되고 메시지가 attach 경로를 가리킨다.
- `actions`와 `{ ref }`가 같은 호출이면 거절된다.
- checkbox를 `{ ref }`로 읽으면 `read === 'inputValue'`이고, 그 값이 checked 상태로 해석되지 않는다(별도 필드).
- 빈 textbox는 `ok:true, value:''`이지 missing이 아니다.
- fingerprint가 어긋나면 `ESTALEREF`이고 값이 오지 않는다.
- attach에서 액션 → `snapshotAfter` → 새 fingerprint로 두 번째 읽기가 성공한다(액션 뒤 읽기 금지가 아님을 고정).

## Verification (C)

- `node --test test/browse-ref-read.test.js test/browse-schema.test.js test/browse-attach.test.js` — exit 0.
- 실제 `aside repl` 프로브: 로컬 fixture 페이지에서 checkbox 토글 후 attach 체이닝으로 상태를 읽는다. mac + mini.
- hosted CI 5조합 success at head.
