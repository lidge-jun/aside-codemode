# 050 — w6: 켜는 길

## 결정

**기본값은 opt-in으로 유지한다.** 브라우저를 여는 능력이 설치만으로 켜지는 것은 이 도구의
성격과 맞지 않고, 이번 릴리즈가 그 판단을 뒤집을 근거를 갖고 있지 않다. 대신 켜는 길을 한
번으로 줄이고, 거절이 그 길을 알려주게 한다.

    node scripts/install-codemode.mjs enable-browse --account <id> [--json]

지금 EDISABLED 메시지는 꺼져 있다고만 말한다. 고친 뒤에는 어느 파일의 어느 키인지와 위
명령을 함께 싣는다. --doctor --browse의 enabled:false 옆에도 같은 한 줄을 넣는다.

## 반례

1. browse.exec의 EDISABLED 메시지가 실행 가능한 명령을 담는다.
2. enable-browse가 사용자 설정의 browseCaps.enabled만 바꾸고 다른 키는 건드리지 않는다.
   이미 켜져 있으면 아무것도 쓰지 않고 그렇게 보고한다.
3. 그 명령 뒤 --doctor --browse가 enabled:true다.
