# 011 — wp2 delivered: what shipped and what the next phases can now assume

커밋 de15b1a. [010](010_wp2_result_contract.md)의 계약이 실제 코드가 된 상태를 적는다. 다음 phase는 이 문서의 전제 위에서 시작한다.

## 계획과 달라진 것

- **`runStatus`에 `extras`가 생겼다.** 중복 `jobId`나 발행한 적 없는 `jobId`가 돌아오면 요청이 전부 답을 받은 것처럼 보여도
  `completed`를 주지 않는다. 010에는 없던 규칙이고, 감사에서 나왔다.
- **중복 `jobId`는 첫 결과가 이긴다.** `Map.set`은 마지막 값을 남겨 실제 관측 하나를 버렸다. 이제 나중 것은 `extraItems`로 보존하고
  `partial`에 `duplicate-jobid`가 붙는다.
- **`capture.js`를 한 군데 손댔다.** wp3가 조인을 바꾸기 전이라도, 아티팩트 검증이 실패한 항목이 `status:'completed'` 안에 앉아 있는
  envelope를 내보낼 수는 없다. `item.status`를 함께 내리고 run status를 다시 계산한다. 인덱스 조인 자체는 wp3가 바꾼다.

## 다음 phase가 기대해도 되는 것

- `res.ledger`는 `{ jobId, url, index }` 배열로 **항상** 나온다. host-kill 경로도 그렇다.
  그래서 [020](020_wp3_capture_provenance.md)의 `ECONTRACT`는 실행 경로가 아니라 계약 방어선이고, stub로만 발동한다.
- `item.jobId`와 `item.status`는 아홉 개 결과 경로 전부에 있다. VM에서 실제로 실행해 확인했다
  (성공, 동기 EOPEN, 비동기 EOPEN, ESKIP, EBLOCKED, EUNRENDERED, 일반 catch, ETABBUDGET).
- `JOB.runId`가 생성 스크립트 payload에 있고 소비자는 아직 없다. [030](030_wp4_effect_lifecycle.md)이 `operationId` 합성에 쓴다.
- `effects: []` 슬롯과 `runStatus`의 effect 규칙이 이미 있다. wp4는 `parseEffects`/`settleEffects`만 채우면 된다.

## 감사에서 배운 것

테스트가 통과한다는 사실만으로는 무엇도 증명되지 않았다. 첫 12개 테스트는 `script.js`의 `jobId`를 전부 지워도 통과했다.
가짜 stdout이 이미 id를 달고 있었기 때문이다. 지금은 생성 스크립트를 VM에서 돌려 각 분기의 결과를 직접 읽는다.
같은 이유로 기존 하네스 두 곳의 `openTab`이 `async`였다는 것도 드러났다. 동기 throw를 시험한다고 적힌 테스트가
실제로는 rejected promise를 시험하고 있었다. 둘 다 일반 함수로 바꿨다.
