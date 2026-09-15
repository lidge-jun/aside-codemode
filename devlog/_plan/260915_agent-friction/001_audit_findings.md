# 001 — 1차 감사 (둘 다 FAIL)

계획 9편을 서로 다른 렌즈로 돌렸다. 둘 다 소스와 실행으로 확인했고, 계획 8편을 다시 쓰게
만들었다. 아래는 계획을 바꾼 것들이다.

## 렌즈 A — 원인 진단과 수정안

1. **F2의 수정안이 Node에서 동작하지 않는다.** vm.Script에 importModuleDynamically를 달아도
   워커 execArgv가 비어 있으면 콜백은 호출되지 않고 ..._MISSING_FLAG가 난다. 그 강제는
   Node 20.10부터라 CI의 18과 22가 다르게 답한다. USE_MAIN_CONTEXT_DEFAULT_LOADER는 플래그
   없이 되지만 진짜 fs를 돌려주는 샌드박스 탈출이다. → 로더를 열지 않고 오류를 번역한다.
2. **정적 import는 다른 길로 죽는다.** 콜백과 무관한 SyntaxError다. await 없는 import()는
   조용히 성공하고 나중에 거절된다 — 번역이 닿지 않는 자리라 테스트로 기록한다.
3. **valid: 형태를 테스트가 본다.** 메시지를 새로 쓰지 말고 문장을 덧붙인다.
4. **text 추가는 바이트를 두 배로 만든다.** 게스트에서 참조가 같아도 JSON은 본문을 두 번
   쓴다(10k 기준 10029 → 20039). 예산이 모자라면 뒤 키가 잘려 res.text가 다시 빈다.
   → 필드를 늘리지 않고 이름을 바꾼다. 캐시 히트 경로도 같이 고친다.
5. **partial 객체는 사라진다.** normalizePartial이 문자열만 남기고 RPC 왕복에서 버려진다.
   → 이슈 본문이 제안한 scope.skippedSymlinks를 쓴다.
6. **rg는 링크를 조용히 건너뛴다.** --debug도 디렉터리 링크는 안 찍는다. 직접 열거가
   유일한 안전한 방법이라는 판단은 맞다. 다만 파일 링크도 건너뛰므로 둘 다 센다.

## 렌즈 B — 위험과 누락

1. **트리 파서의 자리.** 호스트가 잘린 tree를 다시 파싱하면 depth가 깨진다. 자르기 전,
   주입되는 요약기 안에서 해야 한다. 그 주입 경로에는 exec에 있는 길이 검사가 없다.
2. **크기 예산이 없었다.** nodes를 tree와 refs 위에 얹으면 envelope이 키를 잘라 낸다.
3. **묶음은 tree 모드에서만 된다.** interactive는 heading과 text를 버린다. 이름 추출이
   따옴표만 보는 것도 고쳐야 한다.
4. **enable 명령이 전역 설치에서 실행 불가.** bin은 codemode 하나뿐이다. 그리고 browseCaps는
   계정 루트가 아니라 기계 단위 사용자 설정에 산다 — 설치기의 소유 범위가 아니다.
5. **F1의 증상은 exec만이 아니다.** probe, doctor, attach, report.build도 같은 자리다.
6. **call-shapes를 plannedFiles에 넣어야 한다.** 템플릿만 더하면 설치가 그 파일을 모른다.
   그리고 첫 호출이 읽는 것은 문서만이 아니라 actions.describe와 GUEST_API_DOC이다.
7. **npm 검증이 doctor로는 안 된다.** doctor는 템플릿을 열지 않는다. tarball 안에서
   plannedFiles와 dry-run install을 돌려야 REPO_ROOT 해석이 증명된다. files의 bin/은 추적된
   4MB rg.exe를, scripts/는 개발용 스크립트를 넣는다.
8. **릴리즈 절차에서 push와 main CI 대기가 빠졌고, 태그는 병합 SHA여야 한다.** 기록 생성기의
   기본 출력이 v0.2.0 기록을 덮는다.

## 남긴 것

사용자가 실제로 쓴 모드는 interactive였다. 계획은 묶음이 tree 모드에서만 성립한다고
적었지만, 구현 때 interactive에서도 줄 수 있는 것이 있는지 다시 본다.
