# 080 — wp2 결과: G3 fixture

`scripts/probe-g3.mjs`가 실제 브라우저에서 14개를 판정하고 4개를 "돌리지 않음"으로 남긴다.
판정은 조작 뒤의 DOM이나 실제 바이트를 다시 읽어서 한다. 예외가 안 났다는 것은 근거가
아니다.

    node scripts/probe-g3.mjs --account-root <path> --label <host>

## 측정 (2026-09-15, HEAD e896542)

| 검사 | mac | mini (Windows) |
|---|---|---|
| 1a iframe 안 버튼의 ref가 트리에 있다 | ok `["e1","f1e1"]` | ok 같은 값 |
| 1b 그 ref 클릭이 자식 문서를 바꾼다 | ok `child="child-clicked"` | ok |
| 1c 같은 글자의 부모 버튼은 그대로다 | ok `parent=""` | ok |
| 1d 부모 ref는 부모를 바꾼다 (1c의 대조군) | ok `parent="parent-clicked"` | ok |
| 2a 배치 전 native 클릭이 남는다 | ok `native-1` | ok |
| 2b 항목마다 자기 jobId와 자기 본문 | ok `j000~j002 / page-N-body` | ok |
| 2c 배치가 그 탭의 페이지와 결과를 두고 간다 | ok | ok |
| 2d 배치 뒤에도 그 탭을 다시 조작할 수 있다 | ok `native-1` | ok |
| 2e 배치가 자기 탭을 남기지 않는다 | ok `leaked=0` | ok |
| 3a screenshot이 바이트로 돌아온다 | ok 24243B | ok 7613B — 첫 시도는 CDP timeout, `bringToFront` 뒤 재시도 성공 |
| 3b 그 바이트가 진짜 PNG다 | ok IHDR 2880x1800 | ok IHDR 1440x900 |
| 3c display()가 예외 없이 그 이미지를 받는다 | ok | ok |
| 4a 같은 page의 두 호출이 실제로 겹쳤다 | ok | ok |
| 4b 두 필드가 같은 쪽 값이다 (섞이지 않았다) | ok `{first:"two",second:"two"}` | ok |

양쪽 모두 14/14.

## 네 가지는 돌리지 않았다

- **3d 축소 이미지의 좌표 매핑.** 자극을 만들 API가 없다. `screenshot.maxWidth`는 받고
  무시되고, 호스트 resize는 ENOTSUP이며 `page.setViewportSize`는 absent다.
- **3e DPI 100/125/150/200%, zoom, clip.** 같은 이유.
- **3f 모델이 그 이미지를 실제로 받았는지.** `display()`는 undefined를 돌려준다. 모델 쪽은
  REPL에서 관측할 수 없다.
- **4c 명시적으로 선택된 page의 native mouse/keyboard 동등성.** 별도 native fixture가
  필요하고 `cua`는 capability 행렬에 아예 없다.

네 항목은 통과로 세지 않는다. 000의 c-3 미실행 목록에 그대로 남는다.

## 재면서 알게 된 것

**`data:` + `srcdoc`은 이 fixture로 쓸 수 없다.** 처음엔 그렇게 만들었는데 트리에 자식
컨트롤이 없고 `contentDocument`가 null이었다. `data:` URL은 opaque origin이라 자식이 부모에게
교차 출처다. 260914_a11y-actions가 같은 fixture를 127.0.0.1로 띄운 이유가 이것이다. 그래서
루프백 http로 서빙한다 — 070이 적어 둔 "브라우저가 루프백에 닿지 못한다"는 이 fixture에서는
재현되지 않았다.

**Windows는 탭이 앞에 있어야 viewport를 찍는다. 그래도 가끔 실패한다.** 첫 실행은
`browser CDP command timed out while capturing viewport screenshot`이었다. `bringToFront`와
1회 재시도를 넣은 뒤 4회 중 3회 성공, 1회 같은 타임아웃이었다. 그 기계에서 창이 실제로
보이는 상태인지에 달린 것으로 보인다. 3a의 판정 문자열이 `bringToFront` 여부와 첫 시도의
오류를 그대로 싣고, 출시 기록의 capability receipt와 운영 안내에 표면별 사실로 적는다.

**display가 증명하는 것의 한계.** `display(shot)`은 undefined를 돌려주므로 "예외 없이
받았다"까지가 관측 가능한 전부다. 그래서 이미지는 우리가 직접 읽는다 — PNG 시그니처와
IHDR의 폭·높이가 실제 viewport의 그림이라는 근거다. 모델이 보았는지는 3f로 남긴다.

## 감사가 바꾼 것

첫 판은 FAIL이었다. 통과를 가짜로 만들 수 있는 자리가 넷이었다.

- **1c가 빈 칸을 빈 칸으로 확인하고 있었다.** 부모 `#out`의 초기값이 이미 `""`라 클릭을
  건너뛰어도 통과였다. 부모 ref를 눌러 `parent-clicked`가 되는 양성 대조(1d)를 넣었다.
- **4b가 항진명제였다.** 한 칸을 두 쪽이 덮어쓰는 자극에서는 섞인 상태를 만들 수 없다.
  필드를 둘로 나누고 각 호출이 순서대로 쓰게 바꿔 섞임이 관측 가능해졌다. 그 위에서
  겹친 두 호출이 섞이지 않았다는 것이 결과다.
- **2b가 jobId를 버렸다.** 이제 `j000/j001/j002`와 각 페이지 본문을 짝지어 본다.
- **Windows 전제가 한 줄에 흡수돼 있었다.** 이제 판정 문자열에 드러난다.

## 이미 닫힌 증거는 인용만 한다

070의 5a~5c(이미 연 탭과 배치 공존, 콜백 안 snapshot, 배치 뒤 탭 생존)는 다시 돌리지
않았다. 2a~2e가 그보다 강한 순서(native 조작 → 배치 → native 재조작)를 본다.
