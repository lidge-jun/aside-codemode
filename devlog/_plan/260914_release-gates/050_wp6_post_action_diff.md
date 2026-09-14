# 050 — wp6: post-action diff (기존 wp2c)

근거: `260914_a11y-actions/070_wp2_decisions.md` D3, D4, D5. 감사 1라운드 지적 9·26 반영본.
전제: [040](040_wp5_ref_read_contract.md)의 관찰·fingerprint 계약.

## 결정 — 거절 이유는 두 개이고 서로 독립이다

`navigated`(url 이동)와 `re-minted`(트리 재발급)는 **각각 독립적으로** 비교를 거절한다.
url 비교만으로는 SPA 재렌더를 못 잡고, 트리 겹침만으로는 문서 이동을 못 잡는다. 둘 다 검사한다.
겹침 비율은 **비교 가능성 휴리스틱**이지 개별 요소가 동일하다는 증명이 아니다. 반환 필드 이름과 문서 모두 그렇게 적는다.

## MODIFY src/host/browse/script.js — 행 파서 확장

현재 요약은 ref 행만 다룬다. 변경 후 한 행:

        { ref: 'e12'|null, role: 'checkbox', name: 'Agree', depth: 3,
          state: ['checked'], attrs: { placeholder: 'parent input' }, raw: '...' }

        const STATE_KEYS = ['checked','disabled','expanded','selected','pressed','readonly','required','invalid','busy','current'];
        function parseRow(line) {
          const depth = (line.match(/^\s*/)[0].length / 2) | 0;
          const ref = (line.match(/\[ref=([^\]]+)\]/) || [])[1] || null;
          const role = (line.match(/^\s*-\s*([a-z][a-z-]*)/i) || [])[1] || '';
          const name = (line.match(/"([^"]*)"/) || [])[1] || '';
          const state = []; const attrs = {};
          for (const m of line.matchAll(/\[([a-z-]+)(?:=([^\]]*))?\]/gi)) {
            const k = m[1].toLowerCase();
            if (k === 'ref') continue;
            if (STATE_KEYS.includes(k)) state.push(k); else attrs[k] = m[2] === undefined ? true : m[2];
          }
          return { ref, role, name, depth, state: state.sort(), attrs, raw: line.trim() };
        }

## MODIFY src/host/browse/script.js — diffRefs

        function k3(r) { return r.ref + '|' + r.role + '|' + r.name; }
        function kStatic(r) { return r.depth + '|' + r.role + '|' + r.name; }
        function diffRefs(before, after) {
          const bRef = before.rows.filter((r) => r.ref);
          const aRef = after.rows.filter((r) => r.ref);
          const bMap = new Map(bRef.map((r) => [k3(r), r]));
          const aMap = new Map(aRef.map((r) => [k3(r), r]));
          let hit = 0; for (const k of bMap.keys()) if (aMap.has(k)) hit++;
          const overlap = hit / Math.max(1, bMap.size);
          const base = { overlap, beforeCount: bMap.size, afterCount: aMap.size };
          if (before.url !== after.url) return { comparable: false, reason: 'navigated', ...base };
          if (overlap < 0.5) return { comparable: false, reason: 're-minted', ...base };
          const added = [], removed = [], changed = [], depthChanged = [];
          for (const [k, r] of aMap) if (!bMap.has(k)) added.push(r.raw);
          for (const [k, r] of bMap) if (!aMap.has(k)) removed.push(r.raw);
          let same = 0;
          for (const [k, b] of bMap) {
            const a = aMap.get(k); if (!a) continue;
            const sChanged = b.state.join(',') !== a.state.join(',');
            const vChanged = JSON.stringify(b.attrs) !== JSON.stringify(a.attrs);
            if (b.depth !== a.depth) depthChanged.push({ ref: a.ref, from: b.depth, to: a.depth });
            if (sChanged || vChanged) changed.push({ ref: a.ref, role: a.role, name: a.name,
              state: { from: b.state, to: a.state }, attrs: redact(a.role, { from: b.attrs, to: a.attrs }) });
            else if (b.depth === a.depth) same++;
          }
          const bS = new Map(before.rows.filter((r) => !r.ref).map((r) => [kStatic(r), r]));
          const aS = new Map(after.rows.filter((r) => !r.ref).map((r) => [kStatic(r), r]));
          const staticRows = { added: [], removed: [] };
          for (const [k, r] of aS) if (!bS.has(k)) staticRows.added.push(r.raw);
          for (const [k, r] of bS) if (!aS.has(k)) staticRows.removed.push(r.raw);
          return { comparable: true, ...base, added, removed, changed, depthChanged, staticRows, same };
        }

`redact(role, pair)`는 비밀번호 입력의 값을 `'[redacted]'`로 바꾼다. 변경 여부는 보이되 값은 싣지 않는다:

        function redact(role, pair) {
          if (role !== 'textbox' && role !== 'searchbox') return pair;
          const hide = (o) => (o && (o.type === 'password' || 'password' in o) ? { ...o, value: '[redacted]' } : o);
          return { from: hide(pair.from), to: hide(pair.to) };
        }

## 반환 계약

        { baseSnapshotId, snapshotId, documentId, frameId, comparable, reason?, overlap,
          added[], removed[], changed[], depthChanged[], staticRows{added,removed}, same, complete, truncated }

`comparable:false`면 diff 대신 `reset: { snapshotId, fingerprint, tree }`를 준다.
출력 예산으로 행이 잘려도 객체 형태를 유지한다([060](060_wp7_p1_batch.md) F13과 같은 규칙).

## TESTS — NEW test/browse-diff.test.js

- 같은 url, 겹침 0.2 → `comparable:false, reason:'re-minted'`, overlap 숫자 포함.
- url 변경 + 겹침 0.9 → `reason:'navigated'` (겹침이 높아도 거절).
- checkbox 토글 → `changed`에 `state: { from: [], to: ['checked'] }`.
- 실패한 submit 뒤 정적 오류 문구 → `staticRows.added`.
- dialog로 감싸 depth만 이동 → `depthChanged`에만 나오고 `changed`에는 없다.
- `[type=password]` 입력의 값 변경 → `changed`에 나오되 값은 `[redacted]`.
- option 행의 `(selected)` 이동 → `staticRows`의 removed/added 한 쌍.

## Verification (C)

- `node --test test/browse-diff.test.js test/browse-a11y.test.js` — exit 0.
- 로컬 fixture로 mac + mini 프로브 1회씩.
- hosted CI 5조합 success at head.
