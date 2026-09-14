# 010 — wp2: 결과 계약 코어 (runId / jobId / 요청 원장 / run status)

근거: [001](001_audit_findings.md) F1, F2, F13 + architect A1, A2, A3. 감사 1라운드 지적 4·10·11·12·20·22·25 반영본.
이 phase가 소유하는 것: `runId`, `jobId`, 요청 원장, `itemStatus`/`runStatus`, envelope 필드 추가, 원장 echo(`ledger`).
`operationId`와 `effects` 채우기는 [030](030_wp4_effect_lifecycle.md)이 소유한다. 이 문서는 `effects` 슬롯과 그 규칙만 정의한다.

## 결정

- **식별자는 session.js가 유일하게 발행한다(A1).** 근거: 이미 여기서 `artifactName`을 plan에 주입한다(`session.js:107`).
- **`jobId`는 요청 위치 키다.** 형식은 `j000`, `j001`. run 사이의 전역 고유성은 `runId`와 함께 볼 때만 성립한다.
  중복 URL을 구분하는 것이 목적이고, 그 목적에는 위치 키로 충분하다.
- **대조는 session.js에서 하고 키는 `jobId`다(A2).** 미반환은 `EUNRETURNED`.
- **envelope는 추가만 한다(A3).** `ok`는 `status === 'completed'`에서 유도한다. `cache.js`의 `SCHEMA_VERSION`은 건드리지 않는다.
- **하위호환 두 갈래.** (a) `jobId`가 없고 길이가 같으면 위치 대조, `reconciledBy: 'position'`.
  (b) `jobId`도 없고 길이도 다르면 대조 불가다. 요청 항목은 `EUNRETURNED`로 채우되 **반환된 항목을 버리지 않고**
  `extraItems`에 보존하고 `partial`에 `'unreconciled'`를 넣는다. 증거를 지우는 것이 더 나쁘다.

## MODIFY src/host/browse/session.js

1. import 추가: `import { randomUUID } from 'node:crypto';`
2. plan 조립(104-114행) **앞**에 원장을 만든다:

        const runId = 'run-' + randomUUID();
        const requested = job.urls.map((url, i) => ({ jobId: 'j' + String(i).padStart(3, '0'), url, index: i }));

3. 기존 `planFinal`(111-114행) **뒤**에 한 줄을 잇는다. 이름 옵션이 없어도 항상 붙는다:

        const planIds = (planFinal || job.urls.map((url) => ({ url, timeoutMs: job.timeoutMs, waitSelector: job.waitSelector, skip: false })))
          .map((p, i) => ({ ...p, jobId: requested[i].jobId }));
        const source = compile({ ...job, runId }, planIds);

   `runId`가 job에 실려야 생성 스크립트가 `JOB.runId`로 읽는다(030이 이 값을 쓴다).
4. 상태 함수 두 개를 모듈 최상단에 export한다. **코드 검사를 `ok`보다 먼저 한다**(host-kill이 성공으로 읽히지 않도록):

        export function itemStatus(item) {
          if (item.code === 'EHOSTKILL' || item.code === 'ENOMARKER') return 'indeterminate';
          if (item.code === 'EUNRETURNED') return 'unreturned';
          if (item.ok) return 'completed';
          if (item.code === 'ESKIP' || item.code === 'ETABBUDGET') return 'skipped';
          if (item.code === 'EBLOCKED') return 'blocked';
          return 'failed';
        }

        export function runStatus({ marker, items, leakedUrls, killed, effects = [] }) {
          if (killed || marker === null) return 'indeterminate';
          if (items.some((i) => i.status === 'indeterminate')) return 'indeterminate';
          if (effects.some((e) => e.state === 'indeterminate')) {
            return items.some((i) => i.status === 'completed') ? 'partial' : 'failed';
          }
          const done = items.filter((i) => i.status === 'completed').length;
          if (done === items.length && items.length > 0 && leakedUrls.length === 0 && marker === 'ok') return 'completed';
          if (done === 0) return 'failed';
          return 'partial';
        }

   `effects` 인자는 이 phase에서 항상 `[]`로 들어온다. 030이 실제 값을 넣는 순간 규칙이 자동으로 발효된다.
   `runStatus`는 **`item.ok`가 아니라 `item.status`만 본다.** `stopOnError:false`에서 step이 실패해도 `out.ok`가 참으로 남는
   경로(`script.js:404`)는 그래서 `completed`를 만들지 못한다. 그 경로의 항목은 `actionsOk:false`로 오고 030이 effect를 붙인다.
   `needs_input`은 이 phase가 **생산하지 않는다.** 반환 타입에만 존재하고 매핑은 [060](060_wp7_p1_batch.md)이 넣는다.
5. host-kill 반환(138-148행)을 원장 기반으로 바꾼다. `finalize()` 같은 새 함수를 만들지 않고 기존 return 리터럴을 그대로 고친다:

        const killItems = requested.map((r) => ({ jobId: r.jobId, url: r.url, ok: false,
          code: killed ? 'EHOSTKILL' : 'ENOMARKER', status: 'indeterminate' }));
        return {
          schema: 'browse/2', runId, status: 'indeterminate', ok: false,
          requested: requested.length, completed: 0, items: killItems, unreturned: 0,
          ledger: requested, reconciledBy: 'ledger', effects: [], complete: false, truncated: false,
          timings: { steps: [], totalMs }, actionLog: parseSteps(stdout),
          partial: [killed ? 'host-kill' : 'no-marker'], leakedUrls: job.urls.slice(),
          tabs: (final && final.tabs) || null, raw: { stdout, marker }, pwd: null,
        };

6. 정상 경로(151행 이후)에 대조를 넣는다:

        const byJob = new Map();
        for (const it of items) if (it && typeof it.jobId === 'string') byJob.set(it.jobId, it);
        const positional = byJob.size === 0 && items.length === requested.length;
        const unreconciled = byJob.size === 0 && items.length !== requested.length && items.length > 0;
        const reconciled = requested.map((r, i) => {
          const hit = byJob.get(r.jobId) || (positional ? items[i] : null);
          if (!hit) return { jobId: r.jobId, url: r.url, ok: false, code: 'EUNRETURNED', status: 'unreturned' };
          return { ...hit, jobId: r.jobId, url: hit.url || r.url, status: itemStatus(hit) };
        });
        const extra = items.filter((it) => !it || !it.jobId || !requested.some((r) => r.jobId === it.jobId));
        if (reconciled.some((i) => i.status === 'unreturned')) partial.push('unreturned');
        if (unreconciled) partial.push('unreconciled');
        else if (extra.length) partial.push('extra-items');

7. 최종 return에 필드를 더한다. 기존 키(`actionLog`, `contentVerified`, `timings`, `partial`, `leakedUrls`, `tabs`, `raw`, `breaker`, `pwd`)는 전부 유지한다:

        const status = runStatus({ marker, items: reconciled, leakedUrls, killed, effects: [] });
        return {
          schema: 'browse/2', runId, status, ok: status === 'completed',
          requested: requested.length,
          completed: reconciled.filter((i) => i.status === 'completed').length,
          unreturned: reconciled.filter((i) => i.status === 'unreturned').length,
          items: reconciled,
          ledger: requested,
          extraItems: extra.length ? extra : undefined,
          reconciledBy: positional ? 'position' : (unreconciled ? 'none' : 'jobId'),
          effects: [], complete: status === 'completed', truncated: false,
          /* 기존 키 전부 그대로 */
        };

   `ledger`는 capture가 자기 jobId를 다시 찍지 않게 하는 단일 발행 증거다([020](020_wp3_capture_provenance.md)이 소비한다).

## 필드 체인 (PLAN-FIELD-CHAIN-01)

| 값 | 생성 | 직렬화 | 역직렬화 | 소비자 |
|---|---|---|---|---|
| `runId` | session.js 원장 | `compile({...job, runId})` → JOB payload | script 안 `JOB.runId` | 030 operationId, envelope |
| `jobId` | session.js 원장 | planIds → `JOB.items[].jobId` | script `one(item)` | 모든 items.push, session 대조, capture 조인 |
| `status`(item) | session `itemStatus` | N/A (호스트 산출) | N/A | `runStatus`, capture, 게스트 |
| `ledger` | session 원장 | N/A | N/A | capture 이름 조인 |
| `effects` | 030 | 030 stdout 줄 | 030 `parseEffects` | `runStatus` (규칙은 여기) |

## MODIFY src/host/browse/script.js

`one()`이 만드는 **모든** push 지점에 `jobId: item.jobId`를 넣는다. 현재 지점(줄 번호는 착수 시 재확인):
237-238 `ESKIP`(inner-deadline), 248 `ETABBUDGET`, 271 부근 `EOPEN` catch, 301 `EBLOCKED`, 360 `EUNRENDERED`,
490 부근 일반 catch, 그리고 정상 성공 경로. 하나라도 빠지면 그 항목은 호스트에서 `EUNRETURNED`로 보인다.
스크립트는 `jobId`를 **생성하지 않는다.** 없으면 없는 채로 둔다.
`JOB.runId`를 payload에 싣는 것도 여기서 한다(compile의 JOB 직렬화에 필드 추가).

## TESTS

NEW `test/browse-envelope.test.js` — 분기마다 그것을 발동시키는 입력을 하나씩 둔다:

- 요청 3, final 2 → `status:'partial'`, 누락은 `EUNRETURNED`, `items.length === 3`.
- 중복 URL 2개, 완료 역순 → `items[0].jobId === 'j000'`이고 각 body가 자기 jobId의 것.
- `jobId` 없음 + 길이 같음 → `reconciledBy:'position'`.
- `jobId` 없음 + 길이 다름 → `reconciledBy:'none'`, `partial`에 `'unreconciled'`, `extraItems.length > 0`.
- 섞임(일부 항목만 jobId) → jobId 있는 것은 정확히 매칭되고 나머지는 `EUNRETURNED`.
- host-kill → 전 항목 `indeterminate`, `status:'indeterminate'`, `ok:false`.
- 전부 성공인데 `leakedUrls`만 있음 → `completed`가 아니라 `partial`.
- 전부 `ESKIP` → `failed`(완료 0건).
- `EBLOCKED` 항목 → `itemStatus === 'blocked'`이고 run은 `partial`(이 phase에서 `needs_input`이 아니다).
- 전부 성공 → `completed`, `ok:true`, `completed === requested`.

MODIFY `test/browse-session.test.js`: 기존 단언 유지 + `status`/`runId`/`requested`/`ledger` 존재.
MODIFY `test/browse-script.test.js`: 생성 스크립트 스냅샷이 `jobId`와 `runId`를 포함하도록 기대값 갱신.

## Verification (C)

- `node --test test/browse-envelope.test.js test/browse-session.test.js test/browse-script.test.js` — exit 0.
  세 파일 모두 이 phase가 MODIFY/NEW 하는 모듈을 상단에서 직접 import한다.
- `gh run list --branch codex/release-gates -L 1` → `gh run view <id> --json conclusion,headSha` — head 일치 확인.

## 우회 경로 (PLAN-BYPASS-NAMED-01)

- tier: E2 (런타임 계약). 집행 표면: `session.js`의 반환 경로.
- 알려진 우회: 게스트가 `items[]`를 직접 순회하며 `ok`만 본다. 그 경우 `status`는 무시된다.
- 잔여 위험: 구버전 게스트 코드가 `unreturned` 항목을 실패로 오해할 수 있다(문서로 알린다).
- 문구 완화: 없음. 최종 집행 계층: 없음(계약이지 샌드박스가 아니다).
