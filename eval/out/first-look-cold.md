# first-look — 60 runs

| path / mode | calls per run | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |
|---|---|---|---|---|---|---|
| native-3-calls / cold +3000ms idle | 3 | 30 | 3275.5 | 3275.5 | 0.0% | 3332 |
| cm-one-session / cold +3000ms idle | 1 | 30 | 1266 | 1266 | 0.0% | 1313 |


Went first (an even split is what the alternation is for): native-3-calls / cold +3000ms idle 15/30, cm-one-session / cold +3000ms idle 15/30.
- native-3-calls / cold +3000ms idle: one run split across its calls: 787 + 1232 + 1267 ms.

Every run, in order:

- native-3-calls / cold +3000ms idle: 3288, 3268, 3176, 3332, 3286, 3284, 3234, 3279, 3261, 3240, 3229, 3199, 3244, 3292, 3274, 3303, 3264, 3247, 3281, 3290, 3277, 3249, 3333, 3258, 3322, 3223, 3282, 3301, 3264, 3277 ms
  - failed: none
- cm-one-session / cold +3000ms idle: 1258, 1301, 1271, 1263, 1270, 1244, 1200, 1277, 1085, 1302, 1301, 1241, 1274, 1240, 1241, 1291, 1266, 1300, 1246, 1322, 1225, 1306, 1251, 1237, 1266, 1254, 1278, 1292, 1313, 1170 ms
  - failed: none
