# 070 — wp7: main 승격 (감사 1차 반영본)

`origin/main`은 8223264이고 `origin/dev`가 76커밋 앞서 있다. 태그는 아직 없다.

## 순서

1. `codex/release-main`에서 `package.json`을 0.1.0 → 0.2.0으로 올리는 커밋을 만든다.
   이 커밋이 릴리즈의 head다.
2. 그 정확한 SHA로 hosted CI 다섯 조합이 success인지 확인한다. `cancel-in-progress: true`
   이므로 **마지막 SHA의 취소되지 않은 run**만 센다.
3. dev에 반영하고 dev head에서도 같은 다섯 조합을 확인한다.
4. main에 병합한다. 병합이 내용을 바꾸면 merge commit에서 CI를 다시 기다린다.
5. main에 푸시된 뒤 `github.ref`가 바뀐 새 run의 다섯 조합을 **태그 전에** 기다린다.
6. `package.json`이 0.2.0인 main SHA에 `v0.2.0` 태그를 붙인다.
7. GitHub release를 만든다. 본문에 들어간 것과 세지 않은 것(G5 수동 세션, 캡차·금고)을
   같이 적는다.

## 하지 않을 것

npm publish. 기본 브랜치 설정 변경. 계정 권한 변경. release 본문에 G5를 통과로 적는 것.

## 통과 조건

태그가 가리키는 SHA에서 `package.json`이 0.2.0이고, 그 SHA의 CI 다섯 조합이 success이고,
main이 그 SHA를 담고, release가 존재한다. 넷 중 하나라도 비면 DONE이 아니다.
