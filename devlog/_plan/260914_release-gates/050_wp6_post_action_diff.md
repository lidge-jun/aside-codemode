# 050 — wp6: post-action diff (기존 wp2c)

근거: `260914_a11y-actions/070_wp2_decisions.md` D3, D4, D5 + 로드맵의 diff 절. 전제: wp5의 관찰·fingerprint 계약.

## 결정

- **비교 가능성 판정은 url이 아니라 트리로 한다(D3).** SPA 재렌더는 `location.href`를 바꾸지 않는다.

        key(row) = ref + '|' + role + '|' + name
        overlap  = |before ∩ after| / max(1, before.length)

  `overlap < 0.5`면 `{ comparable: false, reason: 're-minted', overlap, beforeCount, afterCount }`를 반환하고
  added/removed/changed/same을 만들지 않는다. url 이동은 별도로 `reason: 'navigated'`다. 둘은 서로 의존하지 않는다.
- **겹침 비율은 휴리스틱이다(로드맵 반영).** 개별 요소가 같다는 증명이 아니므로 문서와 반환 필드 이름 모두 그렇게 적는다.
  `comparable:true`여도 각 행의 동일성은 `key` 일치까지이고, 그 이상을 주장하지 않는다.
- **ref 없는 행도 읽는다(D4).** option 행은 `[ref=]`가 없으므로 `depth|role|name`으로 키를 만들어
  `staticRows: { added, removed }`로 낸다. `(selected)` 이동은 static 행 하나 제거 + 하나 추가로 보인다.
- **state는 allowlist다(D5).** `checked disabled expanded selected pressed readonly required invalid busy current`.
  그 외 대괄호는 `attrs`로 간다. placeholder를 상태라고 부르지 않는다. depth 이동은 `depthChanged`로 분리한다.
- **민감 입력값은 diff에서 제외한다.** `password`/`[type=password]` 역할의 value는 비교만 하고 값을 싣지 않는다.

## MODIFY src/host/browse/script.js

1. 행 파서를 확장한다. 현재는 ref 행만 요약한다. 변경 후 한 행이 갖는 것:

        { ref, role, name, depth, state: [...allowlist], attrs: { ... }, raw }

2. `diffRefs(before, after)`를 추가한다:

        function diffRefs(before, after) {
          const nav = before.url !== after.url;
          const bk = new Set(before.rows.filter(r => r.ref).map(k3));
          const ak = new Set(after.rows.filter(r => r.ref).map(k3));
          let hit = 0; for (const k of bk) if (ak.has(k)) hit++;
          const overlap = hit / Math.max(1, bk.size);
          if (nav) return { comparable: false, reason: 'navigated', overlap, beforeCount: bk.size, afterCount: ak.size };
          if (overlap < 0.5) return { comparable: false, reason: 're-minted', overlap, beforeCount: bk.size, afterCount: ak.size };
          return { comparable: true, overlap, added, removed, changed, depthChanged, staticRows, same: sameCount };
        }

3. `snapshotAfter`가 켜져 있으면 최종 관찰과 diff, 그리고 새 `fingerprint`를 함께 반환한다.
   `comparable:false`면 diff 대신 `reset: { snapshotId, fingerprint, tree }`를 준다. 호출자는 새 관찰로 다시 시작한다.

## 반환 계약

        { baseSnapshotId, snapshotId, documentId, frameId, comparable, reason?, overlap,
          added[], removed[], changed[], depthChanged[], staticRows{added,removed}, same, complete, truncated }

`complete`/`truncated`는 출력 예산 때문에 행이 잘렸는지를 말한다. 잘린 경우에도 객체 형태를 유지한다(F13과 같은 규칙).

## TESTS — NEW test/browse-diff.test.js

- 같은 url에서 트리가 재발급되면 `comparable:false, reason:'re-minted'`이고 overlap 숫자가 실려 온다.
- url이 바뀌면 `reason:'navigated'`이고 overlap 계산과 무관하게 거절된다.
- ref click으로 토글된 checkbox가 `changed`에 state 델타로 나타난다.
- 실패한 submit 뒤 나타난 정적 오류 문구가 `staticRows.added`에 있다.
- dialog로 감싸져 depth만 바뀐 행은 `changed`가 아니라 `depthChanged`에 있다.
- password 입력의 값은 어떤 필드에도 실리지 않는다.

## Verification (C)

- `node --test test/browse-diff.test.js test/browse-a11y.test.js` — exit 0.
- 실제 fixture 페이지에서 mac + mini 프로브 1회씩.
- hosted CI 5조합 success at head.
