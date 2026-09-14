# 070 — wp8: 네이티브 배치 헬퍼 제품화

전제: wp3(출처), wp4(부작용 상태), wp7(읽기·출력)이 끝나 실행 계층이 정직해진 뒤. 그 전에 헬퍼를 얹으면 틀린 결과를 빨리 만들 뿐이다.

## 2026-09-14 실측 (mac 1.26.906.1630 / Windows MINI, Aside daemon 1.26.914.1644)

양 OS `aside repl`에서 같은 결과를 얻었다. 이 문서의 설계는 아래 사실 위에 선다.

- 전역: `fs path pwd openTab closeTab tabs getTabByTargetId snapshot annotatedScreenshot installPageScript page cua display sleep Buffer fetch` 등.
  `require` `process` `module`은 없다. `eval`과 `Function`은 **있다**.
- `passwordManager`는 CLI REPL 문맥에 **없다**(양 OS 모두 undefined). 금고는 앱 내부 에이전트 문맥의 기능이다.
- 최상위 `await`가 필요하다. 떠 있는 async IIFE는 출력 전에 `[ok]`가 찍히고 결과가 사라진다.
- `fs`는 루트 가드가 있다. 저장소 경로를 읽으면 `Error: Path escapes Project and session roots`.
  상대 경로는 호출자 cwd가 아니라 **세션 디렉터리**로 풀린다(`~/.aside/u/0/sessions/<id>/`).
- `aside repl` 한 번마다 세션 디렉터리가 새로 생긴다. 같은 세션 안에서 쓰기-읽기-eval은 양 OS에서 성공했다.
- REPL timeout 120초. 생성 소스는 Windows 명령행 때문에 30000자 제한이 이미 호스트에 있다(`session.js:119`).

결론: **CLI 경로에서 헬퍼는 디스크에서 로드되지 않는다.** 호스트가 소스에 인라인해야 한다.
앱 내부 에이전트 경로는 프로젝트 루트가 있으므로 설치 파일을 읽어 eval할 수 있다. 두 경로를 같은 파일 하나로 공급한다.

## NEW templates/native-helper/cm.js

크기 예산 **8KB 이하**. 이유는 미학이 아니라 30000자 한도를 job 소스와 나눠 쓰기 때문이다.
네이티브 API를 복제하지 않는다. callback 안에서는 호출자가 원래 전역을 그대로 쓴다.

        globalThis.cm = {
          version: '__CM_VERSION__',
          async mapLimit(items, limit, fn) { /* 제한 병렬, 입력 순서 보존 */ },
          async run({ items, limit = 2, deadlineMs = 90000, maxTabs = 8, onItem }) {
            // 반환: { runId, status, requested, completed, items: [{ jobId, status, value, error }],
            //         effects: [{ operationId, state }], tabs: { requested, closed, peak }, complete }
          },
          async openOwned(url) { /* maxTabs 한도, intent 시점 카운트 */ },
          async closeOwned(t) { /* 실패와 hang을 구분해 leaked로 남김 */ },
          checkpoint() { /* 재개 지점: 완료한 jobId 목록 */ }
        };

계약은 wp2와 **같다**. `status`는 5종, 항목 식별자는 `jobId`, 효과는 `operationId`.
CLI와 헬퍼가 다른 성공 정의를 갖지 않게 하는 것이 이 phase의 핵심이다.

## NEW src/host/browse/helper-bundle.js

- `helperSource()` — 템플릿을 읽고 `__CM_VERSION__`을 package.json 버전으로 치환, sha256을 함께 반환.
- `compile()`이 `JOB.helper === true`일 때만 앞에 붙인다. 붙인 해시를 결과 envelope의 `helper: { version, sha256 }`에 싣는다.
- 붙인 뒤 소스가 30000자를 넘으면 기존 `ESOURCETOOLONG`이 그대로 난다. 헬퍼 크기를 테스트로 고정한다.

## 앱 내부 경로 (설치본)

같은 `cm.js`를 프로젝트 루트 아래 `.aside/codemode/cm.js`로 설치하고, 스킬이 다음 두 줄을 안내한다:

        const src = await fs.readFile('.aside/codemode/cm.js', 'utf8');
        (0, eval)(src);

페이지에서 얻은 문자열을 평가하지 않는다. 원격에서 스크립트를 내려받는 로더도 만들지 않는다.
읽는 대상은 설치 manifest가 소유한 파일뿐이고, 버전과 해시를 확인한 뒤 평가한다.

## PROBE (합격 조건)

mac과 `ssh mini` 양쪽에서 같은 스크립트로:

1. 헬퍼 로딩과 버전 확인 — `cm.version`이 기대 버전과 같다.
2. 독립 URL 6개를 `limit: 2`, `maxTabs: 2`로 읽고 `tabs.peak <= 2`, `items.length === 6`, 각 항목이 자기 `jobId`의 결과를 갖는다.
3. 하나를 의도적으로 실패시키면 `status === 'partial'`이고 나머지 5개 결과가 보존된다.
4. deadline을 짧게 주면 미완료 항목이 `indeterminate`로 남고 자동 재시도가 없다.
5. 같은 실행 안에서 네이티브 호출(`snapshot`, `page.locator`)과 배치가 섞여 동작한다.

프로브 대상은 `test/fixtures/` 정적 페이지를 로컬 http로 띄운 것과 공개 예제 페이지로 한정한다. 사용자 계정 페이지는 쓰지 않는다.

## TESTS

- NEW `test/helper-bundle.test.js`: 버전 치환, sha256 일치, 8KB 상한, `helper:false`면 한 글자도 붙지 않음.
- NEW `test/helper-contract.test.js`: 헬퍼의 `run()` 결과 shape이 wp2 envelope와 같은 키·같은 status 집합을 쓴다(같은 검증 함수로 단언).

## Verification (C)

- `node --test test/helper-bundle.test.js test/helper-contract.test.js` — exit 0.
- 프로브 5건 × 2기기 로그를 이 문서 하단에 붙인다. `typeof`만 확인한 항목은 PASS로 세지 않는다.
- hosted CI 5조합 success at head.
