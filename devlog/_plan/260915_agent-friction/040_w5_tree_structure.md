# 040 — w5: 트리를 구조로도 (감사 반영본)

## 파서가 살 자리

호스트가 이미 받은 tree 문자열을 다시 파싱하면 **잘린 줄에서 depth가 깨진다.** 그래서
파싱은 자르기 전에, 즉 src/host/browse/script.js의 TREE_SUMMARY_SRC 안에서 한다. attach는
그 요약기를 REPL에 주입해 쓰고 있고, cm.js는 탭 예산만 다루므로 여기가 아니다.

주입되는 소스가 길어지는 것 자체가 위험이다. session.raw 경로에는 exec에 있는 30000자
검사가 없어서, 파서를 크게 주입하면 Windows에서 ENAMETOOLONG이 난다. 그래서 (a) 파서를
작게 쓰고 (b) 그 경로에도 같은 길이 검사를 넣는다.

## 크기

nodes를 tree(기본 20000자)와 refs(500개) 위에 그냥 얹으면 기본 maxResultBytes 65536에서
fitEnvelope가 키를 잘라 낸다. 그래서 예산을 함께 쓴다.

    maxNodes        기본 상한, 넘으면 nodesTruncated: true
    예산            nodes가 tree와 같은 문자 예산을 나눠 쓴다
    비밀값          [type=password]의 value는 노드에도 싣지 않는다 (diff가 이미 지운다)

## 어느 모드에서 성립하나

묶음 추출은 **tree 모드**에서만 된다. interactive 모드는 heading과 text 줄을 버리므로
"과목 - 과제명 - 마감일"의 과목과 마감일이 애초에 트리에 없다. 지금 이름 추출은 따옴표만
보므로 text:와 heading [level=n]: 줄의 이름도 읽게 한다. 그러지 않으면 노드의 name이 비고
"상태 머신 없이 모은다"가 거짓이 된다.

## 반례

1. 기존 a11y fixture(0/2/4칸 중첩, ref, text: 줄)에서 nodes의 depth가 실제 중첩과 맞는다.
2. text:/heading: 줄의 name이 채워진다.
3. ref가 있는 노드의 ref가 기존 평탄 맵과 일치한다.
4. 파싱하지 못한 줄이 raw로 남고 그 수가 결과에 보인다.
5. 상한을 넘기면 nodesTruncated가 서고 결과가 예산 안에 든다.
6. password 필드의 value가 노드에 없다.
7. interactive 모드에서는 묶음이 불가능하다는 것을 테스트가 기록한다.
