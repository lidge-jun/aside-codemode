# 040 — wp4: 세 기기 카나리아 (감사 1차 반영본)

## 사전 진단 (2026-09-15 실측)

| 기기 | 계정 루트 | Node | Aside | 저장소 |
|---|---|---|---|---|
| MacBook | `~/.aside/u/{0,1,2}`, current=0 | `~/.nvm/.../v24.17.0` | `~/.local/bin/aside` | `~/aside-codemode` |
| Windows MINI | `~/.aside/u/0` | `C:\\nvm4w\\nodejs` v24.16.0 | `AppData\\Local\\Aside\\CLI\\current` | `~/Developers/aside-codemode` |
| macmini-cf | `~/.aside/u/{0..6}`, **current=1** | `~/.nvm/.../v24.20.0` (PATH에 없음) | `~/.local/bin/aside` | **없음, 새로 받아야 함** |

macmini-cf가 이 단계의 진짜 시험이다. 계정이 일곱이고 현재 계정이 `u/0`이 아니다.
설치기가 `u/0`을 가정하지 않고 `currentAccountId`를 따라가는지가 여기서 드러난다.
비대화형 ssh의 PATH에 node가 없으므로 절대 경로로 호출한다.

## 통과 조건

세 기기가 같은 커밋을 쓰고, 설치된 `codemode/cm.js`의 sha256이 **계정별로** 기록되며 wp8
이후의 같은 값을 갖고, 각 기기 doctor가 manifest 일치와 블록 current를 보고하고,
`browse.probe()`가 그 기계의 실제 Aside 실행 파일을 해석한다. 해시 표는 기기가 아니라
계정 루트 단위로 적는다.

## macmini-cf에서 바뀌는 것과 안 바뀌는 것

첫 설치는 계정 루트의 `AGENTS.md`에 관리 블록을 넣고 `skills/user/aside-codemode/`를
만든다. 그건 설치의 정의라서 "아무것도 안 바꾼다"고 말할 수 없다. 바꾸지 않는 것은
사용자의 대화, `settings.json`, `credentials.json`, 다른 스킬, 그리고 설치가 소유하지
않은 파일이다. 어느 계정에 설치할지는 `currentAccountId`를 따르고, 나머지 여섯 계정은
열지 않는다.
