# aside-codemode

Aside exec does not attach MCP servers on current builds. The working path is one `bash` call to the `codemode` CLI plus a rule in `~/.aside/u/0/AGENTS.md`. File cards in the Aside UI still come from native `read_file` / `write_file` / `edit_file`. Guest JavaScript uses those same shapes.

## Requirements

- Node.js >= 18
- ripgrep (`rg`) on PATH, or `CODEMODE_RG` / `rgPath`. Windows may use vendored `bin/rg.exe`
- macOS and Windows

## Global install

```sh
git clone https://github.com/lidge-jun/aside-codemode.git
cd aside-codemode
npm install -g .        # or: npm link
codemode --doctor
```

`codemode` on PATH is for **you** (the operator). Aside agents must not look up `node` or `codemode` on PATH. They call the absolute pair written by register (`process.execPath` + this clone's `bin/codemode.mjs`).

```sh
codemode --code "return (await search.files({ path: '/Users/me/proj', glob: '**/*.ts' })).length"
codemode --doctor
```

If `npm prefix -g` is not on PATH (Aside sets `NPM_CONFIG_PREFIX`, which wins over the default), install with an explicit prefix:

```sh
npm install -g --prefix=/opt/homebrew .
```

## Project cwd

Resolution order: `--cwd <abs>` > `CODEMODE_CWD` > `process.cwd()`. Relative guest paths resolve against that directory. Child agents should pass `--cwd` to the project they are editing. A missing `--cwd` flag is not an error; a `--cwd` with no directory is `{ok:false,error:"--cwd requires a directory path"}`.

## Guest API

Code is an async function body. `return` is the answer. Nothing else exists in the sandbox: no `require`, `process`, `fetch`, or network.

| Name | Role |
| --- | --- |
| `search.files` / `search.content` / `search.count` | ripgrep-backed list, content, pre-flight counts |
| `read_file({ path, offset?, limit? })` | Aside-shaped read. `offset` / `limit` are 1-indexed **lines**. Unpaged reads over 262144 bytes throw |
| `write_file({ file_path, content })` | Aside-shaped create-only (`wx`). Overwrite throws |
| `edit_file({ path, appendText?, edits })` | Unique `oldText` → `newText` on the original file |
| `apply_patch(text)` | Guest helper. Codex `*** Begin Patch` text → `write_file` / `edit_file`. Success `{}`. Not an AGENTS verb |
| `fs.readMany` / `grepFile` / `mkdir` / `stat` / `exists` / `list` | Compound helpers. `fs.read` / `fs.write` are deprecated byte / overwrite aliases |
| `actions.list` / `find` / `describe` / `check` | In-sandbox discovery |

**`.gitignore` is on by default** and can hide a whole project. A parent ignore once dropped 126 of 356 hits, including that project's README. Compare `search.count` with and without `noIgnore: true` (add `hidden: true` for dotfiles) before concluding a file is missing.

**`max` is a global row cap**, not ripgrep `--max-count` (per file). The search stops when the cap is hit.

Incomplete results set non-enumerable flags: `truncated` when `max` cut rows; `partial` when some paths could not be read. Unknown options are rejected instead of ignored.

## Dual path

- Visible single-file cards in Aside: native `read_file` / `write_file` / `edit_file` (same schemas as the guest).
- Search, multi-file read, summarize: one bash call to the CLI. That shows as a bash card.
- Do not call `rg`, `find`, `grep`, or `Get-ChildItem -Recurse` directly.

Agent recipe (absolute paths; replace with the values register printed):

```
/abs/node /abs/aside-codemode/bin/codemode.mjs --cwd /abs/project --code "return await search.count({ query: 'TODO', path: '.' })"
```

## Register

```sh
# Safe form: the node that is already running
node /abs/aside-codemode/scripts/register-aside.mjs
```

This writes `<!-- aside-codemode:start -->` markers into `~/.aside/u/0/AGENTS.md` using `process.execPath` and this repo's `bin/codemode.mjs`. It does **not** require `settings.json` or MCP. Missing settings still exits 0 if AGENTS wrote (`settingsOk: false`).

Windows: `pwsh -File scripts/register-aside.ps1`. macOS wrapper: `sh scripts/register-aside.sh` (uses `$NODE` if set, otherwise `command -v node` as a last resort).

Verify with a probe that should produce one bash CLI call, not a recursive `rg`:

```sh
aside exec --permission full-access -- "/abs/project 에서 README 가 들어있는 파일을 모두 찾아 절대경로로 보고하라"
```

## macOS

Install ripgrep with Homebrew (`brew install ripgrep`). A vendored `bin/rg.exe` is ignored on non-Windows. Noninteractive Aside PATH often has no `node` — that is why AGENTS stores the absolute `process.execPath` from the register run (issue #3).

## Windows

The repo vendors `bin/rg.exe`. Use `scripts/register-aside.ps1`. `.gitattributes` keeps `*.sh` as LF so a Windows checkout does not CRLF the macOS wrapper (issue #2).

## Config

Later entries win:

1. built-in defaults
2. `codemode.config.json` next to the package (dev clone)
3. `~/.config/codemode/config.json` — durable for a global install; honours `XDG_CONFIG_HOME`
4. `$CODEMODE_CONFIG`
5. `--config <file>`

Env keys still win: `CODEMODE_ROOTS`, `CODEMODE_RG`, `CODEMODE_EXCLUDES`, `CODEMODE_TIMEOUT_MS`, `CODEMODE_OUTPUT_BYTES`.

With no config, `roots` defaults to `$HOME` (`--doctor` reports `default:$HOME`). Wide roots are pruned by `excludeGlobs` (`Library`, `node_modules`, caches, media, …). Measured on one machine: default excludes walked 331,709 files in 0.77s; `includeExcluded: true` walked 1,565,078 in 7.37s. Set `"excludeGlobs": []` to disable pruning. `codemode.config.json` is machine-specific and gitignored.

## Trust model

`node:vm` is not a security mechanism (Node's own docs say so). Guest JS on `--code` comes from the Aside agent, which already has a shell. Treat it as the same trust level. The sandbox is accident containment — no code generation, execution timeouts, output caps, a hard root allowlist — not a hostile-code boundary.

## Development

```sh
npm test   # node --test "test/*.test.js" — zero dependencies
```

`test/regressions.test.js` pins defects that actually shipped: the gitignore blind spot, `max` over-returning, the stdout buffer blowup, silently-ignored options, a cross-OS root crash, `rgPath: null` being unable to clear an inherited value, and a Windows drive letter being split on `:`.

## Future: MCP

Current Aside CLI exec does not spawn `mcp.servers`. Register may still merge this block as leftover hygiene for a future build that attaches MCP. It is not the install path.

```json
{
  "mcp": {
    "servers": {
      "aside-codemode": {
        "command": "C:\\nvm4w\\nodejs\\node.exe",
        "args": ["C:\\path\\to\\aside-codemode\\src\\server.js", "--config", "C:\\path\\to\\aside-codemode\\codemode.config.json"]
      }
    }
  }
}
```

macOS: `"command"` is an absolute node path; args point at this clone. Success today is still AGENTS + `codemode --code`.
