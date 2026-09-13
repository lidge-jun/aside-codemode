# 021 — A synthesis (REVIEW-SYNTHESIS-01)

Reviewer: [A-wp1](e41b414c-24fa-44ee-a034-366b1192e51c)
Round 1: `VERDICT: GO-WITH-FIXES (blockers=1)`

## Blocker 1 High — ACCEPT

Root cause: Stop/DONE/Verifier treated mini Git bash doctor/search as #5 proof. That path is already green with `windowsHide: true`. Helper-only tests stay green if B never wires the three call sites. `npm test` today does not read `src/rg.js:73,98` or `src/rg-stream.js:69`.

Disposition: fold, do not rebut.
- Stop/DONE cannot close on mini-only.
- `test/windows-hide.test.js` reads those two source files and forbids `windowsHide: true`.
- Verifier sentence rewritten (PLAN-VERIFIER-REAL-01).
- Test 1 uses env `{}`.
- Bypass wording downgrade: no.

WINHIDE-D1–D9 unchanged → no architect recheck.

## Residuals

- Opt-in `'1'` restores broken hide — keep, named.
- Mini Aside spawn table (2026-09-14): hide/nohide/execHide all 0. Nested `--doctor` still to run.
