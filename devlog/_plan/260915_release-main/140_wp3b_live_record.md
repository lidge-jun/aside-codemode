# 140 — wp3b 결과: 라이브 변이

백업(wp6a) 뒤에, 계정을 하나씩 이름으로 지정해서만 돌렸다.

    node scripts/install-codemode.mjs upgrade --account <id> --json

| 루트 | 동사 | written | preserved | block |
|---|---|---|---|---|
| mac u/0 | upgrade | 5 | 0 | current |
| mac u/1 | upgrade | 5 | 0 | current |
| mac u/2 | upgrade | 5 | 0 | current |
| mini u/0 | upgrade | 5 | 0 | current |
| macmini-cf u/1 | install | 5 | 0 | current |

`preserved`가 비어 있는 것은 그 계정들에 사용자가 고친 우리 파일이 없었다는 뜻이다.

## 라이브에서 하지 않은 것

repair, uninstall, rollback, 파일 삭제. 설치기에는 backup이 없고 uninstall은 previous를
담은 manifest를 지우며 rollback은 디스크를 보지 않고 덮는다. 그 넷은 전부 임시 루트
리허설에서만 돌렸다(090).

## 이 단계가 남긴 사실

mac u/0과 mini u/0의 `previous`는 선언한 해시(`63562408`, 1.0.0)와 담은 내용(`f5584a`,
1.1.0)이 다르다. 프로브가 upgrade 전에 계정 루트의 helper를 이미 바꿔 놓았고, 그때의
스냅샷이 옛 manifest의 주장을 그대로 베꼈기 때문이다. 스냅샷은 이후 읽은 내용의 해시를
기록하도록 고쳤지만(f8f2608), **이미 기록된 두 항목은 그대로 둔다.** 되돌릴 곳은
`evidence/release-260915/recovery.md`가 가리키는 세 경로다.

mac u/1과 u/2의 `previous`는 선언과 내용이 일치하고, 그 두 계정에서는 rollback이 실제로
1.0.0을 되돌린다.
