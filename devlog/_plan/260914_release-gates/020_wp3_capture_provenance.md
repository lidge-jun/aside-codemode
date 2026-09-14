# 020 — wp3: capture 출처-산출물 연결과 부분 완료 표기

근거: [001](001_audit_findings.md) F1. 전제: wp2가 `jobId`와 요청 순서 정규화를 끝냈다.

## 결정

- 조인 키는 `jobId`다. 위치 인덱스는 더 이상 쓰지 않는다.
- 이중 방어로 `item.artifactName`(스크립트가 메아리한 호스트 이름)이 있으면 그것과 조인 결과가 일치하는지 확인하고,
  불일치면 그 항목을 `ok:false, code:'EPROVENANCE'`로 떨어뜨린다. 조용히 고치지 않는다.
- 미반환 항목(`EUNRETURNED`)은 파일을 읽지 않는다. 없는 파일을 읽어 `EARTIFACT`로 바꾸면 원인이 사라진다.

## MODIFY src/host/browse/capture.js

1. 이름 생성 시점에 jobId를 함께 만든다(현재 44행):

        const plan = urls.map((url, i) => ({ jobId: 'j' + String(i).padStart(3, '0'), url, name: artifactNameFor(i, screenshot) }));
        const names = plan.map((p) => p.name);
        const nameByJob = new Map(plan.map((p) => [p.jobId, p.name]));

2. 조인 루프(현재 64-87행)를 교체한다:

        const items = [];
        for (const src of res.items) {
          const item = { ...src };
          const name = nameByJob.get(item.jobId);
          if (item.status === 'unreturned' || item.status === 'indeterminate') { items.push(item); continue; }
          if (item.ok && item.artifactName && name && item.artifactName !== name) {
            item.ok = false; item.code = 'EPROVENANCE';
            item.error = 'artifact ' + item.artifactName + ' does not match the name issued for ' + item.jobId;
            items.push(item); continue;
          }
          if (item.ok && item.artifactName && name) {
            try {
              const buf = await containedRead(res.pwd, name, deps);
              ... (기존 write/verify 로직 그대로, dest는 name 기준)
            } catch (e) { item.ok = false; item.code = e.code || 'EARTIFACT'; item.error = String(e.message || e); }
          }
          items.push(item);
        }

3. 반환(현재 88-90행)을 wp2 계약에 맞춘다:

        const status = items.every((i) => i.ok) ? res.status : (items.some((i) => i.ok) ? 'partial' : 'failed');
        return { ...res, items, partial, status, ok: status === 'completed' };

   `res.status`가 이미 `indeterminate`면 아티팩트 성공이 그것을 `completed`로 올리지 않는다.

## TESTS — MODIFY test/browse-capture.test.js

- **역순 완료:** 요청 [A, B], final items가 [B(j001), A(j000)] 순서로 오고 각자 자기 `artifactName`을 들고 있을 때,
  A의 결과에 A의 파일이, B의 결과에 B의 파일이 붙는다. 파일 내용을 서로 다른 바이트로 만들어 교차를 실제로 검출한다.
- **중복 URL:** 요청 [A, A]에서 두 항목이 서로 다른 `jobId`와 서로 다른 파일을 갖는다.
- **누락:** 요청 3개, final 2개일 때 세 번째 항목은 `EUNRETURNED`로 남고 파일 읽기를 시도하지 않는다(read 스텁 호출 횟수 2회).
- **출처 불일치:** item의 `artifactName`이 다른 jobId의 이름이면 `EPROVENANCE`.

## Verification (C)

- `node --test test/browse-capture.test.js test/browse-envelope.test.js` — exit 0.
- hosted CI 5조합 success at head.
