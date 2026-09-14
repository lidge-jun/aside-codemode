# 070 — wp8: 네이티브 배치 헬퍼 제품화

감사 1라운드 지적 9 반영본(본문 포함). 전제: wp3(출처), wp4(부작용 상태), wp7(읽기·출력).

## 2026-09-14 실측 (mac 1.26.906.1630 / Windows MINI, Aside daemon 1.26.914.1644)

- 전역: `fs path pwd openTab closeTab tabs getTabByTargetId snapshot annotatedScreenshot installPageScript page cua display sleep Buffer fetch`.
  `require`/`process`/`module` 없음. `eval`과 `Function`은 **있음**. `passwordManager`는 CLI REPL에 **없음**(양 OS).
- 최상위 `await` 필요. 떠 있는 async IIFE는 출력 전에 `[ok]`가 찍힌다.
- `fs`는 루트 가드: 저장소 경로 읽기는 `Error: Path escapes Project and session roots`.
  상대 경로는 호출자 cwd가 아니라 세션 디렉터리(`~/.aside/u/0/sessions/<id>/`)로 풀린다.
- `aside repl` 호출마다 세션 디렉터리가 새로 생긴다. 같은 세션 안의 write → read → eval은 양 OS에서 성공.
- REPL timeout 120초. 생성 소스는 30000자 제한(`session.js:119`).

**결론:** CLI 경로의 헬퍼는 디스크에서 로드할 수 없다. 호스트가 소스에 인라인한다.
앱 내부 에이전트 경로는 프로젝트 루트가 있으므로 설치 파일을 읽어 eval할 수 있다.

## NEW templates/native-helper/cm.js (본문)

`templates/native-helper/`는 저장소에 아직 없다. 이 phase가 만든다. `test/fixtures/batch/`와 `test/fixtures/serve.mjs`도 NEW다.

크기 예산 8KB. 네이티브 API를 복제하지 않는다. 결과 계약은 wp2와 **같은 키**를 쓴다.

        globalThis.cm = (function () {
          var VERSION = '__CM_VERSION__';
          function jid(i) { return 'j' + String(i).padStart(3, '0'); }
          async function mapLimit(items, limit, fn) {
            var out = new Array(items.length), q = items.map(function (v, i) { return [v, i]; });
            var workers = [];
            for (var w = 0; w < Math.max(1, limit); w++) {
              workers.push((async function () {
                while (q.length) { var e = q.shift(); out[e[1]] = await fn(e[0], e[1]); }
              })());
            }
            await Promise.all(workers);
            return out;
          }
          async function run(cfg) {
            var items = cfg.items || [], limit = cfg.limit || 2, maxTabs = cfg.maxTabs || 8;
            var runId = 'cm-' + Date.now().toString(36);
            var deadlineAt = Date.now() + (cfg.deadlineMs || 90000);
            var requested = 0, closed = 0, peak = 0, leaked = [], effects = [], done = [];
            function owned() { return requested - closed; }
            var results = await mapLimit(items, limit, async function (item, i) {
              var jobId = jid(i);
              if (Date.now() > deadlineAt) return { jobId: jobId, status: 'indeterminate', code: 'EDEADLINE' };
              for (var k = 0; k < 20 && owned() >= maxTabs && Date.now() < deadlineAt; k++) await sleep(50);
              if (owned() >= maxTabs) return { jobId: jobId, status: 'skipped', code: 'ETABBUDGET' };
              var opId = runId + '-' + jobId;
              effects.push({ operationId: opId, jobId: jobId, state: 'started' });
              requested += 1; if (owned() > peak) peak = owned();
              var tab = null;
              try {
                try { tab = await openTab(item.url); }
                catch (openErr) {
                  // 요청은 세었지만 탭이 되지 못했다. 환불하지 않으면 owned()가 내려가지 않아
                  // 뒤 항목이 전부 ETABBUDGET으로 죽는다(script.js:262,272가 같은 이유로 환불한다).
                  requested -= 1;
                  return { jobId: jobId, status: 'failed', code: 'EOPEN',
                    error: String(openErr && openErr.message || openErr).slice(0, 300) };
                }
                var value = await cfg.onItem(tab, item, jobId);
                effects.push({ operationId: opId, jobId: jobId, state: 'confirmed' });
                done.push(jobId);
                return { jobId: jobId, status: 'completed', value: value };
              } catch (e) {
                return { jobId: jobId, status: 'failed', error: String(e && e.message || e).slice(0, 300) };
              } finally {
                if (tab) {
                  // close()의 reject를 삼킨다. finally에서 throw하면 이 항목의 결과 자체가 사라진다.
                  var closer = Promise.resolve().then(function () { return tab.close(); })
                    .then(function () { return 'closed'; }, function () { return 'failed'; });
                  var r = await Promise.race([closer, sleep(1500).then(function () { return 'capped'; })]);
                  if (r === 'closed') closed += 1; else leaked.push({ jobId: jobId, url: item.url, why: r });
                }
              }
            });
            var settled = settle(effects);
            var completed = results.filter(function (r) { return r.status === 'completed'; }).length;
            var status = completed === results.length && leaked.length === 0 && !settled.some(function (e) { return e.state === 'indeterminate'; })
              ? 'completed' : (completed === 0 ? 'failed' : 'partial');
            return { schema: 'cm/1', version: VERSION, runId: runId, status: status,
              requested: results.length, completed: completed, items: results, effects: settled,
              tabs: { requested: requested, closed: closed, peak: peak, leaked: leaked.length },
              checkpoint: done, complete: status === 'completed' };
          }
          function settle(rows) {
            var by = {};
            rows.forEach(function (e) {
              var cur = by[e.operationId] || { operationId: e.operationId, jobId: e.jobId, state: 'started' };
              if (e.state === 'confirmed') cur.state = 'confirmed';
              by[e.operationId] = cur;
            });
            return Object.keys(by).map(function (k) {
              return by[k].state === 'confirmed' ? by[k] : { operationId: k, jobId: by[k].jobId, state: 'indeterminate' };
            });
          }
          return { version: VERSION, mapLimit: mapLimit, run: run };
        })();

callback(`onItem`)은 원래 전역(`snapshot`, `page.locator`, `cua`, `display`)을 그대로 쓴다. 헬퍼는 그것을 감싸지 않는다.

## NEW src/host/browse/helper-bundle.js

        import { readFile } from 'node:fs/promises';
        import { createHash } from 'node:crypto';
        export async function helperSource(version) {
          const raw = await readFile(new URL('../../../templates/native-helper/cm.js', import.meta.url), 'utf8');
          const src = raw.replace('__CM_VERSION__', version);
          return { src, sha256: createHash('sha256').update(src).digest('hex'), bytes: Buffer.byteLength(src) };
        }

`compile()`은 `job.helper === true`일 때만 `src`를 앞에 붙이고, 결과 envelope에 `helper: { version, sha256 }`을 싣는다.
붙인 뒤 30000자를 넘으면 기존 `ESOURCETOOLONG`이 난다.

## 앱 내부 경로 — 읽을 수 있는 위치는 프로젝트 루트뿐이다

측정된 가드가 설치 위치를 결정한다. REPL의 `fs`는 **Project와 session 루트 밖을 거절**한다.
그래서 `~/.aside/u/<id>/codemode/cm.js`(계정 루트)는 설치기가 쓰는 위치일 수는 있어도,
에이전트 REPL이 읽을 수 있다는 보장이 없다. 앱 내부 로드용 사본은 **프로젝트 루트 아래**에 둔다:

        <projectRoot>/.aside/codemode/cm.js      (앱 내부 REPL이 읽는 사본)
        <accountRoot>/codemode/cm.js             (설치기 원본과 해시 기준)

두 파일은 같은 바이트이고 [080](080_wp9_packaging.md)의 manifest가 둘 다 소유한다.
프로젝트 사본은 `--project <path>`를 준 설치에서만 만든다. 스킬이 안내하는 두 줄:

        const src = await fs.readFile('.aside/codemode/cm.js', 'utf8');
        (0, eval)(src);

**착수 전 확인할 것:** 계정 루트가 REPL에서 읽히는지 실제로 프로브한다. 읽힌다면 사본을 하나로 줄인다.
페이지에서 얻은 문자열을 평가하지 않는다. 원격 스크립트를 내려받는 로더도 만들지 않는다.

## PROBE (합격 조건, mac + ssh mini 각 1회)

1. `cm.version`이 기대 버전과 같다.
2. `test/fixtures/batch/`의 정적 페이지 6개를 로컬 http로 띄우고 `limit:2, maxTabs:2` → `tabs.peak <= 2`, `items.length === 6`, 각 항목이 자기 `jobId`의 값.
3. 하나를 404로 만들면 `status === 'partial'`이고 나머지 5개가 보존된다.
4. `deadlineMs`를 짧게 주면 미완료가 `indeterminate`로 남고 재시도가 없다.
5. 같은 실행 안에서 `snapshot(page)` 호출과 배치가 섞여 동작한다.

## TESTS

- NEW `test/helper-bundle.test.js`: 버전 치환, sha256 일치, 8KB 상한, `helper:false`면 0바이트 추가.
- NEW `test/helper-contract.test.js`: `cm.run()` 결과가 wp2 envelope와 같은 키·같은 status 집합을 쓴다(같은 검증 함수로 단언).

## Verification (C)

- `node --test test/helper-bundle.test.js test/helper-contract.test.js` — exit 0.
- 프로브 5건 × 2기기 로그를 이 문서 하단에 추가. `typeof`만 확인한 항목은 PASS로 세지 않는다.
- hosted CI 5조합 success at head.
