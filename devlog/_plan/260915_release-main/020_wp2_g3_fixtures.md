# 020 — wp2: G3 fixture의 산 판정 (감사 2차 반영본)

로드맵 G3의 합격은 "선택한 fixture의 실제 화면/DOM 결과와 일치"다. 문자열 트리 단언은
이 칸을 닫지 못한다. 구현은 `scripts/probe-g3.mjs` 하나로 모으고 mac과 ssh mini에서
같은 명령으로 돌린다.

    node scripts/probe-g3.mjs --account-root <path> --label <host> --json

070의 프로브 5a~5c(이미 연 탭과 배치 공존, 콜백 안 snapshot, 배치 뒤 탭 생존)는 이미
닫힌 증거로 **인용만** 한다.

## 1. iframe 안의 ref

fixture: `data:` 페이지에 `srcdoc` iframe을 넣고, 메인과 iframe에 같은 글자의 버튼을
하나씩 둔다. 각 버튼은 자기 문서의 `#out`에 표식을 쓴다.

    oracle:  iframe 쪽 f* ref를 상위 page.locator로 눌렀을 때
             iframe 문서의 #out === 'child-clicked' 이고 메인 문서의 #out 은 빈 채로 남는다

거절은 다른 문서·다른 관찰의 ref 재사용(`ESTALEREF`)에만 건다.

**계획 수정 (2026-09-15, 실측 뒤).** `data:` + `srcdoc` 조합은 이 표면에서 불가능하다.
`data:` 페이지는 opaque origin이라 자식이 교차 출처가 되고, 접근성 트리에 자식 컨트롤이
없으며 `contentDocument`가 null로 돌아온다. 그래서 fixture를 루프백 http로 바꾼다 —
260914_a11y-actions의 P2가 같은 이유로 127.0.0.1을 썼고 거기서 `f1e1` ref가 나왔다.
070이 적어 둔 "브라우저가 루프백에 닿지 못한다"는 이 fixture에서는 재현되지 않았고 mac과
mini 양쪽에서 열렸다. 결과에는 "srcdoc fixture 통과"가 아니라 "srcdoc은 불가능, 루프백
fixture로 판정"이라고 적는다. 그리고 oracle에 양성 대조를 더한다 — 부모 ref를 눌렀을 때
부모 `#out`이 실제로 바뀌어야, 자식만 바뀌었다는 앞의 관찰이 증거가 된다.

## 2. native → 배치 → native

    1) openTab(A)에서 native로 버튼을 눌러 #out을 'native-1'로 만든다
    2) cm.run으로 다른 URL 3개를 배치 처리한다
    3) 다시 A를 snapshot한다

    oracle:  3)의 #out 이 여전히 'native-1' 이고, A가 열려 있고(leaked 아님),
             배치 결과 3건이 각자 jobId를 갖는다

## 3. display로 넘긴 이미지

    oracle:  에이전트 REPL에서 screenshot → display 호출이 성공하고,
             돌려받은 기술자에 실제 이미지 바이트 길이와 형식이 실려 있다

이건 "이미지가 모델 입력으로 들어가는 경로가 산다"까지만 증명한다. **축소 변환의 좌표
매핑, DPI 100/125/150/200%, zoom·clip은 자극을 만들 API가 없어 미실행이다** —
`screenshot.maxWidth`는 받고 무시되고, 호스트 resize는 ENOTSUP, `page.setViewportSize`는
absent다. 이 넷은 000의 c-3 미실행 목록에 이름으로 남고 DONE에 들어가지 않는다.

## 4. 공유 page를 두 호출이 동시에 바꾸는 경쟁

자극은 **같은 page 객체**에 대한 두 호출이다. 동시성은 우연에 맡기지 않는다.

    barrier: 두 호출을 Promise.all 로 띄우되, 각 호출이 시작 시각을 기록하고
             페이지가 자기 호출을 100ms 붙잡게 해서 구간이 실제로 겹치는지 확인한다
    oracle:  겹쳤다면 최종 DOM이 두 조작 중 하나의 완전한 결과여야 하고
             (섞인 중간 상태가 아니어야 하고), 겹치지 않았다면 직렬화됐다는 로그가 남는다

겹침이 확인되지 않은 실행은 통과로 세지 않는다. "명시적으로 선택된 page의 native
mouse/keyboard 동등성"은 별도 fixture가 필요하므로 미실행으로 남긴다. `cua`는
`browse.probe()`의 행렬에 아예 없다.

## probe() 표를 근거로 쓰지 않는다

`browse.probe()`의 present/absent는 2026-09-14에 얼린 `CAPABILITY_MATRIX`다. 산 호출이
아니다. `probe-g3.mjs`는 쓰는 메서드를 그 자리에서 호출하고, 행렬을 인용할 때는 과거
측정이라고 밝힌다.

## 범위 밖

캡차 실해결과 금고 자동입력. 이 루프가 닫는 것은 G3 중 실행 가능한 부분이다.
