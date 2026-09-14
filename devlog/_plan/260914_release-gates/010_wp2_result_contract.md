# 010 — wp2: 결과 계약 코어 (runId / jobId / 요청 원장 / status)

근거: [001](001_audit_findings.md) F1, F2, F13 + architect A1, A2, A3. 이 문서는 복사해 실행할 수 있는 PRD다.
이 phase는 식별자와 대조만 넣는다. capture 조인은 wp3, 효과 수명은 wp4가 소비한다.

## 결정

- **식별자는 호스트가 발행한다(A1 채택).** `session.run`이 요청마다 `jobId`를 만들고 plan에 실어 보낸다.
  스크립트는 받은 값을 메아리만 한다. host-kill 경로에도 같은 원장이 있으므로 결과가 비지 않는다.
- **`jobId`는 위치 기반 + run 고유 접두사다.** `j000`, `j001` ... 중복 URL을 구분해야 하므로 URL 키를 쓰지 않는다.
- **대조는 `session.js`에 둔다(A2 채택).** 요청 원장을 진실로 보고, 반환되지 않은 항목은 `EUNRETURNED`로 채운다.
- **envelope는 추가만 한다(A3 채택).** `ok`는 `status === 'completed'`에서 유도한다. `cache.js`의 `SCHEMA_VERSION`은 건드리지 않는다.
- **하위호환:** 반환 items에 `jobId`가 없고 길이가 요청과 같으면 위치로 대조하고 `reconciledBy: 'position'`을 남긴다.
  길이가 다르고 `jobId`도 없으면 위치 대조를 하지 않는다(그 경우가 바로 F2다).

## MODIFY src/host/browse/session.js

1. 상단 import에 `randomUUID` 추가:

        import { randomUUID } from 'node:crypto';

2. `run()` 안, plan 조립(현재 104-114행) 앞에 요청 원장을 만든다:

        const runId = 'run-' + randomUUID();
        const requested = job.urls.map((url, i) => ({ jobId: 'j' + String(i).padStart(3, '0'), url, index: i }));

3. `planWithNames` / `planFinal` 체인의 마지막에 `jobId`를 붙인다(이름 옵션이 없어도 항상):

        const planIds = (planFinal || job.urls.map((url) => ({ url, timeoutMs: job.timeoutMs, waitSelector: job.waitSelector, skip: false })))
          .map((p, i) => ({ ...p, jobId: requested[i].jobId }));
        const source = compile(job, planIds);

4. host-kill 반환(현재 138-148행)을 원장으로 만든다:

        return finalize({
          status: 'indeterminate',
          items: requested.map((r) => ({ jobId: r.jobId, url: r.url, ok: false, status: 'indeterminate',
            code: killed ? 'EHOSTKILL' : 'ENOMARKER' })),
          partial: [killed ? 'host-kill' : 'no-marker'],
          leakedUrls: job.urls.slice(),
          ...
        });

   `EHOSTKILL`은 실패가 아니라 미확정이다. 스크립트가 출력하지 못했을 뿐 탭과 부작용은 남아 있을 수 있다.

5. 정상 경로(현재 151행 이후)에 대조 단계를 넣는다:

        const byJob = new Map();
        for (const it of items) if (it && typeof it.jobId === 'string') byJob.set(it.jobId, it);
        const positional = byJob.size === 0 && items.length === requested.length;
        const reconciled = requested.map((r, i) => {
          const hit = byJob.get(r.jobId) || (positional ? items[i] : null);
          if (!hit) return { jobId: r.jobId, url: r.url, ok: false, status: 'unreturned', code: 'EUNRETURNED' };
          return { ...hit, jobId: r.jobId, url: hit.url || r.url, status: itemStatus(hit) };
        });
        const extra = items.filter((it) => it && it.jobId && !requested.some((r) => r.jobId === it.jobId));

6. 상태 유도 함수 두 개를 모듈 최상단(export)으로 추가한다:

        export function itemStatus(item) {
          if (item.ok) return 'completed';
          if (item.code === 'EUNRETURNED') return 'unreturned';
          if (item.code === 'ESKIP' || item.code === 'ETABBUDGET') return 'skipped';
          if (item.code === 'EBLOCKED') return 'blocked';
          if (item.code === 'EHOSTKILL' || item.code === 'ENOMARKER') return 'indeterminate';
          return 'failed';
        }

        export function runStatus({ marker, items, leakedUrls, killed }) {
          if (killed || marker === null) return 'indeterminate';
          if (items.some((i) => i.status === 'indeterminate')) return 'indeterminate';
          const done = items.filter((i) => i.status === 'completed').length;
          if (done === items.length && items.length > 0 && leakedUrls.length === 0 && marker === 'ok') return 'completed';
          if (done === 0) return 'failed';
          return 'partial';
        }

   `needs_input`은 이 phase에서 **생산하지 않는다.** 슬롯만 계약에 두고 매핑은 wp7이 결정한다(001 미해결 가정).

7. 최종 반환에 필드를 더한다. 기존 키는 하나도 지우지 않는다:

        return {
          schema: 'browse/2',
          runId,
          status,
          ok: status === 'completed',
          requested: requested.length,
          completed: reconciled.filter((i) => i.status === 'completed').length,
          items: reconciled,
          unreturned: reconciled.filter((i) => i.status === 'unreturned').length,
          extraItems: extra.length ? extra : undefined,
          reconciledBy: positional ? 'position' : 'jobId',
          effects: [],
          complete: status === 'completed',
          truncated: false,
          ... (actionLog, contentVerified, timings, partial, leakedUrls, tabs, raw, breaker, pwd 그대로)
        };

   `partial` 배열에 `unreturned > 0`이면 `'unreturned'`, `extra.length`면 `'extra-items'`를 push한다.

## MODIFY src/host/browse/script.js

`JOB.items`의 각 항목이 이제 `jobId`를 갖는다. `one()`이 만드는 **모든** `items.push` 지점에 `jobId: item.jobId`를 추가한다.
현재 push 지점: inner-deadline `ESKIP`(237행 부근), `ETABBUDGET`(248행 부근), `EOPEN` catch, 정상 결과, breaker skip.
스크립트는 `jobId`를 **생성하지 않는다.** 없으면 없는 채로 둔다(호스트가 위치 대조로 떨어진다).

## TESTS

NEW `test/browse-envelope.test.js`:

- 요청 3개, final이 2개만 담아 오면 `status === 'partial'`, `ok === false`, 누락 항목이 `EUNRETURNED`로 존재하고 `items.length === 3`.
- 요청 2개가 같은 URL이고 완료 순서가 뒤집혀도 `items[0].jobId === 'j000'`이고 각 항목의 body가 자기 jobId 것과 맞는다.
- final items에 `jobId`가 없고 개수가 같으면 `reconciledBy === 'position'`이고 결과는 기존과 동일하다.
- host-kill이면 `status === 'indeterminate'`이고 모든 item이 `indeterminate`다.
- 전부 성공이면 `status === 'completed'`, `ok === true`, `completed === requested`.

MODIFY `test/browse-session.test.js`: 기존 단언은 그대로 두고, 성공 케이스에 `status`/`runId`/`requested` 존재만 추가한다.

## Verification (C)

- `node --test test/browse-envelope.test.js test/browse-session.test.js test/browse-script.test.js` — exit 0.
  이 명령은 대상 모듈을 직접 import한다(각 테스트 상단 import 확인).
- 푸시 후 `gh run list --branch codex/release-gates -L 1` + `gh run view <id> --json conclusion,headSha`로 정확한 head 확인.

## 범위 밖

capture 조인 변경(wp3), effects 채우기(wp4), envelope 문자열화 방지(wp7 F13), MCP 문서 갱신(wp7 F12).
