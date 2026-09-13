# wp4 — Register + AGENTS templates (issues #1 #3)

Success path: after register, `~/.aside/u/0/AGENTS.md` tells the agent to call
**this** checkout's CLI with an **absolute node**, and forbids `rg` by name.

## Loop-spec (this cycle)

| Field | Content |
| --- | --- |
| Loop archetype | satisfy-spec |
| Trigger | Previous D (wp3): CLI guest `apply_patch` shipped. Direction unchanged: CLI + AGENTS is the product. MCP must not gate register. |
| Goal | `applyRegister` writes AGENTS with `process.execPath` + this repo CLI; missing `settings.json` is `{ok:true,settingsOk:false}` exit 0. Issues #1 #3. `package.json` description is CLI-first. |
| Non-goals | Claiming MCP spawn; editing accounts.json; README rewrite (wp5); live write to the real `~/.aside` in tests |
| Verifier | `npm test` glob includes `test/register.test.js`. Cases 1–5 + empty ASIDE_HOME activation. |
| Stop | Locked tests 1–7 + description no longer says “MCP server” |
| Memory | this file |
| Terminal | DONE=AGENTS-first register / UNSAFE=AGENTS write fail |
| Escalation | two dispatch fails → main implements |

HOTL bounds: this repo + tests using temp ASIDE_HOME only.

## Stale check (2026-09-13 P)

- `scripts/register-aside.mjs` still exits 2 when settings.json is missing (`scripts/register-aside.mjs:14-17`). That is the bug 040 replaces.
- No `src/register.js`, no `templates/AGENTS.codemode.md`.
- `package.json:4` still says “Code mode MCP server”.
- `src/config.js:86-88` already exports `userConfigPath`.
- `{{CLI}}` = `bin/codemode.mjs` (absolute under repoRoot).
- Marker replace: if `<!-- aside-codemode:start -->`…`<!-- aside-codemode:end -->` exists, replace that span; else append.
- MCP merge is leftover hygiene. Success of this cycle is AGENTS + absolute node, not `tools/list`.

## Architect dispositions (wp4)

Source: [architect](beb7f04c-7c09-4a8f-a82c-4a25d4863225). Main accepts WP4-D1–D6.

| ID | Decision | Main |
| --- | --- | --- |
| WP4-D1 | `src/register.js` `applyRegister`; `ok` = AGENTS wrote only | Accept |
| WP4-D2 | Marker upsert; `{{CLI}}` = `bin/codemode.mjs`; start-without-end → replace to EOF | Accept |
| WP4-D3 | User config via **injected** `userConfigPath({XDG_CONFIG_HOME}, homedir)`; repo EACCES continue | Accept |
| WP4-D4 | MCP try/catch after AGENTS; never gates `ok` | Accept |
| WP4-D5 | Locked package.json description + files | Accept |
| WP4-D6 | Tests pass temp `asideHome`/`homedir`/`xdgConfigHome` **and temp `repoRoot`** with a copied template | Accept |

Folds: `{{CWD_HINT}}` is the prose `--cwd <abs-project>` (not `process.cwd()` at register time). Wrapper prints JSON; may stderr.warn `settingsError`. User-config write fail continues to AGENTS. `README.ko.md` listed in `files` even if wp5 creates the file.

## IN / OUT

IN: `templates/AGENTS.codemode.md` (NEW), `src/register.js` (NEW, extract write logic), `scripts/register-aside.mjs` (thin CLI), `scripts/register-aside.sh`, `package.json` `files` (+ `templates/`), `src/config.js` / register so machine config is also written to `userConfigPath()` (`~/.config/codemode/config.json`), `test/register.test.js` (NEW) with temp `ASIDE_HOME` + temp `XDG_CONFIG_HOME`.
OUT: claiming MCP spawn; editing accounts.json; u1+ unless `ASIDE_HOME` is set.

## NEW `templates/AGENTS.codemode.md`

Placeholders: `{{NODE}}`, `{{CLI}}`, `{{CWD_HINT}}`.

Korean+English mix is OK (current README rule is Korean). Required clauses:

- 로컬 검색/다파일 읽기는 `rg` / `find` / `grep` / Get-ChildItem -Recurse 직접 호출 금지. `{{NODE}} {{CLI}} --code '...'` 한 번.
- 코드는 async 함수 본문. `search.*`, `read_file({path,offset?,limit?})`, compound `fs.*`.
- 화면에 파일 카드가 필요하면 네이티브 `read_file` / `write_file` / `edit_file` (스키마 동일). CLI 호출은 bash 카드다.
- 프로젝트에서 상대경로: `--cwd <abs-project>` 또는 그 디렉터리에서 실행.
- `node` 나 `codemode` PATH 의존 금지. 항상 `{{NODE}}`.

## Locked register order (MCP must not gate AGENTS)

`src/register.js` exports `applyRegister({ asideHome, repoRoot, execPath, homedir, xdgConfigHome })` returning `{ ok, agentsPath, node, cli, settingsOk, settingsError, userConfigPath }`.

Order (locked):

1. Resolve `userPath = userConfigPath({ XDG_CONFIG_HOME: xdgConfigHome }, homedir)` — **never** the bare `userConfigPath()` (that reads live env/home). `mkdirSync(path.dirname(userPath), { recursive: true })` then write/merge **user** config with `roots: [homedir, accountRoot-if-outside]` and platform rgPath rules. User-config write fail continues to AGENTS (`ok` stays AGENTS-gated). Also write `repoRoot/codemode.config.json` when writable; if EACCES, continue.
2. `mkdirSync(accountRoot, { recursive: true })`. Render + write `AGENTS.md` markers. **Does not** require `settings.json`. If start marker exists without end, replace from start to EOF. Else if both exist, replace the span. Else append.
3. **Try** MCP merge: if `settings.json` missing/unreadable, set `settingsOk:false` and `settingsError`, do **not** exit 2. Print warning. Exit 0 if AGENTS wrote.
4. Exit 2 only if AGENTS write failed.

`scripts/register-aside.mjs` becomes:

```js
import { applyRegister } from '../src/register.js';
const r = applyRegister({
  asideHome: process.env.ASIDE_HOME ?? path.join(os.homedir(), '.aside'),
  repoRoot: (process.env.CODEMODE_REPO_ROOT && process.env.CODEMODE_REPO_ROOT.length)
    ? process.env.CODEMODE_REPO_ROOT
    : repoRoot,
  execPath: process.execPath,
  homedir: os.homedir(),
  xdgConfigHome: process.env.XDG_CONFIG_HOME,
});
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 2);
```

MCP merge, when settings exist, keeps backup-first + retarget to this repo (hygiene). Failure after backup is still non-fatal for AGENTS (`settingsOk:false`).

## MODIFY `package.json`

`description` (`package.json:4`) after:

```
"CLI code mode for the Aside agent: one `codemode --code` guest with Aside-shaped file tools and rg-backed search"
```

`files` after (`package.json:16-22`):

```json
  "files": [
    "bin/",
    "src/",
    "scripts/",
    "templates/",
    "codemode.config.example.json",
    "README.md",
    "README.ko.md"
  ]
```

`templates/` must ship in the tarball so global install can render AGENTS.

## MODIFY `scripts/register-aside.sh`

Today (`scripts/register-aside.sh:3-4`):

```sh
NODE_BIN="$(command -v node)"
"$NODE_BIN" "$(dirname "$0")/register-aside.mjs"
```

After: prefer the node that is already running if invoked as `node scripts/register-aside.mjs`. The sh wrapper should use `command -v node` only as last resort, but document that `node /abs/register-aside.mjs` is the safe form. Better:

```sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${NODE:-}" ] && [ -x "$NODE" ]; then
  exec "$NODE" "$SCRIPT_DIR/register-aside.mjs"
fi
NODE_BIN=$(command -v node) || { echo "node not on PATH; run: /abs/node $SCRIPT_DIR/register-aside.mjs" >&2; exit 1; }
exec "$NODE_BIN" "$SCRIPT_DIR/register-aside.mjs"
```

`.ps1` already hardcodes `C:/nvm4w/nodejs/node.exe` then Get-Command (`scripts/register-aside.ps1:2-4`) — keep.

## NEW `test/register.test.js`

Import `applyRegister` from `src/register.js` only (mjs is a thin wrapper). Never touch the real `~/.aside` or this checkout’s `codemode.config.json`.

Each case builds a **temp `repoRoot`** that contains a copy of `templates/AGENTS.codemode.md` (and optional example config). Pass that as `repoRoot` plus temp `asideHome`, `homedir`, `xdgConfigHome`.

Cases (locked):
1. Temp `asideHome` **without** `settings.json`. `applyRegister` mkdirs `u/0` then writes `AGENTS.md`. Return `{ ok: true, settingsOk: false }`. Thin CLI would exit 0.
2. Second call does not duplicate `<!-- aside-codemode:start -->` markers.
3. Rendered AGENTS contains `execPath` and the word `` `rg` `` as banned.
4. With a settings.json present, `settingsOk: true` and MCP server retargeted; AGENTS still written. `ok` stays true even if you ignore `settingsOk`.
5. Fresh temp `xdgConfigHome` (no `codemode` dir) → user config file exists after register.

6. **Thin CLI product proof:** copy template into a **temp `repoRoot`**. `spawnSync(process.execPath, [abs register-aside.mjs], { env: { ...process.env, ASIDE_HOME: tempEmpty, XDG_CONFIG_HOME: tempXdg, HOME: tempHome, CODEMODE_REPO_ROOT: tempRepo } })`. `status === 0`. stdout JSON `{ok:true, settingsOk:false}`. Temp `AGENTS.md` exists. Checkout `codemode.config.json` mtime/content unchanged. `applyRegister` never `process.exit`.
7. Case 5 also: `assert.equal(r.userConfigPath, userConfigPath({ XDG_CONFIG_HOME: tempXdg }, tempHome))` and that path is under the temp xdg/home, **not** `os.homedir()`.

Never touch: live `~/.aside`, checkout `codemode.config.json`, live `~/.config/codemode/config.json`.

Conditional (C-ACTIVATION): empty `asideHome` (no `u/0`, no settings) → mkdir + AGENTS + `{ok:true,settingsOk:false}`. Missing settings is **not** `ok:false`. Observed by case 1 + case 6.

## Field chain (PLAN-FIELD-CHAIN-01)

| Value | Create | Serialize | Deserialize | Consumers |
| --- | --- | --- | --- | --- |
| `ok` | AGENTS write success only | wrapper JSON | N/A stdout | `process.exit(r.ok ? 0 : 2)` in mjs **only**. Never `settingsOk`. |
| `settingsOk` / `settingsError` | MCP try after AGENTS | JSON | N/A | hygiene / stderr.warn. Must not feed `ok` or exit. |
| `node` / `cli` | `execPath` / `path.join(repoRoot,'bin/codemode.mjs')` | AGENTS + JSON | N/A | template `{{NODE}}` `{{CLI}}` |
| `{{CWD_HINT}}` | prose `--cwd <abs-project>` | template | N/A | AGENTS text. Not `process.cwd()` at register. |
| user-config `roots` / `rgPath` | `applyRegister` merge | `userPath` JSON | `loadConfig` `apply()` | roots allowlist / rg resolver |
