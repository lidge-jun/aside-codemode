# 030 — wp4: 부작용 수명과 탭 회계

근거: [001](001_audit_findings.md) F3, F4 + architect A4. 감사 1라운드 지적 5·6·19 반영본.
전제: [010](010_wp2_result_contract.md)이 `JOB.runId`를 payload에 싣고 `runStatus`가 `effects`를 인자로 받는다.

## 결정

- `Promise.race`는 취소가 아니다. 취소를 주장하지 않고 **상태를 기록한다.**
- `operationId`는 호스트가 발행한 두 값(`runId`, `jobId`)과 step 인덱스로 **합성**한다. 스크립트가 새 식별자를 만들지 않는다.
- 기록은 기존 step 로그와 같은 채널(`console.log`의 한 줄 JSON)을 쓴다. 새 전송 수단을 만들지 않는다.
- 효과 면제 집합은 `__INERT`와 **다른 집합**이다. `__INERT`는 `{ sleepMs: 1 }` 하나뿐이고(`actions-run.js:57`),
  `waitFor`/`waitForLoadState`/`scroll`은 트리를 더럽힐 수 있다는 이유로 의도적으로 inert가 아니다.
  그 집합을 효과 판정에 재사용하면 dirty-tree 가드가 흔들린다. 그래서 새 상수를 둔다:
  `var __NOEFFECT = { sleepMs: 1, waitFor: 1, waitForLoadState: 1 };`
  `scroll`/`hover`/`focus`는 페이지 상태를 바꿀 수 있으므로 효과를 남긴다.
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

        var effectful = !__NOEFFECT[s.verb];
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

        // pending 항목은 { url, jobId, pr }이다(one()의 pending.push에 jobId를 추가한다).
        // 중복 URL을 url로 식별하면 두 번째 in-flight open이 사라지므로 키는 jobId다.
        const settled = await withCap(Promise.allSettled(pending.map((x) => x.pr)), left());
        if (settled !== '__capped__') {
          for (let i = 0; i < settled.length; i++) {
            const s = settled[i];
            if (s.status !== 'fulfilled' || !s.value) continue;   // reject는 EOPEN이고 탭이 없다
            const page = s.value;
            if (!opened.some((o) => o.page === page)) {
              opened.push({ targetId: page.targetId, url: pending[i].url, jobId: pending[i].jobId, page, closed: false });
            }
          }
        } else {
          // 결과를 모르는 open만 남긴다. 이미 reject된 요청을 누수로 세면 가짜 누수가 된다.
          for (const p of pending) {
            if (p.settled === 'rejected') continue;              // one()의 open catch가 표시한다
            if (!opened.some((o) => o.jobId === p.jobId)) {
              opened.push({ url: p.url, jobId: p.jobId, page: null, closed: false });
            }
          }
        }
        const closes = [];
        for (const rec of opened) {
          if (rec.closed || !rec.page) continue;                 // 핸들이 없으면 닫을 수 없다. leaked로 남는다
          const r = rec;
          closes.push(Promise.resolve().then(() => r.page.close()).then(() => markClosed(r), () => {}));
        }
        await withCap(Promise.allSettled(closes), left());

   close 루프는 `settled`가 cap됐든 아니든 `opened[]`를 대상으로 한 번 돈다.
   핸들이 없는 레코드(`page: null`)는 닫을 수 없으므로 `closed:false`로 남아 `leakedUrls`(531행)에 이름이 실린다.
   `one()` 쪽에도 세 가지 변경이 같이 들어간다. 이것이 없으면 위 cleanup은 동작하지 않는다:

        // 1) pending 레코드를 지역 변수로 잡고 jobId를 싣는다. pending.at(-1)로 찾으면 worker가 겹칠 때 다른 요청을 표시한다.
        const pend = { url: item.url, jobId: item.jobId, pr, settled: null };
        pending.push(pend);
        // 2) open이 reject되면 그 레코드에 직접 표시한다(script.js:269 부근 catch).
        pr.then(() => { pend.settled = 'fulfilled'; }, () => { pend.settled = 'rejected'; });
        // 3) opened 레코드에도 jobId를 넣는다(script.js:277-278). 지금은 { targetId, url, page, closed }뿐이라
        //    cleanup의 o.jobId 비교가 항상 undefined가 되고, 이미 열린 탭이 cap마다 복제로 들어가 가짜 누수가 된다.
        const rec = { targetId: page && page.targetId, url: item.url, jobId: item.jobId, page, closed: false };

   `opened[]`와 `pending[]`의 식별자가 같아야 중복 URL에서 두 배열이 같은 요청을 가리킨다.

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

## 범위 밖으로 명시하는 것

## 착수 후 바뀐 결정 (구현이 문서를 이긴 곳)

- **줄 번호는 낡았다.** 이 문서의 `script.js:368-392/494/511-529/531`은 wp2/wp3가 줄을 옮기기 전 기준이다.
  구현은 현재 트리 기준으로 같은 지점을 고쳤다.
- **hang한 close는 cleanup이 다시 시도하지 않는다.** 문서 스니펫은 재시도하게 돼 있었지만,
  `withCap`은 close를 취소하지 않으므로 두 번째 대기는 같은 hang을 남은 예산만큼 다시 기다린다.
  그래서 hang에는 `rec.capped`를 세워 건너뛰고 누수로 보고한다. **throw한 close는 표시하지 않는다** —
  거절은 두 번째 시도로 닫힐 수 있으므로 cleanup이 한 번 더 시도한다.
- **`operationId`에 `opSeq`가 붙는다.** `jobId`가 없는 compile 경로(plan 없이 호출)에서 모든 항목의 step 0이
  같은 id를 만들어 호스트가 서로 다른 효과를 하나로 접었다. 위치를 fallback 소유자로 쓴다.
- **marker만 없는 종료는 kill로 접지 않는다.** `settleEffects(..., { killed })`에 실제 `killed`를 넘긴다.
  run status는 어차피 `indeterminate`이지만, 실제로 confirmed를 본 효과까지 unknown으로 되돌릴 이유는 없다.
- **대기 루프 뒤 deadline을 다시 본다.** `one()` 맨 위의 가드는 탭 예산 대기 전에 실행되므로,
  줄을 서 있던 워커가 inner deadline을 한참 넘겨 탭을 열 수 있었다.

screenshot/pdf의 `fs.writeFile`은 `type:effect`를 남기지 않는다. 웹 상태를 바꾸는 동작이 아니라 세션 디렉터리 안의
로컬 쓰기이고, 같은 `jobId`에 대해 같은 이름으로만 쓰이므로 재실행이 서로를 겹쳐 쓰지 않는다.
A4의 수명 추적은 **웹 mutation**에 한정한다. 아티팩트 쓰기 실패는 기존 `EARTIFACT` 경로로 보고한다.

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
- `__NOEFFECT` verb(`sleepMs`, `waitFor`, `waitForLoadState`)는 효과 줄을 만들지 않는다.
- `scroll`은 효과 줄을 만든다(면제 집합에 넣지 않는다).
- 중복 URL 두 건의 open이 모두 cap되면 `leakedUrls`에 **두 건**이 실린다(jobId 키 고정).
- `EOPEN`으로 reject된 요청은 `leakedUrls`에 실리지 않는다(가짜 누수 금지).
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
