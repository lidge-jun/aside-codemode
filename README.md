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

## Register with Aside

Merge into `~/.aside/u/0/settings.json` (Windows: `C:\\Users\\<you>\\.aside\\u\\0\\settings.json`)
under `mcp.servers` — absolute paths, everything else preserved:

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
