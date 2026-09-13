# wp5 — Cross-platform docs + eol (issue #2)

## Loop-spec (this cycle)

| Field | Content |
| --- | --- |
| Loop archetype | satisfy-spec |
| Trigger | Previous D (wp4): register is AGENTS-first; package.json is CLI-first. README.md still opens as “Code mode MCP server”. That leftover is why agents keep treating MCP as the product. |
| Goal | README.md + README.ko.md CLI-first (locked headings). `.gitattributes` LF for `.sh`. Issue #2. |
| Non-goals | src behavior change; claiming MCP works on exec |
| Verifier | `npm test` still 0 (docs not in glob). `git check-attr eol -- scripts/register-aside.sh` → `eol: lf`. First paragraph states CLI. |
| Stop | Locked heading set present; Korean README same facts after kwrite |
| Memory | this file |
| Terminal | DONE=docs CLI-first |
| Escalation | none |

## Stale check (2026-09-13 P)

- `README.md:1-12` still sells MCP/`execute_code`. `bin/README.md` is rg vendor notes, not MCP-first — leave unless it contradicts CLI.
- No `.gitattributes`. No `README.ko.md`.
- Register recipe in README still says merge `mcp.servers` as step 2 — rewrite to AGENTS-first.

## Architect dispositions (wp5)

Source: [architect](c4105067-c4b9-4da3-bf63-e1ac90973b4f). Main accepts WP5-D1–D4.

| ID | Decision | Main |
| --- | --- | --- |
| WP5-D1 | `.gitattributes` locked matrix; no history rewrite | Accept |
| WP5-D2 | README exact 12 `##` headings; locked first paragraph | Accept |
| WP5-D3 | `README.ko.md` same headings + facts; kwrite after draft | Accept |
| WP5-D4 | `## Future: MCP` last only | Accept |

Config facts from `README.md:94-110` + `src/config.js`, not the stale later Config. `bin/README.md` leave. Korean H1 stays `aside-codemode`.

## IN / OUT

IN: `.gitattributes` (NEW), `README.md` (MODIFY), `README.ko.md` (NEW), `bin/README.md` if it still says MCP-first.
OUT: new docs/ folder, changing skill text in parent repos.

## NEW `.gitattributes`

```
* text=auto
*.sh text eol=lf
*.mjs text eol=lf
*.js text eol=lf
*.md text eol=lf
*.json text eol=lf
*.ps1 text eol=crlf
*.exe binary
```

Issue #2: Windows checkout must not turn `scripts/register-aside.sh` into CRLF.

## MODIFY `README.md` — rewrite the **whole file**

Acceptance: exactly these 12 unfenced `##` headings, no others. Delete leftover `## Install…`, `## Register with Aside as MCP`, `## Configuration`. PATH `codemode` is operator-only; the agent recipe is abs `process.execPath` + abs `bin/codemode.mjs` (template shape). Trust model says `--code` / guest JS, not `execute_code`. `npm test` → 86 pass / exit 0. Heading lock: `rg -n '^## ' README.md README.ko.md`.

## MODIFY `README.md` — locked first paragraph (was “replace 1-188”; that range is withdrawn)

Locked first paragraph (English):

> Aside exec does not attach MCP servers on current builds. The working path is one `bash` call to the `codemode` CLI plus a rule in `~/.aside/u/0/AGENTS.md`. File cards in the Aside UI still come from native `read_file` / `write_file` / `edit_file`. Guest JavaScript uses those same shapes.

Then sections, in order, with these exact headings:

1. `## Requirements` — Node >= 18, rg on PATH or `CODEMODE_RG` / vendored `bin/rg.exe` on Windows.
2. `## Global install` — `npm install -g .` ; `codemode --doctor` ; if Aside sets `NPM_CONFIG_PREFIX`, `--prefix` note (keep existing measured warning `README.md:86-92`).
3. `## Project cwd` — `--cwd` > `CODEMODE_CWD` > `process.cwd()`; child agents pass `--cwd`.
4. `## Guest API` — table: `search.files|content|count`, `read_file`, `write_file`, `edit_file`, `apply_patch`, compound `fs.*`, `actions.*`. `read_file.offset` is **lines**. `write_file` create-only (`wx`). `apply_patch` is a guest helper, not an AGENTS verb. Keep gitignore / global `max` / truncated notes.
5. `## Dual path` — native tools for cards; CLI = bash card; never `rg` / `find` / `grep` / Get-ChildItem -Recurse. Agent call: `{{NODE}} {{CLI}} --code` with absolute paths (operator may use PATH `codemode` after `npm install -g`).
6. `## Register` — `node scripts/register-aside.mjs` writes AGENTS markers with `process.execPath`; does not require MCP. Show one abs-node + abs-cli example.
7. `## macOS` — brew rg; ignore `rg.exe`; noninteractive PATH → printed execPath (issue #3).
8. `## Windows` — `bin/rg.exe`; `register-aside.ps1`; `.gitattributes` keeps `.sh` LF.
9. `## Config` — precedence including `~/.config/codemode/config.json`.
10. `## Trust model` — keep `README.md:244-250` substance.
11. `## Development` — `npm test`.
12. `## Future: MCP` — one short paragraph + existing JSON example. Not the install path.

`package.json` `description` is already rewritten in wp4 to drop “MCP server”. wp5 does not reopen it.

Korean: `README.ko.md` mirrors this heading set. kwrite after draft.

## NEW `README.ko.md`

Same facts as README.md. Audience: the operator who already uses Aside.
두괄식. After draft, run kwrite (S1–S4): no 번역투, no 첫째/둘째, no 또한/한편 stacking, no 기대된다 closer.
Do not invent features. Proper nouns: Aside, Codex, Code Mode, ripgrep, AGENTS.md stay.

## MODIFY `bin/README.md` only if it contradicts CLI-first (read at B; patch if needed).

Verifier: `npm test` still 0 (docs are not in the test glob). Human/read: README first paragraph states CLI. `git check-attr eol -- scripts/register-aside.sh` after attributes exist shows `eol: lf`.

Conditional: a `.sh` with CRLF — after attributes + renormalize, `file` says "ASCII text" not "CRLF". Renormalize is `git add --renormalize` in B if needed; do not rewrite history.
