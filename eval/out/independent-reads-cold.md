# independent-reads — 60 runs

| path / mode | calls per run | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |
|---|---|---|---|---|---|---|
| native-sequential / cold +3000ms idle | 1 | 30 | 8441 | 8441 | 0.0% | 8526 |
| cm-batch-limit2 / cold +3000ms idle | 1 | 30 | 4414 | 4414 | 0.0% | 4506 |


Went first (an even split is what the alternation is for): native-sequential / cold +3000ms idle 15/30, cm-batch-limit2 / cold +3000ms idle 15/30.

Every run, in order:

- native-sequential / cold +3000ms idle: 8415, 8422, 8415, 8369, 8363, 8486, 8445, 8417, 8392, 8401, 8421, 8403, 8499, 8405, 8452, 8437, 8434, 8447, 8477, 8485, 8526, 8456, 8464, 8494, 8526, 8531, 8405, 8429, 8491, 8454 ms
  - failed: none
- cm-batch-limit2 / cold +3000ms idle: 4397, 4413, 4495, 4468, 4411, 4485, 4602, 4373, 4353, 4372, 4454, 4395, 4381, 4434, 4386, 4506, 4353, 4477, 4487, 4401, 4399, 4490, 4415, 4454, 4391, 4467, 4398, 4492, 4475, 4353 ms
  - failed: none
