# 020 — w3: 첫 호출에서 틀리게 만드는 모양

## search의 이름

계약은 이렇다. search.files는 경로를 거르는 pattern(부분 문자열)과 glob을 받고,
search.content는 내용을 찾는 query를 받는다. 둘 다 path가 필수다.

사용자는 search.content에 pattern을 줘서 unknown option을 받았고, 그다음 path 없이 호출해
path is required를 받았다. 두 오류 모두 **맞는 말이지만 다음에 무엇을 쓸지 말하지 않는다.**

고칠 것: `src/search-schema.js`의 unknown-option 오류가 **그 함수에서의 대응**을 제안한다.

    search.content: unknown option "pattern". search.content matches file CONTENT with
    query; pattern is search.files' substring filter on paths.

path 누락도 같은 방식으로 — 무엇을 넣어야 하는지(설정된 root 중 하나, 또는 --cwd로 푼 절대
경로)를 한 줄로 말한다.

## readText의 인자와 결과

문자열만 받는다. 객체를 주면 "readText requires a url string"이다. 이웃 API 대부분이 객체를
받으므로 이 하나만 다른 것이 함정이다. 고칠 것: { url, ...opts } 형태도 받는다. 문자열 첫
인자는 그대로 둔다.

결과는 markdown과 chars만 있고 text가 없다. 사용자는 res.text를 찍고 빈 값을 봤다.
고칠 것: 반환에 text를 같은 내용으로 싣되 **같은 문자열 참조**를 써서 바이트가 두 배가 되지
않게 하고, 어느 쪽이 정식인지 시그니처와 문서에 적는다.

## 반례

1. search.content에 pattern을 주면 오류가 query를 이름으로 제안한다.
2. search.files에 query를 주면 오류가 pattern/glob을 제안한다.
3. path 없이 호출하면 무엇을 넣을지 말한다.
4. readText가 문자열과 { url } 양쪽에서 같은 결과를 낸다.
5. readText 결과의 text가 markdown과 같고 둘 다 비어 있지 않다.
