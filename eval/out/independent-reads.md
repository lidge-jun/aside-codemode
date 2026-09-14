# independent-reads — 20 runs

| path | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |
|---|---|---|---|---|---|
| native-sequential | 10 | 8420.5 | 8420.5 | 0.0% | not computed |
| cm-batch-limit2 | 10 | 4441 | 4441 | 0.0% | not computed |

- native-sequential: p95 not computed: 10 samples, under the 30 this report requires.
- cm-batch-limit2: p95 not computed: 10 samples, under the 30 this report requires.

Every run, in order:

- native-sequential: 8390, 8418, 8532, 8493, 8466, 8351, 8397, 8403, 8423, 8546 ms
- cm-batch-limit2: 4412, 4467, 4420, 4463, 4467, 4389, 4343, 4428, 4479, 4454 ms
