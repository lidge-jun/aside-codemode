# 030 — w4: 건너뛴 링크를 보이게 (이슈 #24)

## 이슈가 맞다

followSymlinks:true를 거절하는 근거(결과 필터링 전에 루트 밖을 읽을 수 있다)는 유지한다.
문제는 **거절이 아니라 침묵**이다. 37개 중 35개가 심볼릭 링크인 디렉터리에서 2개만
돌아오는데 complete:true, partial:[]이다. README가 권하는 noIgnore 대조로도 탐지되지 않는다 —
그 셋 다 결과를 바꾸지 않기 때문이다.

## 고칠 것

검색이 도는 경로에서 **건너뛴 링크 디렉터리를 세고 이름을 남긴다.**

    complete   링크를 건너뛰었으면 false
    partial    [{ kind: 'symlink-skipped', path }] 로 기록
    scope      followSymlinks:false가 적용됐다는 사실과 건너뛴 수

rg를 두 번 돌리지 않는다. 검색 대상 디렉터리의 심볼릭 링크 엔트리를 직접 열거해(깊이와
개수에 상한을 두고) 결과에 싣는다. 상한에 걸리면 그 사실도 적는다.

## 반례

1. 링크 디렉터리를 담은 임시 트리에서 search.files가 complete:false와 partial에 링크 이름을
   낸다.
2. 링크가 없는 트리에서는 complete:true가 그대로다(거짓 경보 없음).
3. 안내 메시지가 "링크가 가리키는 실제 경로를 path로 주면 나온다"를 말한다.
