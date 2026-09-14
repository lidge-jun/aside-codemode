# 030 — wp4: 부작용 수명과 탭 회계

근거: [001](001_audit_findings.md) F3, F4 + architect A4. 감사 1라운드 지적 5·6·19 반영본.
전제: [010](010_wp2_result_contract.md)이 `JOB.runId`를 payload에 싣고 `runStatus`가 `effects`를 인자로 받는다.

## 결정

- `Promise.race`는 취소가 아니다. 취소를 주장하지 않고 **상태를 기록한다.**
- `operationId`는 호스트가 발행한 두 값(`runId`, `jobId`)과 step 인덱스로 **합성**한다. 스크립트가 새 식별자를 만들지 않는다.
- 기록은 기존 step 로그와 같은 채널(`console.log`의 한 줄 JSON)을 쓴다. 새 전송 수단을 만들지 않는다.
- 부작용이 없는 verb(`__INERT`)는 효과를 남기지 않는다. 대기는 부작용이 아니다.
- 자동 재시도는 지금도 없다. 이 phase는 그것을 테스트로 고정한다.
- close가 hang이면 `markClosed`를 부르지 않는다. `leakedUrls`가 `opened.filter(o => !o.closed)`에서 나오므로(script.js:531)
  그것만으로 누수가 이름과 함께 보고된다.

## MODIFY src/host/browse/actions-run.js

기존 try/catch(227-236행)를 **감싸는** 형태다. `ESTEPTIMEOUT` → `EDEADLINE` 재분류와 `cfg.onStep`은 그대로 둔다.

변경 전:

        try {
          await __withTimeout(__applyStep(page, s, stepMs), stepMs, s.verb);
          rec.ok = true;
        } catch (e) {
          rec.error = String((e && e.message) || e).slice(0, 300);
          rec.code = __classify(e, s.verb);
          if (rec.code === 'ESTEPTIMEOUT' && !ownTimeout) {
            rec.code = 'EDEADLINE';
            rec.error = 'the action budget ran out while this step was running';
          }
        }

변경 후:

        var effectful = !__INERT[s.verb];
        if (effectful) rec.operationId = String(cfg.runId || 'run') + '-' + String(cfg.jobId || 'j') + '-s' + String(rec.i);
        if (effectful && cfg.onEffect) cfg.onEffect(rec, 'started');
        try {
          await __withTimeout(__applyStep(page, s, stepMs), stepMs, s.verb);
          rec.ok = true;
          if (effectful && cfg.onEffect) cfg.onEffect(rec, 'confirmed');
        } catch (e) {
          rec.error = String((e && e.message) || e).slice(0, 300);
          rec.code = __classify(e, s.verb);
          if (rec.code === 'ESTEPTIMEOUT' && !ownTimeout) {
            rec.code = 'EDEADLINE';
            rec.error = 'the action budget ran out while this step was running';
          }
        }

`catch`에서 `onEffect(rec, 'failed')`를 부르지 않는다. 실패한 await는 **커밋 여부를 모른다**는 것이 이 설계의 요점이고,
확정은 호스트가 `confirmed`의 부재로 내린다.

## MODIFY src/host/browse/script.js

1. `runActions` cfg(368-392행)에 호스트 값과 효과 콜백을 넣는다. `onStep`은 그대로 둔다:

        runId: JOB.runId,
        jobId: item.jobId,
        onEffect: function (rec, state) {
          try {
            console.log(JSON.stringify({ type: 'effect', effect: {
              operationId: rec.operationId, runId: JOB.runId, jobId: item.jobId,
              i: rec.i, verb: rec.verb, state: state, at: Date.now() } }));
          } catch (e) {}
        },

2. close hang 회계(494행):

        try { const r = await withCap(page.close(), 1500); if (r !== '__capped__') markClosed(rec); } catch (_) {}

   throw 경로는 이미 `markClosed`를 건너뛰므로 그대로 둔다. 두 경우 모두 `opened[].closed`가 false로 남아 leaked로 보고된다.
3. cleanup(511-529행)에서 pending이 cap돼도 이미 열린 탭을 포기하지 않는다:

        const settled = await withCap(Promise.allSettled(pending.map((x) => x.pr)), left());
        if (settled === '__capped__') {
          // 결과를 모르는 open 요청은 이름을 남긴다. opened[]에 없으므로 leakedUrls가 놓친다.
          for (const p of pending) if (!opened.some((o) => o.url === p.url)) opened.push({ url: p.url, page: null, closed: false });
        }
        const targets = settled === '__capped__' ? opened.filter((o) => o.page && !o.closed) : /* 기존 settled 경로 */;

   즉 close 루프는 `settled` 성공 여부와 무관하게 `opened[]`를 대상으로 한 번 돈다.

## MODIFY src/host/browse/session.js

1. `parseSteps` 옆에 같은 모양의 파서를 둔다:

        export function parseEffects(stdout) {
          const rows = [];
          for (const line of stripAnsi(stdout).split(/\r?\n/)) {
            const t = line.trim();
            if (!t.startsWith('{')) continue;
            try { const o = JSON.parse(t); if (o && o.type === 'effect' && o.effect) rows.push(o.effect); } catch (_) {}
          }
          return rows;
        }

        export function settleEffects(rows, { killed }) {
          const byId = new Map();
          for (const e of rows) {
            const cur = byId.get(e.operationId) || { operationId: e.operationId, jobId: e.jobId, verb: e.verb, i: e.i, state: 'started' };
            if (e.state === 'confirmed') cur.state = 'confirmed';
            byId.set(e.operationId, cur);
          }
          const out = [...byId.values()];
          return out.map((e) => (killed || e.state !== 'confirmed' ? { ...e, state: killed ? 'indeterminate' : (e.state === 'confirmed' ? 'confirmed' : 'indeterminate') } : e));
        }

2. 정상 경로와 host-kill 경로 모두 `effects`를 채우고 `runStatus`에 넘긴다:

        const effects = settleEffects(parseEffects(stdout), { killed });
        if (effects.some((e) => e.state === 'indeterminate')) partial.push('effect-indeterminate');
        const status = runStatus({ marker, items: reconciled, leakedUrls, killed, effects });

   host-kill 경로도 stdout에서 효과를 복구한다. 스크립트가 final을 못 찍었어도 step/effect 줄은 이미 나갔다.

## PROBE (미해결 가정 해소)

`test/fixtures/slow-click/`에 정적 페이지를 두고 로컬 http로 띄운 뒤(스크립트가 `file://`를 거절한다),
클릭 핸들러가 300ms 뒤 DOM에 표식을 남기게 한다. step timeout을 50ms로 주고 다음을 측정한다:

- 효과가 `indeterminate`로 기록되는가.
- 그 뒤 새 관찰에서 표식이 실제로 남았는가(= timeout이 취소가 아님을 실측).

mac과 `ssh mini` 각각 1회. 결과를 001의 미해결 가정 절에 추가한다.

## TESTS

NEW `test/browse-effect-state.test.js`:

- started만 있고 confirmed가 없으면 `effects[0].state === 'indeterminate'`이고 run status가 `completed`가 아니다.
- started + confirmed면 `confirmed`이고 성공 경로에 영향이 없다.
- killed면 confirmed가 있어도 전부 `indeterminate`.
- `__INERT` verb(예: waitFor)는 효과 줄을 만들지 않는다.
- 실패한 step 뒤 같은 step을 다시 실행하지 않는다(스텁 호출 1회).
- `stopOnError:false`에서 한 step이 실패해도 run status가 `completed`가 되지 않는다.

MODIFY `test/browse-tabs.test.js`:

- close가 영원히 pending이면 `tabs.closed === 0`, `leakedUrls`에 그 url, **그리고 스텁의 실제 열린 탭 수가 1로 남는다**
  (카운터만 맞고 탭이 남는 상황을 잡기 위해 스텁이 보유한 열린 페이지 수를 직접 센다).
- pending open이 cap돼도 이미 열린 탭의 close가 시도되고, cap된 url이 `leakedUrls`에 들어간다.

## Verification (C)

- `node --test test/browse-effect-state.test.js test/browse-tabs.test.js test/browse-actions.test.js test/browse-envelope.test.js` — exit 0.
- 프로브 2건(mac, mini) 기록.
- hosted CI 5조합 success at head.
