# 020 — wp3: capture 출처-산출물 연결과 부분 완료 표기

근거: [001](001_audit_findings.md) F1. 감사 1라운드 지적 3·13·14 반영본. 전제: [010](010_wp2_result_contract.md)의 `jobId`, `ledger`, `item.status`.

## 결정

- **capture는 `jobId`를 발행하지 않는다.** session이 돌려준 `res.ledger`와 `item.jobId`만 쓴다.
- 조인 키는 `jobId`, 이중 방어는 `artifactName` 대조다. 불일치는 조용히 고치지 않고 `EPROVENANCE`로 떨어뜨린다.
- 이름이 발급됐는데 항목에 `artifactName`이 없으면 그것도 `EPROVENANCE`다(감사 지적: 침묵 구멍).
- **`indeterminate`는 강등되지 않는다.** 아티팩트 성공/실패가 host-kill 판정을 덮지 못한다.

## MODIFY src/host/browse/capture.js

1. 이름 생성(44행)은 그대로 두고, 조인용 맵을 `res`에서 만든다:

        const names = urls.map((_, i) => artifactNameFor(i, screenshot));
        const res = await session.run(job, { browseCaps: opts.browseCaps || {}, artifactNames: names });
        if (!opts.outDir) return res;
        if (!Array.isArray(res.ledger)) {
          // 원장이 없으면 어떤 이름이 어떤 요청의 것인지 알 수 없다. res.items 순서로 재구성하면 F1이 그대로 돌아온다
          // (완료 순서 i를 입력 순서 names[i]에 다시 묶는 것이기 때문이다). 추측하지 않고 거절한다.
          return { ...res, status: 'failed', ok: false, complete: false,
            partial: res.partial.concat('no-ledger'),
            items: res.items.map((it) => ({ ...it, ok: false, status: 'failed', code: 'ECONTRACT',
              error: 'the run returned no issuing ledger, so artifacts cannot be attributed' })) };
        }
        const nameByJob = new Map(res.ledger.map((r) => [r.jobId, names[r.index]]));

2. 조인 루프(64-87행) 교체:

        const items = [];
        for (const src of res.items) {
          const item = { ...src };
          const name = nameByJob.get(item.jobId);
          if (item.status === 'unreturned' || item.status === 'indeterminate') { items.push(item); continue; }
          const mismatched = item.status === 'completed' && name && item.artifactName !== name;
          if (mismatched) {
            item.ok = false; item.status = 'failed'; item.code = 'EPROVENANCE';
            item.error = 'artifact ' + String(item.artifactName) + ' does not match the name issued for ' + item.jobId;
            items.push(item); continue;
          }
          if (item.status === 'completed' && name) {
            try {
              const buf = await containedRead(res.pwd, name, deps);
              const dest = assertInside ? assertInside(path.join(outDir, name)) : path.join(outDir, name);
              await (deps.writeFileImpl || writeFile)(dest, buf);
              const verified = verifyCapture(buf, screenshot);
              item.artifact = { path: dest, ...verified };
              if (!verified.matched) { item.ok = false; item.status = 'failed'; item.code = 'ECAPTURE'; item.error = verified.reason; }
            } catch (e) {
              item.ok = false; item.status = 'failed'; item.code = e.code || 'EARTIFACT'; item.error = String(e.message || e);
            }
          }
          items.push(item);
        }

   `item.ok`를 내릴 때 `item.status`도 같이 내린다. 두 값이 어긋나면 010의 `runStatus`가 틀린 답을 낸다.
3. 반환(88-90행). 기존 `item-failure` push를 **유지**하고 status만 다시 계산한다:

        const partial = res.partial.slice();
        if (items.some((i) => !i.ok) && !partial.includes('item-failure')) partial.push('item-failure');
        const status = res.status === 'indeterminate'
          ? 'indeterminate'
          : (items.every((i) => i.status === 'completed') ? res.status
            : (items.some((i) => i.status === 'completed') ? 'partial' : 'failed'));
        return { ...res, items, partial, status, ok: status === 'completed',
          complete: status === 'completed',
          completed: items.filter((i) => i.status === 'completed').length };

## TESTS — MODIFY test/browse-capture.test.js

- **역순 완료:** 요청 [A, B], final이 [j001, j000] 순서. 각 파일 바이트를 다르게 만들어 교차를 실제로 검출한다.
- **중복 URL:** [A, A]에서 두 항목이 서로 다른 `jobId`와 서로 다른 파일을 갖는다.
- **누락:** 요청 3, final 2 → 세 번째는 `EUNRETURNED`로 남고 read 스텁 호출은 2회다.
- **이름 불일치:** item의 `artifactName`이 다른 jobId의 이름이면 `EPROVENANCE`, `status:'failed'`.
- **이름 부재:** `status:'completed'`인데 `artifactName`이 없으면 `EPROVENANCE`.
- **host-kill:** `res.status === 'indeterminate'`면 반환 status도 `indeterminate`다(강등 금지).
- **원장 부재 + 역순 완료:** `res.ledger`가 없으면 파일을 하나도 읽지 않고 전 항목이 `ECONTRACT`다.
  이름을 위치로 추측하지 않는다는 것을 이 케이스가 고정한다.
  단, wp2가 착수된 뒤로 실제 `createBrowseSession().run()`은 host-kill 경로까지 포함해 **항상** ledger를 싣는다.
  그래서 이 분기는 실행 경로가 아니라 **계약 방어선**이다. 테스트는 ledger를 생략한 session stub로 발동시키고,
  그 사실을 테스트 이름에 적는다. 실제 session이 ledger를 빼도록 고치는 것은 010 위반이다.
- **complete 갱신:** capture 실패로 `status`가 `partial`이 되면 `complete`도 false다(`...res`의 값이 남지 않는다).

## Verification (C)

- `node --test test/browse-capture.test.js test/browse-envelope.test.js` — exit 0.
- hosted CI 5조합 success at head.
