# independent-reads — 60 runs

| path / mode | calls per run | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |
|---|---|---|---|---|---|---|
| native-sequential / warm | 1 | 30 | 8413 | 8413 | 0.0% | 8484 |
| cm-batch-limit2 / warm | 1 | 30 | 4429.5 | 4429.5 | 0.0% | 4481 |


Went first (an even split is what the alternation is for): native-sequential / warm 15/30, cm-batch-limit2 / warm 15/30.

Every run, in order:

- native-sequential / warm: 8372, 8364, 8379, 8380, 8439, 8384, 8418, 8383, 8421, 8431, 8414, 8381, 8484, 8367, 8368, 8415, 8435, 8389, 8366, 8347, 8338, 8456, 8486, 8471, 8430, 8449, 8464, 8412, 8360, 8459 ms
  - failed: none
- cm-batch-limit2 / warm: 4401, 4425, 4424, 4432, 4466, 4396, 4465, 4460, 4451, 4345, 4367, 4451, 4419, 4432, 4437, 4401, 4464, 4338, 4476, 4427, 4396, 4444, 4481, 4393, 4481, 4402, 4444, 4485, 4399, 4404 ms
  - failed: none
