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
