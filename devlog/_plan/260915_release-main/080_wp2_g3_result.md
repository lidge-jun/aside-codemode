# 080 — wp2 결과: G3 네 fixture

`scripts/probe-g3.mjs`가 실제 브라우저에서 13개 검사를 돌린다. 판정은 전부 조작 뒤의
DOM을 다시 읽어서 한다. 반환값이 예외를 안 던졌다는 것은 통과 근거가 아니다.

    node scripts/probe-g3.mjs --account-root <path> --label <host>

## 측정 (2026-09-15)

| 검사 | mac | mini (Windows) |
|---|---|---|
| 1a iframe 안 버튼의 ref가 트리에 있다 | ok `["e1","f1e1"]` | ok 같은 값 |
| 1b 그 ref 클릭이 자식 문서를 바꾼다 | ok `child="child-clicked"` | ok |
| 1c 같은 글자의 부모 버튼은 그대로다 | ok `parent=""` | ok |
| 1d 부모 ref는 부모를 바꾼다 (1c의 대조군) | ok `parent="parent-clicked"` | ok |
| 2a 배치 전 native 클릭이 남는다 | ok `native-1` | ok |
| 2b 배치가 3건 전부 완료 | ok `completed` | ok |
| 2c 배치가 그 탭의 관찰을 덮지 않는다 | ok | ok |
| 2d 배치 뒤에도 그 탭을 다시 조작할 수 있다 | ok `native-1` | ok |
| 2e 배치가 자기 탭을 남기지 않는다 | ok `leaked=0` | ok |
| 3a screenshot이 바이트로 돌아온다 | ok 24243B | **3회 중 2회 ok** 7613B |
| 3b display()가 그 이미지를 받는다 | ok | 3a가 된 실행에서 ok |
| 4a 같은 page의 두 호출이 실제로 겹쳤다 | ok | ok |
| 4b 최종 DOM이 한쪽의 완결 결과다 | ok `two-done` | ok |

## 세 가지는 돌리지 않았다

- **3c 축소 이미지의 좌표 매핑.** 자극을 만들 API가 없다. `screenshot.maxWidth`는 받고
  무시되고, 호스트 resize는 ENOTSUP이며 `page.setViewportSize`는 absent다.
- **3d DPI 100/125/150/200%, zoom, clip.** 같은 이유.
- **4c 명시적으로 선택된 page의 native mouse/keyboard 동등성.** 별도 native fixture가
  필요하고, `cua`는 capability 행렬에 아예 없다.

세 항목은 통과로 세지 않는다. 000의 c-3 미실행 목록에 그대로 남는다.

## 재면서 알게 된 것

**`data:` 페이지의 iframe은 이 fixture로 쓸 수 없다.** 처음에는 `data:` 부모에 `srcdoc`
자식을 넣었는데, 트리에 자식 컨트롤이 없고 `contentDocument`가 null이었다. `data:` URL은
opaque origin이라 자식이 부모에게 교차 출처다. 260914_a11y-actions가 같은 fixture를
127.0.0.1로 띄운 이유가 이것이었다. 프로브는 루프백 http로 fixture를 서빙한다.

**Windows는 탭이 앞에 있어야 viewport를 찍는다. 그래도 가끔 실패한다.** 첫 실행은
`browser CDP command timed out while capturing viewport screenshot`이었다. `bringToFront`와
1회 재시도를 넣자 성공했고, 이후 3회 중 2회 성공 / 1회 같은 타임아웃이었다. 이건 우리
코드의 결함이라기보다 그 기계의 표면 상태(원격 데스크톱 세션에서 창이 실제로 보이는지)에
달린 것으로 보인다. 출시 기록의 capability receipt에 표면별 사실로 적는다.

**3b가 증명하는 것의 한계.** `display(shot)`이 예외 없이 이미지를 받았다는 것까지다.
모델이 그 이미지를 실제로 보았는지는 이 자리에서 관측할 수 없다. 그렇게 적는다.

## 이미 닫힌 증거는 인용만 한다

070의 5a~5c(이미 연 탭과 배치 공존, 콜백 안 snapshot, 배치 뒤 탭 생존)는 다시 돌리지
않았다. 2a~2e가 그보다 강한 순서(native 조작 → 배치 → native 재조작)를 본다.
