# 060 — wp6: 백업·복구 초안과 출시 기록 4종 (감사 2차 반영본)

## wp6a — 라이브를 건드리기 전에

백업은 **checkout 밖**에 둔다. `evidence/`는 추적되는 경로라서 계정 지침이나 개인
데이터가 커밋될 수 있다. 백업 위치는 `~/aside-codemode-backup-260915/`이고, 저장소에는
경로·파일 목록·sha256과 한 줄 요약만 남긴다.

백업 대상: mac u/0·u/1·u/2와 mini u/0의 `codemode/`, `skills/user/aside-codemode/`,
`AGENTS.md`.

같은 단계에서 `recovery.md` 초안을 만든다. 라이브 변이 뒤에 쓰면 무엇을 되돌려야 하는지
가리킬 대상이 이미 바뀐 뒤다.

## 외부 백업이 필요한 진짜 이유

스냅샷 순서를 고치면 구 바이트는 `manifest.previous`에 남는다. 그런데도 외부 백업이
필요한 이유는 다르다 — uninstall이 그 manifest 자체를 지우고, rollback이 사용자 수정을
검사 없이 덮으며, 설치기에 backup/rename이 없기 때문이다.

## wp6 — 네 기록

| 산출물 | 담을 내용 |
|---|---|
| `release-manifest.json` | commit, artifact sha256, **패키지 버전과 helper 버전을 따로**, 지원 OS·Node·Aside 범위 |
| `capability-receipt.json` | 표면(CLI repl / 앱 에이전트 REPL) 구분, lastVerified, 산 호출 결과, 미검증 항목의 이름 |
| `operating-notes.md` | 경로 선택, 오류 상태 읽는 법, 인증 승인, 수집하는 로그 |
| `recovery.md` | 백업 경로와 해시, 되돌릴 managed docs, 재검증 명령, rollback을 쓰면 안 되는 조건 |

helper 버전(1.0.0 → 1.1.0)과 패키지 버전(0.1.0 → 0.2.0)은 다른 축이다. 기록에는 둘과
sha256을 따로 적는다.

## 통과 조건

네 파일이 존재하고, manifest의 sha256이 세 기기에 설치된 실제 바이트와 같고, receipt의
미검증 항목이 빈칸이 아니라 이름으로 적혀 있다.
