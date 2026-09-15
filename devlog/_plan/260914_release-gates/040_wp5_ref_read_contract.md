# 040 — wp5: ref 읽기 계약 (기존 wp2b)

근거: `260914_a11y-actions/070_wp2_decisions.md` D1, D5, D6, D9 + 2026-09-14 로드맵의 반론.
감사 1라운드 지적 15·16·17 반영본. 현재 상태: `schema.js:232-243`의 `extract`는 css selector만 받고, `snapshotAfter`는 없다.

## 결정

- **D1 유지:** `{ ref }` extract는 `refsFingerprint`를 요구한다. 없으면 `EBADVAL`.
- **D2 축소(로드맵 반영):** 같은 호출 안에서 `actions`와 `{ ref }` extract는 거절한다. 이유는 안전이 아니라 산술이다.
  fingerprint를 넘긴 상태에서 mutation이 성공하면 그 fingerprint는 반드시 어긋난다.
  **액션 → 새 관찰 → 새 ref 읽기는 허용한다.** 그 경로가 `browse.attach`이고 이 phase가 그것을 연다.
  거절 메시지는 금지가 아니라 대안 경로를 가리킨다.
- **D6 유지:** 읽기는 역할을 안다. checkbox의 `value` 문자열은 checked 상태가 아니다.
- **계정·문서·프레임이 다른 관찰의 ref는 재사용하지 않는다.** fingerprint에 그 세 값을 포함하고, 다르면 `ESTALEREF`다.

## MODIFY src/host/browse/schema.js

1. **파싱 순서를 바꾼다.** 현재 `extract` 루프는 232행, `validateActions`는 267행, `refsFingerprint`는 290행의 return 리터럴 안이다.
   extract가 그 둘을 보려면 앞으로 올려야 한다. 변경 전(순서):

        let extract = null;            // 232
        ...
        const actions = validateActions(raw.actions);   // 267
        ... refsFingerprint: ... (return 리터럴 안, 290)

   변경 후(순서):

        const actions = validateActions(raw.actions);
        const refsFingerprint = typeof raw.refsFingerprint === 'string' && raw.refsFingerprint.length ? raw.refsFingerprint : null;
        const snapshotAfter = raw.snapshotAfter === undefined ? false : raw.snapshotAfter === true;
        if (raw.snapshotAfter !== undefined && typeof raw.snapshotAfter !== 'boolean') {
          throw new BrowseOptionError('snapshotAfter must be a boolean', 'EBADVAL');
        }
        let extract = null;            // 이제 위 세 값을 읽을 수 있다

   return 리터럴의 `refsFingerprint`/`actions` 항목은 새로 만든 지역 변수를 그대로 참조한다(중복 파싱 금지).
2. extract 루프에 ref 형식을 추가한다:

        if (spec && typeof spec === 'object' && 'ref' in spec) {
          if (typeof spec.ref !== 'string' || !/^f?e\d+$/.test(spec.ref)) {
            throw new BrowseOptionError('extract.' + field + '.ref must look like e12 or f2e7', 'EBADVAL');
          }
          if (!refsFingerprint) {
            throw new BrowseOptionError('extract.' + field + ' reads by ref, which requires refsFingerprint from the observation that produced it', 'EBADVAL');
          }
          if (actions && actions.length) {
            throw new BrowseOptionError('a ref read cannot share a call with actions; act first, then read with browse.attach using the fingerprint that snapshotAfter returned', 'EBADVAL');
          }
          continue;
        }

3. `JOB_KEYS`(65행)에 `'snapshotAfter'`를 추가한다.

## MODIFY src/host/browse/attach-schema.js

`refsFingerprint`는 이미 known 집합(21행)에 있다. **추가되는 키는 `extract`와 `snapshotAfter` 둘뿐이다.**
`extract`의 ref 형식 검증은 schema.js와 같은 함수를 공유한다(중복 정의 금지: 새 `validateExtract(raw, { actions, refsFingerprint })`를 schema.js에서 export).

## MODIFY src/host/browse/script.js

1. 역할 인식 읽기:

        const VALUE_ROLES = ['textbox','searchbox','combobox','spinbutton','slider','checkbox','radio'];
        async function readRef(page, ref, spec, rows) {
          const row = rows.find((r) => r.ref === ref);
          if (!row) return { ok: false, code: 'ENOREF' };
          const loc = page.locator('aria-ref=' + ref);
          if (spec.attr) return { ok: true, value: await loc.getAttribute(spec.attr), read: 'attribute', role: row.role };
          if (spec.text === true) return { ok: true, value: await loc.innerText(), read: 'innerText', role: row.role };
          if (VALUE_ROLES.includes(row.role)) return { ok: true, value: await loc.inputValue(), read: 'inputValue', role: row.role,
            checked: row.state.includes('checked') };
          return { ok: true, value: await loc.innerText(), read: 'innerText', role: row.role };
        }

   checkbox/radio는 `value`와 `checked`를 **따로** 싣는다. 빈 문자열은 값이고, 부재는 `ENOREF`뿐이다.
2. 읽기 전에 현재 관찰의 지문을 `JOB.refsFingerprint`와 비교하고 다르면 `{ ok:false, code:'ESTALEREF', guard:'fingerprint' }`.
   지문은 `account|document|frame|rows` 조합이다. 좌표나 텍스트로 추측해 대체하지 않는다.
3. `snapshotAfter: true`면 액션 뒤 최종 관찰의 `fingerprint`와 `snapshotId`를 결과에 싣는다.

## TESTS — NEW test/browse-ref-read.test.js

- fingerprint 없는 `{ ref }` → `EBADVAL`, 메시지에 `browse.attach`가 나온다.
- `actions` + `{ ref }` → `EBADVAL`, 메시지에 `snapshotAfter`가 나온다.
- checkbox `{ ref }` → `read:'inputValue'`이고 `checked`가 별도 필드다(value로 상태를 판단하지 않는다).
- 빈 textbox → `ok:true, value:''` (missing 아님).
- 없는 ref → `ENOREF`.
- 지문 불일치 → `ESTALEREF`, 값 없음.
- **다른 계정/문서/프레임 지문** → 행 구성이 같아도 `ESTALEREF`(세 값이 지문에 들어감을 고정).
- attach 체이닝: 액션 → `snapshotAfter` → 새 fingerprint로 두 번째 호출의 ref 읽기 성공.

## Verification (C)

## 착수 후 바뀐 결정

- **write set이 `attach.js`까지 넓어졌다.** 040은 `attach-schema.js`만 적었지만, 스키마만 열면 옵션을 받고 아무것도 하지 않는다.
  attach 템플릿이 `REQ.extract`와 `REQ.snapshotAfter`를 실제로 실행한다. 이 phase가 막으려던 침묵 저하가 바로 그것이다.
- **지문은 행 해시이고, 문서 정체성은 `snapshotId`가 싣는다.** 040은 지문이 계정·문서·프레임을 포함한다고 적었지만
  `summarizeTree`의 지문은 `ref|role|name` 행 해시다. 그래서 `snapshotAfter`가 `snapshotId = fingerprint + '@' + url`을 발행하고,
  `refsFingerprint`는 그 id 형태도 받는다. id를 주면 행과 문서를 함께 대조하므로 트리 모양이 같은 다른 문서의 ref는 거절된다.
  계정과 프레임까지 한 값으로 묶는 것은 아직 아니다. 프레임은 ref 자체가 `f2e7`로 구분하고, 계정은 관찰 경로 밖이다.
- **생성 스크립트가 커져서 헬퍼를 조건부로 주입한다.** `REF_READ`, `REF_SPLIT`, `REF_EXTRACT`, `SNAPSHOT_AFTER`는
  그 기능을 쓰는 job에만 실린다. 호스트는 자기 소스가 30000자를 넘으면 거절하고, 액션 헬퍼만 9.6KB다.
  20 URL + snapshot + fingerprint + snapshotAfter + actions + screenshot + pdf 조합이 29580으로 들어간다.

## Verification (C)

- `node --test test/browse-ref-read.test.js test/browse-schema.test.js test/browse-attach.test.js` — exit 0.
- 로컬 fixture에서 mac + mini 프로브: checkbox 토글 후 attach 체이닝으로 상태 읽기.
- hosted CI 5조합 success at head.
