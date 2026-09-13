# make aside 50x faster

On a local development folder, a `find`+`grep` combo took **55s** and one `codemode --code` search took **1s** (~**51x**). Finding 50 files used to stack 50 `read_file` cards; the same job is one bash card. [Folder measurement](evidence/dev-folder-51x.md).

Older paired Aside-turn timings (model + daemon overhead) were 1.05–1.81x for single searches. Those do not cancel the folder wall-clock. [See the older table](#performance-evidence).

**aside-codemode** gives Aside a single place to search, filter, read and summarize local files. Keep intermediate data out of the model context; return the answer and the evidence needed to judge it.

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

Code is an async function body. `return` is the answer. The guest API does not expose `require`, `process`, `fetch`, or network tools. This is not a hostile-code security guarantee; see the trust model.

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

**`max` is a global row cap**, not ripgrep `--max-count` (per file). The reader probes one extra match to distinguish a complete result of exactly `max` rows from a truncated one, then stops.

Search arrays still support `.map`, `.filter` and `.length` inside guest code. Returning a search result directly (including nested results) serializes a **search envelope**: `{ rows, complete, truncated, partial, scope }`. Counts retain `{ matches, files }` and serialize the same metadata. `complete` means the selected scope was traversed without truncation or reported read errors, not that ignored or excluded files were searched. `scope` records the effective options. Explicitly returning `.length` or a mapped array is a projection: preserve metadata yourself when completeness matters.

`context` returns surrounding text on content hits. Unknown or invalid options are rejected. `includeExcluded: true` overrides configured exclusions; `noIgnore` and `hidden` are separate controls. **`followSymlinks: true` is rejected** until guarded link traversal is implemented, rather than allowing ripgrep to read outside the configured roots.

```sh
codemode --cwd /abs/project --code '
const hits = await search.content({ path: ".", query: "TODO", max: 50 });
const paths = [...new Set(hits.map(hit => hit.file))];
const excerpts = await fs.readMany(paths, { maxBytes: 4096, totalBytes: 32768 });
return { hits, excerpts };
'
```

### Read bounds and compatibility

Unpaged `read_file` and retained paged output are limited to 256 KiB. Paged reads reject a physical line above 256 KiB; `fs.grepFile` streams with a 1 MiB physical-line limit and rejects larger lines rather than reporting a false negative. Use `fs.read` with an explicit byte range for larger lines. UTF-8 characters split across chunks are decoded correctly. A file edit still reads the entire original; this is not a global memory bound.

Migration: callers parsing a directly returned search array must now read `result.rows` and inspect its metadata. Guest `.map`/`.length` usage remains unchanged. Add patches now create newline-terminated files, and execution output budgets below 96 bytes are rejected. These are intentional contract changes, not a claim of complete Codex patch compatibility.

### Writes and patches

`edit_file` and the overwrite helper coordinate cooperating processes on the canonical file path. The lock covers reading the original, validating replacements and committing the update. Separate processes editing different parts of the same file no longer silently overwrite each other's successful changes. This is not protection against an editor that ignores the lock or another hard-link alias. Locks are stored in `os.tmpdir()/codemode-locks`; cooperating processes must share that directory. Different `TMPDIR` settings are not coordinated.

`apply_patch` supports Add and multi-hunk Update; Delete, Move and Environment remain unsupported. Add creates a newline-terminated text file. Successful application still returns `{}`. A later failure is a thrown error carrying `applied` and `failedFile`, also preserved by CLI error responses when they fit the output budget. Earlier files remain changed: this is **not a multi-file transaction**.

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

Git Bash is the default Aside shell on Windows. PowerShell is allowed for the same absolute `node` + `bin/codemode.mjs --code` call. Aside has no Linux product.

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

`node:vm` is not a security mechanism (Node's own docs say so). Guest JS on `--code` comes from the Aside agent, which already has a shell. Treat it as the same trust level. The runtime is accident containment, not a hostile-code boundary. A worker evaluates guest JavaScript and serializes its result; an external watchdog can terminate an async loop or a hanging `toJSON`. Host filesystem/search functions stay in the parent and are invoked through a named RPC allowlist. `actions.*` discovery remains synchronous through a dedicated RPC channel.

The watchdog supervises guest evaluation and serialization, not arbitrary synchronous host callbacks. For content searches prefer the ripgrep-backed `search.content`; a pathological JavaScript regular expression passed to `fs.grepFile` can still block the host event loop.

Always await host operations. `hostCallFailures` counts rejected host calls, including deliberately caught errors, so a failure that settled before final serialization is not silently hidden.

Execution cancellation aborts signal-aware host operations and stops accepting new guest calls. Already submitted filesystem I/O cannot be promised to roll back. The supervisor allows a bounded cleanup interval; a response with `pendingHostCalls` / `sideEffectsMayContinue` warns when host work remains. A process crash or external kill can leave a lock that needs inspection; unknown locks are never silently stolen. This is not OS isolation, network isolation or a global memory limit.

`maxResultBytes` / `CODEMODE_OUTPUT_BYTES` now bounds the **entire execution JSON response plus its trailing newline**, including Unicode, JSON escaping, logs and errors. Accepted values are integers from 96 bytes to 16 MiB. Very small/invalid configurations are rejected before execution. The MCP transport wrapper and `--doctor` diagnostic output are outside that execution-response budget. `truncated` on the outer response means output loss; `truncated` inside a search envelope means an incomplete search. These are different conditions.

## Performance evidence

These are **historical paired Aside runs**, not fresh measurements of the hardened runtime. The worker watchdog adds startup overhead; correctness tests do not establish a latency improvement.

| Task | Baseline | Codemode | Observed speedup |
| --- | ---: | ---: | ---: |
| One needle, 3,000 files | 15,202 ms | 8,408 ms | 1.81x |
| One needle, 20,000 files + 127 MB log | 9,083 ms | 8,650 ms | 1.05x |
| Ten marker paths and sizes | 28,717 ms | 25,390 ms | 1.13x |

Source: [recorded summary](evidence/summary.md) and [compound comparison](evidence/summary-compound.md). The first and compound baselines include a path/retry contamination. Both compound runs used three bash calls, so that pair does not prove a round-trip reduction. No pair established the original `<0.5` after/baseline target. The folder wall-clock above is one development-folder pair (55s vs 1s). The table is older Aside-turn timings and does not cancel that pair. It is not a promise that every machine or every task is 51x. Samples are too limited to promise a typical result.

For new comparisons, pass real task markers explicitly:

```sh
node eval/compare.mjs baseline.jsonl after.jsonl summary.md BASELINE-MARK AFTER-MARK
```

The comparator uses recorded timestamps and completion timestamps, counts failed tool events, and reports marker presence separately from correctness. It never turns a substring hit into an answer-quality PASS. A serious speed claim needs repeated paired runs, exact final-answer checks, tool calls, returned bytes/tokens and comparison with a well-written single shell/Python batch.

## Development

Hardening verification (2026-09-13): [196 passing tests, source hashes and remaining limits](evidence/review-hardening-20260913.json).

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
