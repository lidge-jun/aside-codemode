# 000 — 에이전트가 실제로 부딪힌 것들

기준은 `origin/dev` 67f63d2, 방금 나간 v0.2.0 직후다. 사용자가 이 릴리즈를 직접 써 보면서
걸린 곳 다섯과 이슈 #24를 고치고, 안내를 정리하고, npm 배포 가능 여부를 판정한 뒤 0.3.0을
낸다.

속도와 안정성은 문제가 아니었다. 보고는 "인터페이스 규칙만 파악하고 나면 300ms로 완벽하게
돌았고 탭이 죽거나 소켓이 끊긴 적이 없다"였다. 걸린 것은 전부 **첫 호출에서 틀리게 만드는
모양**이다. 그래서 이 루프의 성격은 기능 추가가 아니라 계약과 오류 메시지다.

## 여섯 건과 그 원인

| # | 증상 | 원인 (소스에서 확인) |
|---|---|---|
| F1 | `browse.probe()`가 enabled:false. 사용자가 ~/.config/codemode/config.json을 손으로 고쳐야 했다 | 기본이 opt-in이고 켜는 길이 문서에만 있다. 거절 메시지가 그 길을 알려주지 않는다 |
| F2 | 게스트에서 동적 임포트 → ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING | `src/execution-worker.js:79`가 vm.Script를 importModuleDynamically 없이 만든다. Node가 자기 말로 죽는다 |
| F3 | unknown option(s) "pattern", search.files: path is required | search.files는 pattern(부분 문자열)+glob, search.content는 query다. 오류가 유효한 이름을 나열하지만 **지금 준 이름에 대한 대응**을 말하지 않는다 |
| F4 | readText({url}) 거절, 결과에 text가 없고 markdown에만 본문 | `src/host/browse/read-text.js:82`가 첫 인자를 문자열로만 받는다. 반환 키는 markdown/chars뿐 |
| F5 | 접근성 트리가 통문자열이라 묶음을 정규식 상태 머신으로 뽑아야 했다 | attach가 tree 문자열과 평탄한 ref 맵만 준다. 계층이 들여쓰기로만 남는다 |
| #24 | followSymlinks 거부로 링크를 건너뛰는데 complete:true | 거절은 정책상 맞지만 건너뛴 사실이 결과 어디에도 없다. 37개 중 35개가 링크인 디렉터리에서 2개만 나오고 신호가 없다 |

## 순서

    w1  이 문서들            코드 변경 없음
    w2  게스트 샌드박스       동적 임포트 거절을 설명이 있는 오류로
    w3  호출 모양            search 인자 제안, readText 인자와 결과 필드
    w4  #24                 건너뛴 링크를 결과에 드러내기
    w5  계층                 트리를 구조로도 돌려주기
    w6  활성화               browse를 켜는 한 번의 길
    w7  안내                 AGENTS 블록·스킬·references
    w8  npm                  배포 가능 여부 판정
    w9  릴리즈               0.3.0, CI, dev, main, 태그, release

w7이 뒤인 이유는 안내가 앞의 다섯을 설명해야 하기 때문이다. w8은 독립이지만 w9 앞에는
끝나야 한다.

## 완료 판정

열 개 criteria가 등록돼 있다. 각각은 "고쳤다"가 아니라 **먼저 실패하는 반례가 있고 그
반례가 통과로 바뀌었다**로 센다. F1의 기본값 판단은 근거를 적는다.

## 범위 밖

npm publish 실행 자체(판정과 준비까지), 캡차·금고, G5 수동 세션. v0.2.0에서 미실행으로
남긴 것들은 그대로 미실행이다.
