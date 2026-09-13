# aside-codemode

Code mode MCP server for the [Aside](https://asidehq.com) agent.

Aside's agent does local file work through one tool call per file and, on
Windows, a PowerShell-backed shell tool — searching a tree means many slow
sequential round trips. aside-codemode gives the agent a single `execute_code`
tool instead: the model writes one JavaScript block that searches, filters,
reads only the hits and returns a distilled answer. Searching is backed by
ripgrep, so the primitive itself is fast too. Same idea as Cloudflare's Code
Mode and pi-runline, as an out-of-process MCP stdio server — the Aside daemon
is never patched.

## Guest API (what the model gets inside `execute_code`)

Code runs as an async function body; `return` surfaces the answer, `await` works.

- `search.files({ path, pattern?, glob?, max? })` → `string[]`
- `search.content({ query, path, glob?, context?, max?, ignoreCase? })` → `{file,line,text}[]`
- `fs.read(path, {maxBytes?}?)`, `fs.write(path, content)`, `fs.list(path, {max?}?)`
- `actions.list/find/describe/check` — in-sandbox discovery of the above

Nothing else exists in the sandbox: no `require`, `process`, `fetch` or network.

## Requirements

- Node.js >= 18
- ripgrep (`rg`) on PATH, or pointed at by `CODEMODE_RG` / `rgPath`
- Windows and macOS

## Install (the path that works on current Aside builds)

Measured on Aside 1.26.913.337: CLI `aside exec` sessions do NOT attach MCP
servers (the daemon never spawns them for exec), so the working integration
is the one-shot CLI plus one rule in the account's `AGENTS.md`.

1. Clone:

```sh
git clone https://github.com/lidge-jun/aside-codemode.git
```

2. Register (backs up settings.json, merges `mcp.servers`, writes
   `codemode.config.json` roots for this machine):

```powershell
# Windows
pwsh -File aside-codemode/scripts/register-aside.ps1
```

```sh
# macOS
sh aside-codemode/scripts/register-aside.sh
```

3. Append the rule to the Aside account's agent rules
   (`~/.aside/u/0/AGENTS.md`, Windows: `C:\\Users\\<you>\\.aside\\u\\0\\AGENTS.md`),
   replacing REPO with the clone location:

```md
## 로컬 파일 검색/읽기는 codemode CLI로

로컬 파일을 검색하거나 여러 파일을 읽어야 할 때, PowerShell 재귀 스캔은 쓰지 않는다.
bash 툴에서 codemode CLI를 한 번 호출해 검색-필터-읽기-요약을 끝낸다:

    node REPO/src/cli.js --config REPO/codemode.config.json --code "<JavaScript>"

- 코드는 async 함수 본문. return 이 최종 답, await 가능.
- search.files({path,pattern?,glob?,max?}), search.content({query,path,glob?,context?,max?,ignoreCase?}),
  fs.read/fs.write/fs.list, actions.list/find/describe/check.
```

4. Verify: run a probe and watch the agent call the CLI:

```sh
aside exec --permission full-access -- "C:/path/to/some-dir 에서 README 가 들어있는 파일을 모두 찾아 절대경로로 보고하라"
```

Expected: one `bash` call running `node .../src/cli.js --code ...`, answer in
seconds. If the agent answers without using the CLI, check the AGENTS.md path
and that the exec account is the same one you edited (u0 by default).

### Notes per platform
- Windows: the repo vendors `bin/rg.exe` and the config points at it, nothing to install.
- macOS: install ripgrep (`brew install ripgrep`) or set `CODEMODE_RG`; PATH/Homebrew locations are auto-detected.
- Node must be >= 18. The register script records the node it runs under.

## Register with Aside as MCP (future builds)

The register script also merges this into `mcp.servers` — it starts working
as soon as Aside attaches MCP servers to agent sessions:

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

macOS example: `"command": "/usr/local/bin/node"` (or the output of
`command -v node`), args pointing at the clone. `scripts/register-aside.mjs`
does this merge with a timestamped backup; thin `.ps1`/`.sh` wrappers find node.

Then set `roots` in `codemode.config.json` — the allowlist every `fs.*` and
`search.*` path is checked against. Empty means deny-all.

## Configuration

Priority: built-in defaults < repo `codemode.config.json` < `$CODEMODE_CONFIG`
file < `--config <file>`. Individual env keys always win:
`CODEMODE_ROOTS` (pathsep-separated), `CODEMODE_RG`, `CODEMODE_TIMEOUT_MS`,
`CODEMODE_OUTPUT_BYTES`. Aside's own `permission.files` is intentionally not
reused — this server's policy is independent.

## Trust model

`node:vm` is not a security mechanism (Node's own docs say so). Code passed to
`execute_code` comes from the Aside agent, which already holds far more powerful
tools (a shell). Treat it as the same trust level: the sandbox is accident
containment — no code generation, execution timeouts, output caps, a hard root
allowlist on every fs/search path — not a hostile-code boundary.

## Development

```sh
npm test   # node --test test/ — zero dependencies
```

Design contract: `devlog/_plan/260913_codemode-server/010_phase1_server.md`.
