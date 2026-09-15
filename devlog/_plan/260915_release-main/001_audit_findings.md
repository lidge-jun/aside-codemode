# 001 — 1차 감사 (세 명, 전원 FAIL)

계획 여덟 편을 읽기 전용 감사자 셋에게 서로 다른 렌즈로 돌렸다. 셋 다 FAIL을 냈고
지적은 모두 소스 인용을 달고 있었다. 아래는 계획을 바꾼 것들이다.

## 로더 경로 렌즈

1. **AGENTS 블록 작성기가 둘이다.** `install-codemode.mjs`의 `fill()` 말고
   `src/register.js:257`의 `applyRegister()`도 같은 템플릿을 채운다. 후자는 body를 계정
   루프 밖에서 한 번 만들어 모든 루트에 같은 문자열을 쓴다. 계정마다 다른 `{{HELPER}}`를
   넣으려면 이쪽도 계정별로 채워야 한다.
2. **`cm.js` 주석에 절대 경로를 넣으면 안 된다.** 이 파일은 계정별 fill 대상이 아니라
   한 바이트·한 해시로 모든 설치본과 `compile()` 인라인에 공유된다. 주석은 계정에
   의존하지 않는 문장으로 두고, 실행 가능한 절대 경로는 fill되는 SKILL/AGENTS에만 넣는다.
3. **Windows 역슬래시가 파싱을 죽인다.** `C:\\Users\\super\\.aside\\u\\0\\codemode\\cm.js`를
   작은따옴표 JS에 그대로 넣으면 `Invalid Unicode escape sequence`다. fill은 POSIX
   슬래시나 `JSON.stringify`한 경로를 넣어야 한다.
4. **상수 소비처가 계획 표에 없었다.** `HELPER_LOAD_RELPATH`는 `scripts/probe-native-helper.mjs`,
   `test/helper-bundle.test.js`가 쓰고, 하드코딩 `../../codemode/cm.js`는 템플릿 넷과
   `eval/workloads/*.json` 셋에 있다. `test/readme-51x.test.js:80`은 플레이스홀더 집합을
   `{{CLI}} {{CWD_HINT}} {{NODE}}` 셋으로 고정한다.
5. **`cm.js`를 건드리면 `HELPER_VERSION`을 올려야 한다.** 안 올리면 1.0.0이 두 바이트를
   가리킨다.
6. **탈출 경로 계산이 틀렸다.** 계정 루트에서 `../../codemode/cm.js`는
   `~/.aside/codemode/cm.js`다. 010이 적은 `/Users/codemode/cm.js`는 cwd가 `~/.aside`일
   때만 나온다. 앱 REPL의 실제 기준은 사용자 보고이고 우리가 다시 재지 않았다.

## 게이트 설계 렌즈

1. **G3 합격선을 단위 테스트로 닫을 수 있게 줄였다.** 로드맵 원문은 "선택한 fixture의
   실제 화면/DOM 결과와 일치"다. 문자열 트리 단언으로는 닫지 않는다.
2. **iframe 조건이 실측과 반대다.** 260914_a11y-actions의 산 프로브에서
   `page.locator('f1e1').click()`이 자식 문서의 `#out`을 바꿨다. 프레임 API는 필요 없었다.
   거절은 다른 문서·다른 관찰의 ref 재사용에만 건다.
3. **이미지 칸을 거절 한 방으로 통과시킬 수 있었다.** 게다가 축소 자극을 만들 API가
   없다 — `screenshot.maxWidth`는 받고 무시하고, 호스트 resize는 ENOTSUP,
   `page.setViewportSize`는 absent다.
4. **CUA 자극이 원문과 다르다.** 원문의 위험은 공유 page를 두 호출이 동시에 바꾸는
   것이다. 다른 페이지 두 worker는 그 위험을 재현하지 않는다. `browse.probe()`의
   행렬에는 `cua`가 아예 없다.
5. **`browse.probe()`는 산 측정이 아니다.** 2026-09-14에 얼린 `CAPABILITY_MATRIX`를
   돌려준다. 이것을 "현재 표면"으로 쓰면 CLI가 바뀌어도 표가 그대로다.
6. **G5를 대리 지표로 채우려 했다.** 480실행은 스크립트가 경로를 고정한 CLI 워크로드다.
   모델이 스킬을 고른 세션이 아니다. G5 칸은 수동 세션 전까지 "돌리지 않음"을 유지한다.
7. **범위 이름이 과했다.** 이 루프가 닫는 것은 G3 네 fixture의 산 판정이지 R4 전체가
   아니다. 캡차·금고는 범위 밖이다.

## 배포와 승격 렌즈

1. **첫 upgrade가 구 artifact를 복구 불가능하게 만든다.** `applyWrites`가 디스크를 먼저
   덮고 `snapshotForRollback`이 그 덮인 디스크를 읽는다. `previous.content`가 구버전이
   아니라 새 바이트가 된다. 기존 단위 테스트는 install과 upgrade가 같은 바이트일 때만
   통과해서 이 결함을 못 잡았다. 이건 계획이 아니라 코드의 결함이다.
2. **라이브 계정에서 uninstall/rollback을 돌리면 안 된다.** uninstall은 소유 파일을 지우고
   manifest까지 지운다. previous는 그 manifest에만 있다. 설치기에는 backup/rename이 없다.
3. **rollback은 `inspectFile` 없이 previous를 전부 덮어쓴다.** 사용자가 이후 고친 파일도
   덮는다.
4. **현재 실계정은 `previous: null`이다.** 지금 rollback은 거절(exit 1)이다. 6단계는
   그 거절 말고는 아무것도 증명하지 않는다.
5. **repair가 previous를 갈아치운다.** rollback 증명 전에 repair를 두면 한 세대가 사라진다.
6. **파괴적 동사에 `--account`가 없었다.** 인자 없이 돌리면 `accounts.json`의
   `currentAccountId`를 따라간다.
7. **태그 SHA가 어긋난다.** `package.json` 0.1.0을 병합 뒤에 올리면 태그가 가리키는
   커밋의 버전이 틀리거나, CI를 통과한 SHA와 태그 SHA가 달라진다.
8. **CI는 `cancel-in-progress: true`다.** 마지막 SHA의 취소되지 않은 run만 센다.

## 이 감사가 바꾼 것

계획 여덟 편 중 여섯 편을 다시 썼다. 코드 결함 하나(스냅샷 순서)가 새로 드러나 wp3의
첫 작업이 됐고, 라이브 계정에서 하지 않을 일이 명시됐고, G5는 자동분으로 옮기지 않기로
했고, 버전 bump가 wp7의 첫 커밋이 됐다.
