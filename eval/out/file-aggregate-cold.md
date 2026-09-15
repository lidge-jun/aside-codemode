# file-aggregate — 60 runs

| path / mode | calls per run | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |
|---|---|---|---|---|---|---|
| cli-per-file / cold +1000ms idle | 6 | 30 | 433 | 433 | 0.0% | 439 |
| cli-one-call / cold +1000ms idle | 1 | 30 | 115 | 115 | 0.0% | 119 |


Went first (an even split is what the alternation is for): cli-per-file / cold +1000ms idle 15/30, cli-one-call / cold +1000ms idle 15/30.
- cli-per-file / cold +1000ms idle: one run split across its calls: 98 + 66 + 66 + 65 + 67 + 66 ms.

Every run, in order:

- cli-per-file / cold +1000ms idle: 428, 433, 435, 430, 436, 433, 435, 434, 436, 440, 432, 431, 429, 430, 434, 433, 400, 429, 427, 435, 430, 435, 439, 438, 436, 434, 427, 420, 420, 426 ms
  - failed: none
- cli-one-call / cold +1000ms idle: 119, 116, 113, 114, 109, 119, 113, 114, 112, 117, 114, 115, 113, 119, 115, 111, 112, 111, 115, 118, 111, 117, 116, 116, 117, 117, 116, 115, 116, 115 ms
  - failed: none
