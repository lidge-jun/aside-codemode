# 010 — w2: 게스트 샌드박스의 거절을 말이 되게

## 지금

`src/execution-worker.js`는 vm.createContext 위에서 new vm.Script로 게스트를 돌린다.
importModuleDynamically를 주지 않았으므로 게스트가 동적 임포트를 쓰면 Node가
ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING을 던진다. 그 메시지는 호출자에게 아무것도 알려주지
않는다 — 무엇이 막혔는지도, 대신 무엇을 써야 하는지도.

## 고칠 것

vm.Script 옵션에 importModuleDynamically를 주고, 그 콜백이 **설명이 있는 오류**를 던지게
한다.

    code     EGUESTIMPORT
    message  import('node:fs') is not available inside --code. The guest has no module
             loader; use the injected globals instead: <실제 주입된 이름 목록>.

요청한 specifier를 그대로 실어 무엇을 막았는지 보이게 한다. codeGeneration strings:false로
eval과 new Function도 막혀 있다는 사실을 같은 자리에서 한 줄로 말한다.

## 반례

1. 게스트에서 동적 임포트 → 지금은 ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING, 고친 뒤에는
   EGUESTIMPORT와 주입된 전역 목록.
2. 그 메시지가 실제로 존재하는 이름만 부른다 — 게스트 컨텍스트의 키와 대조한다.
3. 메시지에 eval/new Function 차단도 한 줄로 들어간다.
