# 080 — w9: 0.3.0

v0.2.0과 같은 순서다. 버전 bump 커밋을 release head로 만들고, 그 정확한 SHA에서 CI 다섯
조합을 확인하고, dev를 거쳐 main에 병합한 뒤 그 SHA에 태그를 붙이고 release를 만든다.
cancel-in-progress 때문에 마지막 SHA의 취소되지 않은 run만 센다.

더할 것: 세 기기 재설치와 재검증. helper 바이트가 바뀌면 HELPER_VERSION도 올린다. 출시
기록 넷을 다시 뽑고, 이번 릴리즈가 고친 마찰과 여전히 미측정인 것을 릴리즈 본문에 적는다.

G5는 여전히 돌리지 않는다. 그 문장을 그대로 유지한다.
