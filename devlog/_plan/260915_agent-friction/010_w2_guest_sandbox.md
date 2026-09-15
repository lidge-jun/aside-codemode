# 010 — w2: 게스트 샌드박스의 거절을 말이 되게 (감사 반영본)

## 첫 계획은 틀렸다

처음에는 vm.Script에 importModuleDynamically를 달면 된다고 적었다. 감사가 Node v24에서
직접 돌려 보고 그게 거짓임을 보였다. 콜백을 달아도 워커의 execArgv가 비어 있어
--experimental-vm-modules가 없으면 콜백은 **호출되지 않고**
ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG가 난다. 그 플래그 강제는 Node 20.10부터라
CI의 18과 22가 서로 다르게 답한다. vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER는 플래그
없이 되지만 진짜 fs 네임스페이스를 돌려주므로 **샌드박스 탈출**이다.

## 그래서 다르게 고친다

로더를 열지 않는다. **오류를 번역한다.** 게스트가 던진 것이
ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING이든 ..._FLAG든, 경계에서 잡아 설명이 있는 오류로
바꾼다. 실험 플래그가 필요 없고 Node 18/20/22/24에서 같은 답이 된다.

    자리     src/execution-output.js 의 errorFields (code를 복사하는 그 자리)
    code     EGUESTIMPORT
    message  dynamic import() is not available inside --code: the guest runs as a script in
             a vm context with no module loader. Use the injected globals instead:
             search, fs, actions, browse, report, api, recipes, read_file, write_file,
             edit_file, apply_patch, console.

정적 import는 콜백과 무관하게 SyntaxError: Cannot use import statement outside a module로
죽는다. 그 문구도 같은 힌트를 갖게 한다. 문자열 코드 생성은 이미
codeGeneration.strings:false가 EvalError로 막고 있고, 그것도 같은 문장으로 번역한다.

## 반례

1. 게스트에서 await import('node:fs') → code가 EGUESTIMPORT이고 메시지가 주입 전역을 나열.
2. 정적 import 한 줄 → 같은 힌트가 붙은 SyntaxError.
3. 문자열에서 코드를 만드는 호출 → EvalError가 "이 컨텍스트에서는 막혀 있다"를 말한다.
4. 메시지가 부르는 이름이 실제 게스트 컨텍스트의 키와 일치한다(하드코딩 목록이 드리프트하지
   않게 주입 테이블에서 만든다).
5. **await 없이** import()를 부르면 IIFE는 성공하고 거절이 나중에 온다. 그 경우를 테스트가
   기록해 둔다 — 조용한 성공은 이 번역이 닿지 않는 자리다.
