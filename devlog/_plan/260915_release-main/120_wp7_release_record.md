# 120 — wp7 결과: 0.2.0 승격

## 실제로 지나온 순서

    140e618  release: 0.2.0            codex/release-main에 push
             run 34917854500           5조합 success (ubuntu 18/20/22, macos 22, windows 22)
    140e618  dev로 fast-forward
             run 34917965489           5조합 success
    0cfbc86  main에 --no-ff 병합        트리가 140e618과 동일(07481538)
             run 34918127258           5조합 success
    v0.2.0   0cfbc86에 annotated 태그   push
             run 34918565012           태그 push로 생긴 run도 5조합 success
    release  게시, draft 아님

태그가 가리키는 커밋의 `package.json`은 0.2.0이고, `origin/main`이 그 커밋이다. 세 SHA
어디에도 취소된 run은 없다. npm publish는 하지 않았고 기본 브랜치도 바꾸지 않았다.

## 릴리즈 본문이 말하는 것과 말하지 않는 것

말하는 것: 로더 경로 수정과 그 검증 범위(CLI 세 대 실측 / 앱 표면은 사용자 확인), 설치
수명 수정 넷, G3 14/14, 세 기기 다섯 루트 배포.

말하지 않는 것: G5는 돌리지 않았고 통과로 세지 않는다. 사용자 면제로 승격의 막대에서
빠졌을 뿐이며 그것은 기준 변경이지 게이트 통과가 아니다. R6도 닫았다고 쓰지 않았다.
축소 좌표·DPI·zoom·clip, 모델의 이미지 수신, native mouse/keyboard 동등성, 캡차·금고는
미측정으로 이름을 적었다.

## 감사가 고치게 한 것

1. **기록의 커밋 스탬프가 태그가 아니었다.** 생성 시점이 버전 bump 직전이라 `commit`이
   2ca0217이었고 그 커밋의 `package.json`은 0.1.0이다. 생성기가 `releaseTag`와
   `releaseTagCommit`을 함께 싣도록 고쳤다. 태그 안에 들어간 사본은 그대로 두고, 수정본은
   dev에 있다는 것을 릴리즈 본문에 적었다.
2. **리드 문장이 앱 표면까지 실측한 것처럼 읽혔다.** 본문을 고쳐 CLI `aside repl` 세 대의
   실측과 앱 내부 에이전트 REPL의 사용자 확인을 나눠 적고, mac u/1·u/2가 skipped인 이유도
   적었다.

## 이 태그 이후에 남는 운영 사실

- mac u/0과 mini u/0에서 `rollback`은 1.0.0이 아니라 1.1.0 바이트를 되돌린다. 원인과 복구
  경로는 `evidence/release-260915/recovery.md`에 있다.
- macmini-cf의 u/0과 u/2~u/6에는 어제 register가 넣은 구 블록이 남아 있고 doctor가
  `agentsBlock: stale`을 낸다. 이번 릴리즈는 u/1에만 설치했다.
- Windows viewport 스크린샷은 탭을 앞으로 가져와도 간헐적으로 CDP 타임아웃이 난다.
- 라이브 계정에서 uninstall·rollback·repair는 의도적으로 돌리지 않았다.
