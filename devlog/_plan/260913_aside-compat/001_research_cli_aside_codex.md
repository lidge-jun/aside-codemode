# Research — CLI path, Aside file tools, Codex cells

No diffs in this file (LEXICO-SPLIT-01). Implementation lives in 010–060.

## 1. Working path is already CLI

`devlog/_plan/260913_codemode-server/022_phase2_pivot-cli.md:1-15` recorded the
2026-09-13 measurement: Aside 1.26.913.337 `aside exec` never spawns
`mcp.servers`. `refreshMcpTools` is on the routines path only. The shipped
workaround is `src/cli.js` + account `AGENTS.md`.

`README.md:138-140` states the same. `src/cli.js:1-4` is the one-shot surface.
`bin/codemode.mjs:1-9` resolves the CLI next to the package so a global bin
ignores the caller's cwd for *loading code*, not for *path resolution*.

Live MCP in `~/.aside/u/0/settings.json` still points at a different checkout
(`~/Developer/aside-codemode`). That is leftover. It is not how exec works.

## 2. Aside file tools the UI actually cards

Daemon native tools (Aside 1.26.913.337):

| name | args | behavior |
| --- | --- | --- |
| `read_file` | `path`, `offset?`, `limit?` | 1-indexed lines; 262144 bytes if unpaged |
| `write_file` | `file_path`, `content` | create-only; exists → error |
| `edit_file` | `path`, `appendText?`, `edits[{oldText,newText}]` | unique replacements on the original file |

UI cards key on exact `call.name`. A bash-invoked `codemode` is a **bash** card.
In-JS helpers never become file cards. Dual-path is therefore required, not a
workaround.

pi 0.83.0 has `read`/`write`/`edit` (no `apply_patch`). Aside renamed them to
`*_file`. Codex `apply_patch` is a freeform `*** Begin Patch` tool in
`121_openai-codex/codex-rs/apply-patch/src/parser.rs`. Aside has zero
`apply_patch` strings in the daemon.

## 3. Codex Code Mode (what we copy vs drop)

Copy: one JS body that calls host tools; relative paths vs a session cwd;
`apply_patch` as a string that becomes host writes; nested success `{}`.

Drop: V8 isolate, `exec`/`wait` cells, `code-mode-host` process, MCP as the
model-visible tool. Aside has no wait protocol. One bash round-trip is the
budget (`src/cli.js:86-88`).

Cwd in Codex is `Config.cwd` / `TurnEnvironment.cwd()`, not the host process
cwd of a global daemon (`121 .../core/src/config/mod.rs` around the cwd field).
That maps to CLI `--cwd` / `CODEMODE_CWD` / bash `process.cwd()`.

## 4. Current guest contract vs Aside

Today `src/sandbox.js:57-62` injects `search`, `fs`, `actions`.

`fs.read(path, {maxBytes, offset})` uses a **byte** offset (`src/host/fs.js:13-18`).
Aside `read_file.offset` is a **line**. Reusing the name `offset` without changing
semantics would page wrong.

`fs.write` overwrites (`src/host/fs.js:74-78`). Aside `write_file` is create-only.

No `--cwd` in usage (`src/cli.js:80-82`, verified 2026-09-13: usage text has
`--code` / `--config` / `--timeout-ms` / `--doctor` only).
`path.resolve(p)` in `src/paths.js:62` uses `process.cwd()`.

## 5. Open issues (lidge-jun/aside-codemode)

| # | Fix owner |
| --- | --- |
| 1 rg bypass | AGENTS template must ban `rg` by name; register writes it |
| 2 CRLF in `.sh` | `.gitattributes` `*.sh`/`*.mjs` LF, `*.ps1` CRLF |
| 3 bare `node` | templates use `process.execPath`; README same |

`scripts/register-aside.sh:3-4` still does `command -v node` then the mjs.
The mjs itself records `process.execPath` for MCP only (`scripts/register-aside.mjs:39`).
It does not write AGENTS.md today.

## 6. Verifiers run this P

| Command | Exit | Observes |
| --- | --- | --- |
| `npm test` | 0 (47 pass) | `package.json` script `node --test "test/*.test.js"` → imports `src/**` |
| `node src/cli.js --doctor` | 0 | prints roots/rg; **does not** print cwd yet |
| `node src/cli.js` (no args) | 2 | usage; no `--cwd` |
| `ls .gitattributes` | 1 | missing |
