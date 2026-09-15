# 020 — w3: 첫 호출에서 틀리게 만드는 모양 (감사 반영본)

## search의 이름

계약: search.files는 path(필수) + pattern(경로 부분 문자열) + glob, search.content와
search.count는 query(필수) + path(필수) + glob 등. pattern은 files 전용, query는
content/count 전용.

고칠 자리는 엔트리별 allowed 필터가 bad key를 만드는 그 분기다(src/search-schema.js).
**기존 메시지 형태를 유지한다** — unknown option(s) "pattern". valid: ... 는 그대로 두고
(테스트가 /valid:/를 본다) 그 뒤에 한 문장을 덧붙인다.

    search.content: unknown option "pattern". valid: query, path, glob, ...
    In search.content, content is matched with query; pattern is search.files' filter on
    paths.

path 누락도 같은 자리에서 한 문장 — 무엇을 넣어야 하는지(설정된 roots 중 하나, 또는 --cwd로
푼 절대 경로)를 말한다. 카탈로그 설명에만 있던 문장을 오류로 내린다.

search.count도 같이 고친다. 처음 계획은 files와 content만 적었다.

## readText

두 가지를 고친다.

1. **인자.** 문자열과 { url, ...opts } 양쪽을 받는다. 카탈로그는 이미 객체 inputs.url을
   광고하므로 actions.check가 통과시키는 호출을 런타임이 거절하는 지금 상태가 모순이다.
2. **결과 필드.** 감사가 보인 대로 "같은 참조라 바이트가 안 는다"는 JSON에서 거짓이다
   (10k 본문이 10029 → 20039 bytes). 그래서 **필드를 늘리지 않고 이름을 바꾼다.**

       text    본문 (정식)
       format  'markdown'

   markdown 키는 0.3.0에서 제거하고 릴리즈 본문에 깨지는 변경으로 적는다. 1.0 이전이고,
   두 벌로 두면 예산이 큰 쪽을 잘라 res.text가 다시 비는 실패로 돌아온다(shrinkStructured는
   앞 키부터 채운다).

   캐시도 같이 고친다. 히트는 warm을 그대로 펼쳐 돌려주므로 옛 엔트리에 text가 없다.
   읽을 때 복원하거나 캐시 스키마 버전을 올려 옛 엔트리를 무시한다.

## 반례

1. search.content에 pattern → 메시지에 valid:가 남아 있고, query를 쓰라는 문장이 더해진다.
2. search.files에 query → pattern/glob을 제안한다.
3. search.count에 pattern → 같은 제안.
4. path 없이 호출 → 무엇을 넣을지 말한다.
5. readText가 문자열과 { url } 양쪽에서 같은 결과.
6. 결과에 text가 있고 markdown이 없다. 옛 캐시 엔트리에서도 text가 나온다.
7. 10k 본문에서 결과 바이트가 v0.2.0 대비 늘지 않는다.
