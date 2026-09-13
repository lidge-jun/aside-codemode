# wp2 — aside 등록 + 속도 검증 + 푸시 (diff-level)

## 파일 맵 (전부 NEW)

| 파일 | 책임 |
| --- | --- |
| scripts/register-aside.mjs | 단일 구현: settings.json 백업 → mcp.servers 머지 → codemode.config.json roots 기록. 플랫폼 자동 판별 |
| scripts/register-aside.ps1 | Windows 래퍼: node 해석 후 register-aside.mjs 호출 |
| scripts/register-aside.sh | mac 래퍼: 동일 |
| eval/make-corpus.mjs | 검증 코퍼스 생성(3000 파일/60 디렉터리, needle 5개 심기) |
| eval/run-task.ps1 | aside exec 1회 실행 + --log-dump 수집(Windows, 데드라인 래퍼 포함) |
| eval/run-task.sh | mac 동일 |
| eval/compare.mjs | 두 log-dump에서 wall-clock/툴콜 수/성공 여부 추출해 summary 생성 |

## D1 — 등록 머지 (register-aside.mjs)
- 대상: Windows C:/Users/super/.aside/u/0/settings.json, mac ~/.aside/u/0/settings.json (ASIDE_HOME env 우선).
- 순서: (1) 원본을 settings.json.bak-YYYYMMDD-HHmmss 로 복사 — 실패하면 UNSAFE 중단. (2) JSON 파싱 실패 시 중단(손상 방지). (3) mcp.servers['aside-codemode'] = { command: <node 절대경로>, args: [<repo>/src/server.js, '--config', <repo>/codemode.config.json] } — 다른 키는 일절 보존(객체 머지, 재직렬화는 JSON.stringify 2-space). (4) codemode.config.json의 roots를 [accountRoot, developersRoot]로 기록(Windows: C:/Users/super/.aside/u/0 와 C:/Users/super/Developers, mac: ~/.aside/u/0 와 ~/Developer). (5) 결과를 stdout에 요약.
- node 해석(래퍼): Windows는 C:/nvm4w/nodejs/node.exe 우선, 없으면 PATH. mac은 PATH의 node. 래퍼 2개는 10줄 이내.
- 멱등: 재실행 시 같은 키 덮어쓰기, 백업만 누적.

## D2 — 데몬 반영 프로브
- 등록 직후 aside exec --permission full-access -- 프롬프트 'execute_code 툴로 return 40+2 만 실행하고 결과만 답하라'. 로그덤프에 execute_code 호출이 보이면 반영 완료.
- 미반영 시: aside-daemon 프로세스만 종료 후 다음 CLI 호출로 재기동 유도 → 재프로브. 그래도 안 되면 사용자 앱 재시작 절차(aside-jun host-windows의 InteractiveToken oneshot 스케줄 트릭) 안내하고 BLOCKED 보고.

## D3 — 측정 프로토콜
- 코퍼스: <accountRoot>/codemode-eval/corpus. make-corpus.mjs가 60 디렉터리/3000 파일(각 1-3KB filler), needle NEEDLE-A1..A5를 서로 다른 깊이 파일에 심는다.
- 과제 프롬프트(고정): 'codemode-eval/corpus 아래에서 NEEDLE-A2 가 들어있는 파일을 모두 찾아 절대경로로 보고하라' + aside-jun 3절(쓰기 울타리/다운로드/질문 금지).
- baseline: 등록 전에 실행. after: 등록·반영 확인 후 needle을 A3로 바꿔 동일 프롬프트 실행(메모리/캐시 오염 방지).
- 각 실행은 --log-dump evidence/<ts>-<label>.jsonl 로 기록. compare.mjs가 wall-clock(agent_start→마지막 이벤트), 툴콜 수, 종료 상태, needle 적중 여부를 evidence/summary.md로 출력.
- 판정: after가 needle 전부 적중 + wall-clock이 baseline의 50% 미만이면 c-speedup met. 미달이면 원인 분석 후 1회 재측정(needle A4).

## D4 — 푸시 순서 (사용자 승인됨)
1. aside-codemode 리포: gh repo create lidge-jun/aside-codemode --public --source . --remote origin --push (커밋은 wp1부터 쌓임).
2. 상위 묶음(C:/Users/super/Developers/aside): git submodule add https://github.com/lidge-jun/aside-codemode.git aside-codemode → README 표에 행 추가 → 커밋 → push.
3. 검증: git ls-remote https://github.com/lidge-jun/aside-codemode.git HEAD 와 git ls-remote <wrapper origin> HEAD 출력을 evidence에 기록.

## 수용 기준

1. register-aside.mjs 실행 후 settings.json의 다른 최상위 키가 백업과 동일(diff로 확인, mcp.servers 납부만 변경).
2. exec 프로브 로그덤프에 execute_code 호출 이벤트 존재 (c-recognition).
3. evidence/summary.md에 baseline/after 측정치와 판정 (c-speedup).
4. 두 리모트 ls-remote 출력 (c-push).
