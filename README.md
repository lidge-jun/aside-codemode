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

**search**
- `search.files({ path, pattern?, glob?, max?, noIgnore?, hidden?, followSymlinks?, maxFilesize?, timeoutMs? })` → `string[]`
- `search.content({ query, path, glob?, context?, max?, ignoreCase?, fixedStrings?, wordRegexp?, multiline?, noIgnore?, hidden?, ... })` → `{file,line,text}[]`
- `search.count({ query, path, glob?, noIgnore?, ... })` → `{matches,files}` — size a search before pulling rows

**fs**
- `fs.read(path, {maxBytes?, offset?}?)`, `fs.readMany(paths[], {maxBytes?, totalBytes?}?)`, `fs.grepFile(path, pattern, {context?, max?}?)`
- `fs.write(path, content)`, `fs.mkdir(path)`, `fs.stat(path)`, `fs.exists(path)`, `fs.list(path, {max?, recursive?, depth?}?)`

**actions** — `list/find/describe/check`, in-sandbox discovery of everything above.

Nothing else exists in the sandbox: no `require`, `process`, `fetch` or network.

### Three behaviours worth knowing

**1. `.gitignore` is respected by default, and that silently hides files.**
Measured on a real tree: a repo-wide search returned 230 of 356 matching files
because a *parent* `.gitignore` listed an entire project directory — the missing
126 included that project's own `README.md`. Nothing in the result said so.

```js
// compare before concluding something does not exist
const a = await search.count({ query: 'thing', path: root });
const b = await search.count({ query: 'thing', path: root, noIgnore: true, hidden: true });
```

Pass `noIgnore: true` (and `hidden: true` for dotfiles) to search everything.

**2. `max` is a global row cap, not ripgrep's `--max-count`.**
`--max-count` is *per file*, so using it as a total cap over-returns. Here `max`
bounds total rows and rg is terminated once reached, which also means
`search.files({ max: 10 })` on a huge tree is cheap — it used to die with
`stdout maxBuffer length exceeded` because the old implementation buffered the
entire output before applying the cap.

**3. Results tell you when they are incomplete.**
Non-enumerable so they never pollute `JSON.stringify`:
- `result.truncated === true` — `max` cut the rows short.
- `result.partial` — paths that could not be read (permissions, broken symlinks).
  ripgrep exits `2` for both a bad regex and one unreadable file; a fatal error
  still throws (and names the cause), but a soft one returns the rows it did get
  rather than discarding them.

Unknown options are rejected with the list of valid ones instead of being
silently ignored.

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
- search.files({path,pattern?,glob?,max?,noIgnore?,hidden?}), search.content({query,path,glob?,context?,max?,ignoreCase?,noIgnore?}),
  search.count({query,path}), fs.read/readMany/grepFile/write/mkdir/stat/exists/list,
  actions.list/find/describe/check.
- 검색은 기본적으로 .gitignore 를 따른다. 있어야 할 파일이 결과에 없으면 noIgnore:true 로 다시 확인한다.
```

4. Verify: run a probe and watch the agent call the CLI:

```sh
aside exec --permission full-access -- "C:/path/to/some-dir 에서 README 가 들어있는 파일을 모두 찾아 절대경로로 보고하라"
```

Expected: one `bash` call running `node .../src/cli.js --code ...`, answer in
seconds. If the agent answers without using the CLI, check the AGENTS.md path
and that the exec account is the same one you edited (u0 by default).

### Notes per platform
- Windows: the repo vendors `bin/rg.exe`; the register script points the config at it.
- macOS/Linux: install ripgrep (`brew install ripgrep`) or set `CODEMODE_RG`; PATH and
  Homebrew locations are auto-detected. A vendored `.exe` is ignored on non-Windows
  rather than failing with `spawn EACCES`.
- Node must be >= 18. The register script records the node it runs under.

`codemode.config.json` is **machine-specific and gitignored** — `roots` and
`rgPath` differ per host. `codemode.config.example.json` is the committed
template; the register script seeds it. (Committing the real file made a fresh
clone on another OS die with a raw `realpath ENOENT` stack trace.)

### Diagnosing a broken setup

```sh
node src/cli.js --doctor            # resolved rg, roots, missing roots, config sources
```

Every startup failure is reported as the same `{ok:false,error}` envelope the
guest uses, naming the offending path and the fix — not a node stack trace.

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
npm test   # node --test "test/*.test.js" — zero dependencies
```

`test/regressions.test.js` pins defects that actually shipped: the gitignore
blind spot, `max` over-returning, the stdout buffer blowup, silently-ignored
options, a cross-OS root crash, `rgPath: null` being unable to clear an
inherited value, and a Windows drive letter being split on `:`.

Design contract: `devlog/_plan/260913_codemode-server/010_phase1_server.md`.
