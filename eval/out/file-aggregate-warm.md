# file-aggregate — 60 runs

| path / mode | calls per run | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |
|---|---|---|---|---|---|---|
| cli-per-file / warm | 6 | 30 | 399.5 | 399.5 | 0.0% | 404 |
| cli-one-call / warm | 1 | 30 | 82 | 82 | 0.0% | 84 |


Went first (an even split is what the alternation is for): cli-per-file / warm 15/30, cli-one-call / warm 15/30.
- cli-per-file / warm: one run split across its calls: 69 + 70 + 67 + 67 + 65 + 66 ms.

Every run, in order:

- cli-per-file / warm: 404, 406, 401, 400, 392, 394, 396, 391, 400, 396, 404, 400, 400, 399, 397, 401, 397, 397, 400, 401, 394, 396, 395, 400, 395, 401, 399, 401, 400, 399 ms
  - failed: none
- cli-one-call / warm: 81, 82, 82, 82, 82, 80, 83, 84, 81, 81, 84, 86, 83, 81, 83, 82, 82, 82, 82, 82, 81, 84, 82, 83, 83, 84, 83, 83, 81, 83 ms
  - failed: none
