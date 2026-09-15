# 090 — wp3 결과: 설치 수명

## 고친 결함 셋

세 개 모두 반례를 먼저 쓰고(test/install-lifecycle.test.js) 고쳤다.

1. **바이트가 바뀌는 upgrade 뒤 rollback이 돌아갈 데가 없었다.** `applyWrites`가 디스크를
   먼저 덮고 `snapshotForRollback`이 그 덮인 디스크를 읽어서, `previous`에 방금 쓴 새
   바이트가 들어갔다. 스냅샷을 쓰기 앞으로 옮겼다. 기존 테스트가 이걸 못 잡은 이유는
   install과 upgrade가 같은 바이트일 때만 돌렸기 때문이다.
2. **doctor가 구버전 설치를 건강하다고 말했다.** `ok`가 디스크와 manifest 기록 해시만
   비교했다. 이제 planned 바이트와도 비교해 `stale`을 말하고 `upToDate`를 함께 낸다.
3. **repair가 디스크에 없는 바이트의 해시를 기록했다.** 건너뛴 파일에도 planned 해시를
   써서, 다음 upgrade가 그 파일을 사용자 수정으로 보고 구 문서를 영구 보존했다. 건너뛴
   파일은 디스크 해시를 기록한다.

## 리허설 (임시 루트, 9단계)

`node scripts/rehearse-install.mjs --out evidence/install-rehearsal-260915.json`

계정을 **이전 릴리즈가 설치한 상태**로 만들어 시작한다. 같은 바이트를 다시 쓰는 upgrade는
rollback에 대해 아무것도 증명하지 않기 때문이다.

| 단계 | 관측 |
|---|---|
| 2 doctor | `installedVersion 0.9.0`, `upToDate false`, `cm.js=stale` 나머지는 manifest 일치 |
| 4 upgrade | 사용자가 고친 SKILL.md는 preserved, 나머지 4개는 새 바이트, `previous`에 **구** helper |
| 5 rollback | helper가 구 바이트로 복원, 사용자 수정 유지 |
| 6 repair (삭제 뒤) | 없어진 SKILL.md만 written, 나머지는 skipped, manifest는 skipped의 **디스크** 해시 유지 |
| 7 upgrade (repair 뒤) | helper가 현재 바이트로 들어간다 — 예전이라면 여기서 막혔다 |
| 8 uninstall | 소유 파일 5개 삭제, 블록 제거, manifest 삭제, 블록 수 0 |
| 9 재install | 5개 재작성, `upToDate true`, 블록 수 1 |

## rollback에 대해 알아낸 것과 그대로 둔 것

rollback은 `inspectFile` 없이 previous를 덮어쓴다. 리허설 5단계에서 사용자 수정이 살아남은
것은 그 수정이 upgrade **전**에 있었고 upgrade가 보존했기 때문이다 — previous가 이미 수정본을
담고 있었다. upgrade **후**에 고친 파일은 rollback이 말없이 덮는다. 이번 루프에서 동작을
바꾸지 않았고, 그 사실을 리허설 기록의 note와 운영 안내에 적는다.

## 라이브 계정에서 하지 않은 것

repair, uninstall, rollback, 파일 삭제 — 전부 임시 루트에서만 했다. 설치기에는 backup이
없고 uninstall은 previous를 담은 manifest를 지운다. 라이브는 wp6a 백업 뒤 wp3b에서
doctor와 upgrade만 한다.
