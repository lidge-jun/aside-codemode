# 050 — w6: 켜는 길 (감사 반영본)

## 결정

기본값은 opt-in으로 유지한다. 브라우저를 여는 능력이 설치만으로 켜지는 것은 이 도구의
성격과 맞지 않다.

## 첫 계획의 명령은 쓸 수 없다

처음에는 설치기에 enable-browse 동사를 더하려 했다. 감사가 둘을 짚었다.

1. **전역 설치에서 실행 불가.** npm으로 깔면 scripts/install-codemode.mjs는 cwd에 없다.
   bin은 codemode 하나뿐이다. F1이 고치려는 바로 그 경로에서 안내가 실행 불가가 된다.
2. **소유 범위가 다르다.** browseCaps는 계정 루트가 아니라 기계 단위 사용자 설정
   (~/.config/codemode/config.json)에 산다. 설치기는 계정 루트의 닫힌 목록만 만진다.
   그 파일의 주인은 register 쪽이다. --account도 기계 단위 설정과 모순이다.

## 그래서

    codemode --enable-browse [--json]

CLI 플래그로 둔다. 전역 설치 뒤에도 그대로 실행된다. 하는 일은 사용자 설정의
browseCaps.enabled만 true로 만드는 것이고, roots나 다른 키는 건드리지 않는다(기존
mergeMachineConfig는 roots를 덮으므로 그대로 재사용하지 않는다). 이미 켜져 있으면 아무것도
쓰지 않고 그렇게 보고한다.

거절 메시지는 **꺼져 있어서 막힌 모든 자리**에서 이 명령을 알려준다 — browse.exec의
EDISABLED뿐 아니라 probe, --doctor --browse의 enabled:false, attach, report.build까지.

uninstall은 이 설정을 되돌리지 않는다(계정 설치와 다른 축이다). 그 사실을 문서에 적는다.

## 반례

1. codemode --enable-browse가 사용자 설정의 browseCaps.enabled만 바꾼다. roots 불변.
2. 이미 true면 파일을 쓰지 않고 already-enabled로 보고한다.
3. 그 뒤 --doctor --browse가 enabled:true.
4. 꺼진 상태의 EDISABLED, probe, doctor 출력이 모두 그 명령 문자열을 담는다.
5. 설치기의 동사 집합은 그대로다(알 수 없는 동사가 install 분기로 새지 않는다).

---

## 뒤집힘 (2026-09-15, 0.3.2)

이 문서가 "기본값은 opt-in 그대로"라고 적어 둔 결정은 유저가 뒤집었다. `browseCaps.enabled`의
기본값이 이제 true다. 설치한 그대로 브라우징이 된다.

opt-in을 택했던 이유는 브라우저를 여는 일을 설치가 대신 결정하면 안 된다는 것이었다. 실제로
부딪힌 비용은 그 반대였다. 0.2.0의 첫 사용자가 손으로 설정 파일을 고쳤고, `--enable-browse`를
만든 뒤에도 "한 번 더 해야 하는 단계"는 남아 있었다. 기능이 설치돼 있는데 꺼져 있는 상태가
기본값이면, 그 사실을 아는 사람만 쓸 수 있는 기능이 된다.

명령은 없애지 않았다. 끄기로 한 기계를 되돌리는 경로이고, 거절 문구도 그 명령을 계속 가리킨다.
바뀐 것은 문장의 방향뿐이다 — "켜려면 이걸 하세요"에서 "이 기계는 꺼 뒀고, 되돌리려면 이걸
하세요"로. 테스트도 그렇게 고쳤다: 새 설치가 바로 브라우징하는지, 그리고 꺼진 기계가
`EDISABLED`와 함께 되돌릴 명령을 말하는지 둘 다 본다.
