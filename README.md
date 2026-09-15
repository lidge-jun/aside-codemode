<p align="center"><img src="assets/logo.png" alt="aside-codemode" width="112"></p>
<h3 align="center">make aside 50x faster</h3>
<p align="center"><b>One call where Aside used to spend fifty</b><br>
Search, read, and drive the browser inside one sandboxed JavaScript block, then hand back the answer instead of the pile it came out of.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/aside-codemode"><img src="https://img.shields.io/npm/v/aside-codemode?color=cb3837&label=npm&logo=npm" alt="npm version"></a>
  <a href="https://github.com/lidge-jun/aside-codemode/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/aside-codemode?color=blue" alt="license"></a>
  <img src="https://img.shields.io/node/v/aside-codemode?logo=node.js&label=node" alt="node version">
  <a href="https://github.com/lidge-jun/aside-codemode/actions/workflows/ci.yml"><img src="https://github.com/lidge-jun/aside-codemode/actions/workflows/ci.yml/badge.svg?branch=main" alt="ci"></a>
</p>

```bash
npm install -g aside-codemode
codemode --doctor
```

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a></p>

Find the fifty files in a project that mention `TODO`, and hand back the paths.

|  | natively | one `codemode --code` call |
| --- | --- | --- |
| cards in the Aside UI | 50 | 1 |
| round trips | 50 | 1 |
| what reaches the model | every byte of all fifty files | the five paths you asked for |

```js
const hits = await search.content({ path: ".", query: "TODO", max: 50 });
return [...new Set(hits.rows.map((r) => r.file))].slice(0, 5);
```

On a real development folder, `find`+`grep` took **55s** and one `codemode --code` search took
**1s**, about **51x**. The [measurement](evidence/dev-folder-51x.md) ships the exact argv, the
unrounded times, and the proof that both commands found the same files. It also says which
number came from the folder and which came from the synthetic companion, because those are not
the same run and one of them is not 55 seconds of anything.

Older paired Aside-turn timings (model + daemon overhead) were 1.05–1.81x for single searches. Those do not cancel the folder wall-clock. [See the older table](#performance-evidence).

**aside-codemode** gives Aside a single place to search, filter, read and summarize local files —
and, once browsing is turned on, to run twenty pages through one session and come back with rows
instead of screenshots. Keep intermediate data out of the model context; return the answer and the
evidence needed to judge it.

Aside exec does not attach MCP servers on current builds. The working path is one `bash` call to the `codemode` CLI plus a rule in `~/.aside/u/0/AGENTS.md`. File cards in the Aside UI still come from native `read_file` / `write_file` / `edit_file`. Guest JavaScript uses those same shapes.

## Requirements

- Node.js >= 18
- ripgrep (`rg`) on PATH, or `CODEMODE_RG` / `rgPath`. Windows may use vendored `bin/rg.exe`
- macOS and Windows

## Install

Two steps. The first puts the CLI on your PATH; the second tells an Aside account it exists.

```sh
npm install -g aside-codemode
codemode --doctor
```

From a clone instead, which is what you want if you are going to change it:

```sh
git clone https://github.com/lidge-jun/aside-codemode.git
cd aside-codemode
npm install -g .        # or: npm link
codemode --doctor
```

### Then install it into an Aside account

The CLI alone does nothing for an agent: Aside has to be told the absolute node/CLI pair and
given the skill that explains the call shapes. That is one command, and it names the account:

```sh
node scripts/install-codemode.mjs install --account 0 --json
```

It writes six files under that account root and one markered block inside its `AGENTS.md`:

```
codemode/cm.js                                     the batch helper an Aside REPL loads
codemode/catalog.json                              the action catalog
codemode/manifest.json                             what this install owns, by hash
skills/user/aside-codemode/SKILL.md                when to batch, how to read a result
skills/user/aside-codemode/references/*.md         call shapes, execution paths, Windows quoting
AGENTS.md  <!-- aside-codemode:start … end -->     the block read on every turn
```

Nothing else in the account is touched. Settings, credentials, sessions, memory and other
skills are not ours and are never opened. A file you edited is kept and named in `preserved`
rather than overwritten, `doctor` tells you when a machine is behind a release, and
`uninstall` removes only the files whose hashes still match and takes its block back out of
`AGENTS.md` while leaving the rest of that file alone.

Always pass `--account`. Without it the installer follows `accounts.json`'s `currentAccountId`,
which can change under you. Run it again after every upgrade: a release that changes only the
guidance still leaves an account stale, and `doctor` will say so.

Browsing needs no third step. It is on by default.

### Who uses the PATH command

`codemode` on PATH is for **you**, the operator. Aside agents must not look up `node` or
`codemode` on PATH; they call the absolute pair the installer wrote into the AGENTS block
(`process.execPath` plus this install's `bin/codemode.mjs`).

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
| `browse.probe()` | Capability matrix measured against the installed Aside build: which page methods exist, which options are accepted-and-ignored, and why a request is refused |
| `browse.exec(job)` | A batch of URLs through ONE Aside REPL session. Returns `{ items, partial, leakedUrls }`; one failed URL never empties the others |
| `browse.captureMany(urls, { outDir, screenshot, ... })` | Batch capture. Screenshots come back as real files under `outDir`, each verified against the request — `clip` geometry is checked against the actual pixels rather than trusted |
| `browse.readText(url)` or `browse.readText({ url })` | Fetch-first read: HTML to markdown with no browser, falling back only when the fetched page measurably rendered no text. The body comes back as `text`, with `format` saying what it is (`markdown` from the fetch path, `text` from the browser's rendered body). Reports `source` and `fallbackReason` so you know which path answered |
| `browse.exec({ extract })` | Schema extraction in one `page.evaluate`: `{ field: 'css' }` or `{ selector, attr?, all? }`. Returns typed JSON plus a `missing[]` list, so absent is distinguishable from empty, and no snapshot tree is shipped |
| `browse.exec({ treeNodes })` / `browse.attach({ treeNodes })` | Off by default. With `treeNodes: true` the accessibility tree also arrives parsed as `snapshot.nodes`, one `{ depth, role, name, ref, attrs, line }` row per node, so hierarchical data is grouped by depth rather than by a regex over the string form |
| `api.batch(requests)` | Parallel API-first lookups. `youtube` and `itunes` are public no-key endpoints; `play` and `slack` refuse with `ENOTSUP` and the reason, because neither has an honest public path |
| `report.build({ items, outFile })` | Assembles a paged HTML report, prints it over an ephemeral loopback origin (`file://` is refused by Aside), and **verifies the real MediaBox**. `pdf({format:'A4'})` was measured to yield US Letter, so the size is proven rather than requested |
| `browse.searchMany(queries, { engine })` | N queries in parallel, URL-deduped, date-filtered. `youtube` works; `google` is callable but answers with a bot challenge, so it returns `EBLOCKED` with the URL to open rather than an empty result set; `duckduckgo` is the no-key default and gets the same challenge detection |
| `browse.downloadMedia(urls, { outDir })` | Original images by direct fetch. The **magic bytes gate the write**, so a block page claiming `image/png` is refused instead of landing on disk as a `.png` |
| `browse.watch(urls)` | Per-URL text hash. An unchanged URL returns `changed:false` with no body; first sight is `first:true` so it is never mistaken for a change |
| `recipes.list / describe / run` | Site recipes as **data** (`{ url, waitSelector, extract }`), executed with no model turn. A `.js` recipe is refused: host-loaded code would bypass the guest sandbox |
| `browse.prefetch(urls)` | Best-effort cache warm-up. Failures are reported, never thrown — a warm-up that breaks the real run is worse than a cold cache |

### Browsing is on by default

A fresh install can call `browse` with no extra step. A machine that would rather it could not
sets `browseCaps.enabled` to false in its config; every call then comes back `EDISABLED` naming
the one command that restores it, `codemode --enable-browse`.

### What `ok` does not mean

`ok` says the run finished. It does not say the page rendered. Threads answered `ok: true` with
the right title while the body was 530KB of bootstrap JSON and no posts. Ask for a verdict and
you get one: `requireSelector` or `minTextChars` set `contentVerified`, and `requireContent: true` makes
a failed check fail the item. Without them `contentVerified` is `null`, because nobody asked.
`scriptRatio` is reported and never decides anything: every bundled SPA ships large inline scripts,
so judging on it would trade a false success for a false failure.

### What Aside cannot do, said before anything spawns

Five options are refused with `ENOTSUP` instead of being accepted: `page.route`, screenshot
`maxWidth`, `pdf({format:'A4'})`, `file://` URLs, and `networkidle`. Each was measured being
taken and then quietly ignored or downgraded - `format:'A4'` produces US Letter, `maxWidth` returns
the full-size image. A refusal you can read beats a result you cannot trust.

Two more facts about the surface underneath. The Aside CLI exits `0` even when it failed, so a run
counts as successful only on the trailing `[ok | Nms]` marker plus the files it claims to have
written actually being there. And a killed CLI leaks its tabs permanently, with no later session
able to close them, so every script sets its own deadline to fire before the host deadline; when
the host kills one anyway it is reported as `partial: ['host-kill']` with the affected URLs rather
than as a clean result.

`codemode --doctor --browse` prints the whole matrix for the build you have installed.

**`.gitignore` is on by default** and can hide a whole project. A parent ignore once dropped 126 of 356 hits, including that project's README. Compare `search.count` with and without `noIgnore: true` (add `hidden: true` for dotfiles) before concluding a file is missing.

Inclusive `glob` values (for example `**/*.js`) are ripgrep `-g` / `--glob` globs. They can match some gitignored or hidden files even when `noIgnore` and `hidden` are false. That is ripgrep glob precedence, not a workspace escape, and it is **not** the same as `-uuu`: ignore rules still apply to paths the glob does not force in. Exclusive globs (`-g '!…'`) still hide paths. Set `noIgnore` / `hidden` explicitly when you want ignore-or-dotfile control without an inclusive glob.

**`max` is a global row cap**, not ripgrep `--max-count` (per file). The reader probes one extra match to distinguish a complete result of exactly `max` rows from a truncated one, then stops.

Search arrays still support `.map`, `.filter` and `.length` inside guest code. Returning a search result directly (including nested results) serializes a **search envelope**: `{ rows, complete, truncated, partial, scope }`. Counts retain `{ matches, files }` and serialize the same metadata. `complete` means the selected scope was traversed without truncation or reported read errors, not that ignored or excluded files were searched. `scope` records the effective options. Explicitly returning `.length` or a mapped array is a projection: preserve metadata yourself when completeness matters.

`context` returns surrounding text on content hits. Unknown or invalid options are rejected. `includeExcluded: true` overrides configured exclusions; `noIgnore` and `hidden` are separate controls. **`followSymlinks: true` is rejected** until guarded link traversal is implemented, rather than allowing ripgrep to read outside the configured roots.

A rejected traversal used to be a silent one. A directory of 37 entries where 35 were links
answered with 2 rows and `complete: true`, and no option could reveal the difference. Now
`scope.skippedSymlinks` reports `{ dirs, files, examples, capped }`, and a skipped **directory**
sets `complete: false` — `noIgnore`/`hidden` will not recover those results, so point `path` at
the link target instead. A skipped **file** link is counted without lowering completeness: it
cannot hide a subtree, and treating three symlinked bin stubs as an incomplete search was
measured to make the signal useless. The census does not read `.gitignore`, and it stops after
a bounded number of entries (`capped: true` says so).

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

`apply_patch` supports Add and multi-hunk Update; Delete, Move and Environment remain unsupported. Add creates a newline-terminated text file. Update hunks match whole lines (not mid-line substrings), delete lines without leaving a blank, and keep the file's original newline (LF or CRLF). Successful application still returns `{}`. A later failure is a thrown error carrying `applied` and `failedFile`, also preserved by CLI error responses when they fit the output budget. Earlier files remain changed: this is **not a multi-file transaction**.

## Dual path

- Visible single-file cards in Aside: native `read_file` / `write_file` / `edit_file` (same schemas as the guest).
- Search, multi-file read, summarize: one bash call to the CLI. That shows as a bash card.
- Do not call `rg`, `find`, `grep`, or `Get-ChildItem -Recurse` directly.

### Choosing a path

Native is the default, and staying native is the right answer more often than not. Reach for a
batch only when all three hold: the steps repeat, the items do not share state with each other,
and you can say in one sentence what a finished item looks like. A first look at an unfamiliar
page, a single click, a fresh visual judgement, or anything that needs an account or an
approval stays native — batching those trades a correct answer for a faster wrong one.

When the work does qualify, the cost of doing it by hand is real — but how much depends
entirely on what there is to batch, and the four workloads measured here batch different
things. Thirty alternating pairs each, cold and warm, on one machine, with no failed runs:

| work | by hand | batched | what the saving is |
|---|---|---|---|
| one known click | 1249 ms | 1244 ms | nothing; it is a tie |
| find something on a new page | 3257 ms, 3 calls | 1249 ms, 1 call | two fewer page loads |
| read six independent pages | 8413 ms | 4429 ms | two tabs at once |
| count matches in six files | 399 ms, 6 calls | 82 ms, 1 call | five fewer processes |

Do not collapse those into one number. A single click gains nothing from batching, and the
62% on the middle row is the price of opening two more `aside repl` sessions rather than a
cleverer way to explore: recovering from a wrong selector costs 6 ms. Raw runs are in
[eval/out](eval/out) rather than summarised out of reach.

A batch result is not a boolean. `completed` means every requested item came back and no tab
was left open; `partial`, `indeterminate` and `needs_input` are answers too, and each one has
a different correct response. Rerunning an `indeterminate` side effect is how a second order
gets placed.

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
npm test   # node scripts/run-tests.mjs — zero dependencies
```

`test/regressions.test.js` pins defects that actually shipped: the gitignore blind spot, `max` over-returning, the stdout buffer blowup, silently-ignored options, a cross-OS root crash, `rgPath: null` being unable to clear an inherited value, and a Windows drive letter being split on `:`.

License: MIT (see LICENSE).
