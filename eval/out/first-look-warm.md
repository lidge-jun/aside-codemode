# first-look — 60 runs

| path / mode | calls per run | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |
|---|---|---|---|---|---|---|
| native-3-calls / warm | 3 | 30 | 3257 | 3257 | 0.0% | 3343 |
| cm-one-session / warm | 1 | 30 | 1249 | 1249 | 0.0% | 1303 |


Went first (an even split is what the alternation is for): native-3-calls / warm 15/30, cm-one-session / warm 15/30.
- native-3-calls / warm: one run split across its calls: 744 + 1231 + 1213 ms.

Every run, in order:

- native-3-calls / warm: 3189, 3281, 3330, 3302, 3224, 3248, 3213, 3298, 3209, 3242, 3256, 3225, 3310, 3343, 3065, 3360, 3220, 3282, 3322, 3242, 3111, 3258, 3321, 3097, 3267, 3263, 3213, 3288, 3217, 3332 ms
  - failed: none
- cm-one-session / warm: 1230, 1095, 1225, 1252, 1238, 1289, 1289, 1298, 1240, 1260, 1251, 1238, 1243, 1298, 1124, 1245, 1116, 1276, 1222, 1241, 1297, 1247, 1248, 1215, 1250, 1304, 1270, 1303, 1294, 1250 ms
  - failed: none
