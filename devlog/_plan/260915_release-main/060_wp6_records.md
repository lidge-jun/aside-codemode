# 060 — wp6: 출시 기록 4종 (감사 1차 반영본)

로드맵이 요구한 네 기록을 `evidence/release-260915/` 아래 산출물로 만든다.

| 산출물 | 담을 내용 |
|---|---|
| `release-manifest.json` | commit, artifact sha256, **패키지 버전과 helper 버전을 따로**, 지원 OS·Node·Aside 범위 |
| `capability-receipt.json` | 표면(CLI repl / 앱 에이전트 REPL) 구분, lastVerified, 산 호출 결과, 미검증 항목의 이름 |
| `operating-notes.md` | 경로 선택, 오류 상태 읽는 법, 인증 승인, 수집하는 로그 |
| `recovery.md` | 이전 artifact 위치, 사용자 설정 백업 경로, 되돌릴 managed docs, 재검증 명령 |

## 순서가 중요하다

`recovery.md`가 가리켜야 할 "이전 artifact"는 라이브 upgrade가 지나가면 설치기 안에
없다. 그래서 **백업과 복구 초안은 wp3의 라이브 변이보다 먼저** 만든다. wp6에서는 그
초안을 실제 경로와 해시로 채워 완성한다.

## 버전 문자열을 섞지 않는다

helper 버전(1.0.0 → 1.1.0)과 패키지 버전(0.1.0 → 0.2.0)은 다른 축이다. 기록에는 둘과
sha256을 따로 적는다. 버전 문자열 하나로는 구 artifact를 가리킬 수 없다.

## 통과 조건

네 파일이 존재하고, manifest의 sha256이 세 기기에 설치된 실제 바이트와 같고, receipt의
미검증 항목이 빈칸이 아니라 이름으로 적혀 있다.
