# 030 — wp4: 부작용 수명과 탭 회계

근거: [001](001_audit_findings.md) F3, F4 + architect A4. 전제: wp2의 `jobId`와 `effects` 슬롯.

## 결정

- `Promise.race`는 대기 종료지 취소가 아니다. 그러므로 **취소를 주장하지 않고 상태를 기록한다.**
- 기록은 스크립트가 하고 확정은 호스트가 한다: native await 직전 `started`, 직후 `confirmed`.
  `confirmed`가 없으면 `indeterminate`. 프로세스가 killed면 그 run의 모든 효과가 `indeterminate`.
- 자동 재시도는 지금도 없다. 계약 문서와 테스트로 그것을 고정한다(회귀 방지).
- close가 hang이면 닫힌 것으로 세지 않는다. cleanup이 pending open을 cap해도 이미 열린 탭은 닫기를 시도한다.

## MODIFY src/host/browse/actions-run.js

`__applyStep` 호출부(현재 227행 부근)를 효과 기록으로 감싼다. 변경 전:

        await __withTimeout(__applyStep(page, s, stepMs), stepMs, s.verb);
        rec.ok = true;

변경 후:

        const opId = (JOB.runId || 'run') + '-' + jobId + '-s' + String(idx).padStart(2, '0');
        rec.operationId = opId;
        __emit({ type: 'effect', effect: { operationId: opId, jobId, verb: s.verb, state: 'started', at: Date.now() } });
        try {
          await __withTimeout(__applyStep(page, s, stepMs), stepMs, s.verb);
          rec.ok = true;
          __emit({ type: 'effect', effect: { operationId: opId, state: 'confirmed', at: Date.now() } });
        } catch (e) { rec.code = __classify(e, s.verb); }

`__emit`은 이미 step 줄을 즉시 출력하는 경로를 재사용한다(줄 단위 JSON, stdout). 새 채널을 만들지 않는다.
**변경 없음:** 실패한 step을 다시 실행하는 코드는 추가하지 않는다. `stopOnError:false`는 다음 step으로 갈 뿐이다.

## MODIFY src/host/browse/session.js

1. `parseSteps` 옆에 `parseEffects`를 추가한다(같은 줄 파서, `o.type === 'effect'`).
2. 효과 확정:

        export function settleEffects(rows, { killed }) {
          const byId = new Map();
          for (const e of rows) {
            const cur = byId.get(e.operationId) || { operationId: e.operationId, jobId: e.jobId, verb: e.verb, state: 'started' };
            if (e.state === 'confirmed') cur.state = 'confirmed';
            byId.set(e.operationId, cur);
          }
          const out = [...byId.values()];
          if (killed) return out.map((e) => ({ ...e, state: 'indeterminate' }));
          return out.map((e) => (e.state === 'confirmed' ? e : { ...e, state: 'indeterminate' }));
        }

3. 반환의 `effects: []`를 `effects: settleEffects(parseEffects(stdout), { killed })`로 바꾼다.
   `effects.some(e => e.state === 'indeterminate')`면 `partial`에 `'effect-indeterminate'`를 push하고,
   `runStatus`는 그 경우 `completed`를 주지 않는다(최대 `partial`).

## MODIFY src/host/browse/script.js

1. close hang 회계(현재 494행):

        const r = await withCap(page.close(), 1500);
        if (r !== '__capped__') markClosed(rec); else leaked.push(rec.url);

   `catch`로 빠지는 throw 경로도 `leaked.push(rec.url)`를 한다. 닫히지 않은 탭은 반드시 이름이 남는다.
2. cleanup 예산(현재 511-515행): pending `allSettled`가 cap되면 **close 루프를 건너뛰지 말고** 이미 `opened[]`에 있는 탭에 대해
   남은 예산으로 close를 시도한다. cap된 in-flight open의 url은 `leaked`에 넣는다(요청은 됐고 결과를 모른다).

## PROBE (실측, 미해결 가정 해소)

`aside repl`로 로컬 fixture 페이지를 열고, 의도적으로 짧은 step timeout을 준 click이 실제로 커밋되는지 확인한다.
mac과 `ssh mini` 양쪽에서 같은 fixture로 돌리고 결과를 [001](001_audit_findings.md) 미해결 가정 절에 추가한다.
공개 사이트가 아니라 `test/fixtures/` 아래 정적 HTML을 `file://`가 아닌 로컬 http로 띄워 쓴다(스크립트가 file:// 를 거절한다).

## TESTS

NEW `test/browse-effect-state.test.js`:

- started만 있고 confirmed가 없으면 `effects[0].state === 'indeterminate'`이고 run status가 `completed`가 아니다.
- started + confirmed면 `confirmed`이고 성공 경로에 영향이 없다.
- killed면 confirmed가 있어도 전부 `indeterminate`.
- 실패한 step 뒤에 같은 step을 다시 실행하지 않는다(스텁 호출 횟수 1회).

MODIFY `test/browse-tabs.test.js`:

- close가 영원히 pending이면 `tabs.closed === 0`이고 `leakedUrls`에 그 url이 있다.
- pending open이 cap된 뒤에도 이미 열린 탭의 close가 시도된다.

## Verification (C)

- `node --test test/browse-effect-state.test.js test/browse-tabs.test.js test/browse-actions.test.js` — exit 0.
- 프로브 로그 두 건(mac, mini)을 001에 기록. typeof 확인만으로 PASS를 주장하지 않는다.
- hosted CI 5조합 success at head.
