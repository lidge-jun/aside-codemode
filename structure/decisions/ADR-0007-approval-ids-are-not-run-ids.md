# ADR-0007 — decision recorded under "Acting on a page"

- Contract owner: [browse-surface.md](../browse-surface.md#acting-on-a-page)

## Decision record

- 목적과 의도: 게이트가 거부한 배치를 나중에 승인하거나 거부할 수 있게 하되, 같은 승인이 두 번 실행되거나 이미 실행된 것이 "거부됨"으로 보고되지 않게 한다.
- 기존 구현 및 제약 조건: 자식 프로세스 stdin이 `ignore`라 실행 중 일시정지·재개가 불가능하고(`spawn.js:17-27`), 호스트 전역은 실행마다 새로 만들어져서(`globals.js:1-25`) 메모리에 둔 대기 목록은 다음 tool call에 남지 않는다. `runId`는 호출마다 새 UUID다.
- 검토한 주요 대안: 메모리 Map에 대기 목록을 둔다, 같은 `runId`로 거부 봉투와 승인 실행을 잇는다, 실행 중인 REPL을 멈췄다가 깨운다, 파일 기반 저장소에 `approvalId`를 따로 발급한다.
- 선택한 방식: `os.tmpdir()` 아래 `pending`/`claimed`/`rejected` 세 디렉터리를 두고 `rename`으로 단일 소비를 보장한다. `approvalId`와 `runId`를 분리하고, 승인된 실행의 봉투가 `approvalId`를 실어 둘을 잇는다. 기본 만료 10분.
- 다른 대안 대신 이 방식을 선택한 이유: 메모리 Map은 tool call 경계를 못 넘어서 승인이라는 개념 자체가 성립하지 않는다. 같은 `runId`를 재사용하면 하나의 식별자가 상태와 항목 집합이 다른 봉투 둘을 가리키는데, `checkResultEnvelope`는 non-empty 문자열만 보므로 어떤 테스트도 그걸 못 잡는다. REPL 일시정지는 stdin이 없어 표현 자체가 불가능하다. `rename`을 고른 이유는 그것만이 원자적이기 때문이고, 실패를 전부 "누가 가져갔다"로 읽지 않는 것이 이 모듈의 핵심이다 — `ENOENT`만 "레코드가 pending을 떠났다"이고 그 외(권한·저장소 오류)는 이 프로세스의 claim 실패라는 다른 문장이다.
- 장점, 단점 및 영향: 두 번 승인해도 spawn은 한 번이고, 이미 claim된 것을 거부하려 하면 `claimed`를 그대로 답한다. 대가는 `rename`이 새 `runId`를 함께 실어 나르지 못한다는 것이다 — 승자가 그 사이에 죽으면 `runId`가 null인 claimed 레코드가 남는다. 이걸 숨기지 않고 "실행됐다도 아니고 안 됐다도 아닌 상태"로 그대로 보고한다. 그리고 이 저장소는 보안 경계가 아니다. 디렉터리에 쓸 수 있는 프로세스는 레코드를 옮길 수 있고, 그에 대한 방어는 파일시스템의 것이지 우리 것이 아니다 — `cache.js`와 파일 락이 이미 같은 자리에 서 있다.

