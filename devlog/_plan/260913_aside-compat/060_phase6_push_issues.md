# wp6 — Push and close issues

## Loop-spec

| Field | Content |
| --- | --- |
| Loop archetype | satisfy-spec |
| Trigger | Previous D (wp5): README is CLI-first. Remaining: commit (do not add `.codexclaw/`), `git push origin HEAD`, close #1 #2 #3. |
| Goal | origin HEAD matches local; issues #1 #2 #3 closed with proof. |
| Non-goals | parent `new` push; force-push; npm publish |
| Verifier | `npm test` exit 0; `git ls-remote origin HEAD`; `gh issue view {1,2,3} --json state` |
| Stop | c-4 and c-5 met |
| Memory | this file |
| Terminal | DONE=pushed+closed / BLOCKED=push denied |
| Escalation | push auth failure |

## IN / OUT

IN: create four commits C1–C4 on dirty `b8b15ac`, then `git push origin HEAD`, then `gh issue close` **after** origin SHA matches.
OUT: parent `new` repo push, force-push, npm publish, staging `.codexclaw/`, `Fixes`/`Closes`/`Resolves` in commit messages.

## Architect dispositions

Source: [architect](cc5bc8d3-e54c-44a4-bc6b-09dba9f21c5f). Main accepts WP6-D1–D9.

## Commit table (C1–C4)

| Id | Message | Paths |
| --- | --- | --- |
| C1 | `feat: add cwd, Aside file API, and apply_patch to the CLI guest` | `src/host/cwd.js` `src/host/patch.js` `src/host/fs.js` `src/host/actions.js` `src/paths.js` `src/cli.js` `src/sandbox.js` `src/server.js` `src/tools.js` `test/cwd.test.js` `test/aside-files.test.js` `test/patch.test.js` |
| C2 | `feat: register AGENTS with absolute node and an rg ban` | `src/register.js` `templates/AGENTS.codemode.md` `scripts/register-aside.mjs` `scripts/register-aside.sh` `package.json` `test/register.test.js` |
| C3 | `docs: make README CLI-first and lock shell scripts to LF` | `README.md` `README.ko.md` `.gitattributes` |
| C4 | `docs(plan): record the aside-compat CLI-first decade` | `devlog/_plan/260913_aside-compat/` |

This-repo style (`feat:` / `docs:`). No `[agent]`. No magic close keywords. Pathspec-exclude `.codexclaw/`.

## Steps (locked order)

1. `npm test` on the dirty tree (sanity).
2. Create C1, `npm test`. Create C2, `npm test`. Create C3. Create C4.
3. `npm test` on that HEAD (this line is close-comment proof, not a dirty-tree receipt).
4. Confirm `git status` leftover is only `?? .codexclaw/`.
5. `git push origin HEAD` (user authorized). No `--force`.
6. `git rev-parse HEAD` == `git ls-remote origin HEAD`.
7. `gh issue close` #1 (C2 + E8 honesty: prompt only), #2 (C3 + `git check-attr eol -- scripts/register-aside.sh` → `eol: lf`; no live Windows), #3 (C2+C3 abs node in template and README). Origin commit URLs. No `.codexclaw/` paths.
8. `gh issue view {1,2,3} --json state` → CLOSED.

## Verifier

`npm test` after C4. `git ls-remote origin HEAD` matches local HEAD. `gh issue view 1 --json state` → CLOSED (same 2, 3).

No *new* product code in this phase; C1–C3 only land already-built wp1–wp5.
