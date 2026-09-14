# single-click — 60 runs

| path / mode | calls per run | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |
|---|---|---|---|---|---|---|
| native-click / cold +3000ms idle | 1 | 30 | 1266.5 | 1266.5 | 0.0% | 1316 |
| cm-single-item / cold +3000ms idle | 1 | 30 | 1263.5 | 1263.5 | 0.0% | 1311 |


Went first (an even split is what the alternation is for): native-click / cold +3000ms idle 15/30, cm-single-item / cold +3000ms idle 15/30.

Every run, in order:

- native-click / cold +3000ms idle: 1265, 1310, 1240, 1174, 1266, 1309, 1267, 1308, 1264, 1273, 1263, 1278, 1146, 1269, 1259, 1259, 1236, 1256, 1298, 1316, 1271, 1247, 1306, 1275, 1276, 1250, 1255, 1322, 1228, 1272 ms
  - failed: none
- cm-single-item / cold +3000ms idle: 1274, 1249, 1256, 1270, 1272, 1292, 1306, 1290, 1321, 1250, 1221, 1242, 1243, 1255, 1248, 1259, 1244, 1266, 1207, 1235, 1263, 1255, 1264, 1258, 1311, 1280, 1287, 1303, 1273, 1266 ms
  - failed: none
