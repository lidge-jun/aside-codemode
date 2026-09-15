# 080 — w9: 0.3.0 (감사 반영본)

v0.2.0의 순서를 그대로 따른다. 첫 판에서 빠져 있던 것을 명시한다.

    1  package.json bump 커밋을 만들고 브랜치를 **push**한다 (push 없이는 CI가 없다)
    2  그 정확한 SHA의 5조합 success (취소되지 않은 run만)
    3  dev fast-forward push → 그 SHA에서도 5조합
    4  main에 --no-ff 병합 후 push
    5  **main push로 생긴 run의 5조합을 태그 전에 기다린다**
    6  태그는 **병합 커밋 SHA**에 붙인다 (v0.2.0도 그랬다)
    7  release 게시

## 기록

release-records의 기본 출력이 evidence/release-260915라 그대로 돌리면 v0.2.0 기록을 덮는다.
--out을 새 디렉터리로 준다.

## 세 기기

백업(backup-accounts.mjs) 먼저, 그다음 --account를 명시한 upgrade와 doctor만. 라이브에서
uninstall·rollback·repair는 이번에도 하지 않는다.

helper 바이트가 바뀌면 HELPER_VERSION을 올린다. 다만 템플릿만 바뀌어도 doctor는 해시로
stale을 말한다 — 버전 문자열이 같다고 재설치를 건너뛰지 않는다.

## 범위

npm publish는 이 릴리즈에서도 하지 않는다. 판정만 싣는다. G5도 여전히 미실행으로 남긴다.
