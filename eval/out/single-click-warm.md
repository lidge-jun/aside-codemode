# single-click — 60 runs

| path / mode | calls per run | runs | median ms (all) | median ms (ok only) | error rate | p95 ms |
|---|---|---|---|---|---|---|
| native-click / warm | 1 | 30 | 1249 | 1249 | 0.0% | 1297 |
| cm-single-item / warm | 1 | 30 | 1244 | 1244 | 0.0% | 1284 |


Went first (an even split is what the alternation is for): native-click / warm 15/30, cm-single-item / warm 15/30.

Every run, in order:

- native-click / warm: 1241, 1203, 1181, 1218, 1261, 1232, 1255, 1257, 1241, 1231, 1246, 1260, 1242, 1256, 1235, 1236, 1297, 1253, 1201, 1283, 1247, 1258, 1297, 1236, 1228, 1262, 1258, 1257, 1296, 1251 ms
  - failed: none
- cm-single-item / warm: 1232, 1242, 1284, 1243, 1261, 1197, 1267, 1270, 1244, 1244, 1210, 1256, 1256, 1237, 1221, 1236, 1287, 1229, 1245, 1261, 1241, 1253, 1209, 1276, 1237, 1256, 1191, 1253, 1250, 1229 ms
  - failed: none
