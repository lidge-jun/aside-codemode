# 030 — D summary (wp1)

Windows 기본 rg 스폰에서 `windowsHide: true`를 뺐다. `CODEMODE_WINDOWS_HIDE=1`만 다시 켠다.

## 무엇

`src/child-opts.js` `rgChildOpts`가 SSOT. `src/rg.js` 버전 프로브 두 곳과 `src/rg-stream.js` spawn이 그걸 쓴다. `where.exe`는 그대로.

## 증거

- 로컬 `npm test` 201/201 exit 0. receipt: `.codexclaw/evidence/5dd1bb26-b2f7-4611-ba5a-b518b7f52092/test-receipt.json`
- 커밋 `c062f41` (origin 미푸시)
- ssh mini: 패치 파일 scp 후 helper 테스트 5/5, Git bash·Aside `--doctor` ok, `search.count` 20/3
- 미니에서는 `0xC0000142`가 재현되지 않음 (패치 전에도 Aside doctor/search 초록). #5는 리포터 표 + omit-hide 커밋으로 닫음

## 다음

푸시는 사용자 요청이 있을 때. README에 `CODEMODE_WINDOWS_HIDE`는 이 사이클 OUT.

LOOP-PESSIMIST: 미니에서 숨김 스폰이 이미 살아서, 이 머신이 #5의 실패 경로를 증명하지는 못했다. 호출부 소스 락이 그 공백을 메운다. 락이 틀렸다면 `windowsHide:true`(공백 없음) 같은 표기가 다시 들어와도 테스트는 통과한다.
