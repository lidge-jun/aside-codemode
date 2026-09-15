# 030 — w4: 건너뛴 링크를 보이게 (이슈 #24, 감사 반영본)

## 확인된 사실

rg는 기본에서 링크를 건너뛰면서 **stdout에도 stderr에도 아무 말을 하지 않는다.**
--debug는 파일 링크만 찍고 #24의 디렉터리 링크는 디버그에도 없다. --follow로 두 번 돌리면
정책이 금지한 루트 밖 읽기가 다시 열린다. 그래서 엔트리를 직접 열거하는 것이 유일한 안전한
방법이라는 첫 계획의 판단은 맞다.

## 어디에 싣느냐가 중요하다

첫 계획은 partial에 객체를 넣겠다고 했다. 감사가 그게 사라지는 것을 보였다 —
src/search-result.js의 normalizePartial이 문자열만 남기고, 게스트 RPC를 왕복하면 객체는
버려지며 complete가 다시 true가 된다. 기존 partial은 rg stderr 문자열이고 테스트가
partial.join(' ')을 본다.

그래서 이슈 본문이 제안한 자리를 쓴다.

    scope.skippedSymlinks  { dirs, files, examples: [path...], capped: bool }
    complete               건너뛴 것이 있으면 false

scope는 restore가 키를 지우지 않는다.

## 거짓 경보를 만들지 않는다

열거는 검색이 실제로 쓰는 필터를 따른다 — excludeGlobs, hidden, ignore 정책. 그러지 않으면
링크 숲(pnpm 같은)에서 매번 complete:false가 나와 신호가 죽는다. 깊이와 개수에 상한을 두고,
상한에 걸리면 capped:true로 적는다. 파일 링크와 디렉터리 링크를 따로 센다.

## 반례

1. 링크 디렉터리를 담은 임시 트리에서 complete:false, scope.skippedSymlinks.dirs >= 1.
2. 링크가 없는 트리에서는 complete:true 그대로.
3. 게스트 RPC를 왕복해도 그 신호가 살아남는다(직렬화 → restore → 다시 읽기).
4. excludeGlobs에 걸리는 링크는 세지 않는다.
5. 기존 partial 계약(문자열, Permission denied)이 깨지지 않는다.
