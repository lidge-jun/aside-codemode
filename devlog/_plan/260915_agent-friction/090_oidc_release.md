# 090 — 릴리스 경로를 토큰에서 OIDC로

0.3.0은 granular access token으로 올렸다. 그 토큰은 폐기했고, 같은 방법을 다시 쓸 생각도
없다. npm이 배너로 알리는 대로 bypass-2FA 토큰의 직접 배포는 2027년 1월에 끝난다.

## 왜 토큰이 성가셨는지

계정 bitkyc08은 2FA가 authorization과 publishing 양쪽에 걸려 있고 두 번째 인자는 보안 키뿐이다.
그래서 0.3.0 배포는 세 단계를 거쳤다: 패스키로 CLI 로그인, `npm publish`가 `EOTP`로 거절,
2FA를 우회하는 토큰 발급. 사람이 붙어 있어야 하고, 매번 비밀 하나가 잠깐 존재한다.

Trusted Publishing은 그 비밀을 없앤다. 워크플로 잡이 `id-token: write`를 요구하면 GitHub가
OIDC 신원을 만들고, npm이 그걸 짧은 수명의 발행 자격증명으로 바꾼다. 저장된 토큰이 없으니
유출될 것도 폐기할 것도 없고, 공개 리포의 공개 패키지에는 provenance가 저절로 붙는다.

## 이 리포의 모양

opencodex와 codexclaw의 릴리스 워크플로와 같은 계보로 썼다. 공통점이 우연이 아니라
같은 실패에서 나온 것들이다:

- **dispatch + audited SHA.** 브랜치는 감사와 dispatch 사이에 움직인다. `expected-sha`가
  `GITHUB_SHA`와 다르면 거절한다. 40자 전체 SHA만 받는다.
- **main에서만.** `GITHUB_REF`가 `refs/heads/main`이 아니면 멈춘다.
- **dry-run이 기본값.** 체크박스를 꺼야 실제로 올라간다.
- **정확한 커밋의 ci만 인정.** `--commit "$GITHUB_SHA" --event push --branch main`. PR run은
  다른 트리거로 merge ref를 테스트한 것이라 이 커밋을 보증하지 않는다.
- **이미 존재하는 것에는 실패한다.** 태그, GitHub release, 레지스트리 버전 셋 다 미리 본다.
  올라간 버전은 불변이고, 덮어쓰면 누군가 이미 설치한 것을 바꾸는 일이다.
- **발행 뒤 레지스트리 확인은 재시도하되 재발행은 하지 않는다.** 레지스트리는 늦는다. 늦은 것과
  실패한 것은 다르다.

두 군데는 이 리포에 맞춰 뺐다. 의존성도 lockfile도 없어서 `npm ci`가 설 자리가 없고
(ci.yml도 같은 규칙을 테스트로 지킨다), preview 채널이 없어서 dist-tag는 `latest` 하나뿐이다.

Node는 24로 고정한다. trusted publishing에 npm 11.5.1 이상이 필요하고 Node 24 러너가 이미
그걸 싣고 온다. `npm install -g npm`으로 올리지 않는 이유는 opencodex가 먼저 겪었다 —
전역 자체 업데이트가 sigstore 같은 발행 시점 의존성을 잃어버려 provenance가 마지막에 깨진다.

## npm 쪽 설정

패키지가 이미 존재해야 등록할 수 있다. 0.3.0이 올라가 있으니 가능하다. 패키지 설정에서
GitHub Actions publisher를 추가하고 organization/user `lidge-jun`, repository
`aside-codemode`, workflow **파일명** `release.yml`, environment는 비운다.

경로가 아니라 파일명이고, 확장자를 포함하며, 대소문자를 구분한다. `ENEEDAUTH`의 흔한 원인이
전부 이 입력 불일치다. 워크플로 파일을 옮기거나 이름을 바꾸면 npm 쪽도 같이 고쳐야 하고,
안 고치면 저장소 안의 무엇도 그 사실을 알려주지 않는다. test/release-workflow.test.js의
머리말이 그걸 적어 두는 자리다.

## 다음 릴리스 절차

1. dev에서 package.json을 올리고 push, 그 SHA에서 ci 5조합 success를 확인한다.
2. main에 `--no-ff`로 병합하고 push, main push run의 5조합을 기다린다.
3. Actions 탭에서 release를 main 기준으로 dispatch — version, expected-sha(그 병합 커밋),
   dry-run 체크. 게이트가 전부 지나가는지 본다.
4. 같은 입력으로 dry-run만 끄고 다시 dispatch. 워크플로가 발행하고, 태그를 그 커밋에 붙이고,
   release를 만든다.

태그를 사람이 먼저 만들지 않는다. 워크플로가 만든다 — 발행이 성공한 커밋에만 태그가 붙는
순서여야 태그가 "올라간 것"을 가리킨다.
