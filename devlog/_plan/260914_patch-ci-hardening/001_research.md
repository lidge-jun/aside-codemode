# Research: repro, license provenance, CI install, glob precedence

No diffs in this file (LEXICO-SPLIT-01). Implementation lives in 010–050.

## 1. Patch substring defect (local, 2026-09-14)

Against HEAD `8223264` on this checkout, using `createApplyPatch` + `createFs`:

| Input | Observed |
| --- | --- |
| file `foobar`; hunk `-foo` / `+bar` | `{ok:true}` equivalent (apply returned `{}`); file `barbar` |
| `alpha\nbeta\ngamma\n`; hunk `-beta` | file `alpha\n\ngamma\n` |
| `alpha\r\nbeta\r\ngamma\r\n`; hunk ` alpha` / `-beta` / `+BETA` | throw `edit_file: oldText not found: alpha\nbeta`; file unchanged |
| same CRLF file; hunk `-beta` only | success `alpha\r\nBETA\r\ngamma\r\n` — `indexOf('beta')` finds the word without needing `\n` |

Mechanism: `parseApplyPatch` splits on `/\n/` (`src/host/patch.js:25`) and joins old/new lines with `'\n'` (`src/host/patch.js:71`). `edit_file` locates with `indexOf` / `lastIndexOf` (`src/host/fs.js:296`). A line-oriented hunk is therefore a substring search. The evaluator’s Windows failure is the **context/newline** case, not every single-line CRLF replace.

Parser also leaves `\r` on lines if the *patch text* is CRLF, because `split(/\n/)` does not strip `\r`.

## 2. grepFile vs search.content (local)

`fs.grepFile` (`src/host/fs.js:100-144`) returns a plain array. After `max:1` on a 3-line `/. /` file: `JSON.stringify` is `[{"line":1,"text":"a"}]`; `truncated`/`complete` are missing. `max:-1` returns `[]` because `hits.length < max` is false. `search.content` already uses `decorateSearchResult` (`src/search-result.js:56-77`) so wire JSON keeps `{rows,complete,truncated,partial,scope}`.

`eachLine` (`src/host/file-read.js:104-141`) already strips `\r` from physical lines. Completeness needs one extra match after `max`, then stop.

Worker RPC: `src/sandbox.js:109-111` only sets `search: true` for `msg.name.startsWith('search.')`. `fs.grepFile` is the RPC name (`sandbox.js:16`). structuredClone drops non-enumerable metadata; search already uses `toJSON` + `restoreSearchResult` (`src/execution-worker.js:22-25`). Decorating grepFile without widening that flag would lose `.truncated` inside the guest after a real CLI/`runCode` call.

## 3. ripgrep glob vs ignore (public source)

Inclusive `-g`/`--glob` can surface gitignored and backup files that a default `rg --files` hides. Feature request to invert that priority remains open.

> 출처: [Make --glob respect ignore files with an option (ripgrep#1808)](https://github.com/BurntSushi/ripgrep/issues/1808)

This is documented ripgrep precedence, not a root escape. Product change is documentation in schema/README/AGENTS, not a custom glob engine.

## 4. License: user asked MIT; Codex is Apache-2.0

`package.json` already has `"license": "MIT"` and no LICENSE file. openai/codex LICENSE is Apache License 2.0, Copyright 2025 OpenAI.

> 출처: [openai/codex LICENSE](https://github.com/openai/codex/blob/main/LICENSE)
> 출처: [openai/codex repository license](https://github.com/openai/codex)

Canonical MIT text (SPDX identifier `MIT`):

> 출처: [SPDX MIT license text](https://raw.githubusercontent.com/spdx/license-list-data/main/text/MIT.txt)
> 출처: [Open Source Initiative — The MIT License](https://opensource.org/license/mit)

Decision for 040: ship SPDX MIT with `Copyright (c) 2026 lidge-jun` (GitHub owner). Do not paste Codex Apache into this repo. If the user later wants Apache-2.0 to match Codex, that is NEEDS_HUMAN (license change).

## 5. CI and ripgrep on runners

This package has **zero** `dependencies` and **no** lockfile. `npm ci` is the wrong install. `npm test` is `node --test "test/*.test.js"` (`package.json:11`). Search tests need `rg` on PATH (`src/rg.js:23`).

taiki-e/install-action installs unknown tools via cargo-binstall fallback. ripgrep is not a first-class TOOLS.md manifest name in the fetched list.

> 출처: [taiki-e/install-action](https://github.com/taiki-e/install-action/)

Comparable Node CI installs ripgrep with `apt-get` on Ubuntu.

> 출처: [agntk ci.yml installing ripgrep via apt](https://github.com/Phoenixrr2113/agntk/blob/bd308302232592b74ec9f87147d8818c8073790c/.github/workflows/ci.yml)

Plan: `actions/checkout@v4` + `actions/setup-node@v4` matrix Node 18/20/22; install rg with `apt-get` / `brew` / `choco` by `runner.os`; run `npm test` then `npm pack --dry-run`. Include ubuntu + macos + windows so CRLF and `#5` child opts have a chance to run on native OS; line-ending tests themselves are synthetic and already run on macOS.

dev-testing CI template uses checkout@v4 / setup-node@v4 and concurrency cancel-in-progress (`dev-testing/references/ci-pipeline.md`).

## 6. 51x evidence gap

`evidence/dev-folder-51x.md` is a 19-line operator table (55s vs 1s). It names no exact argv, no unrounded ms, no search options, no equality check, no repeats. `eval/compare.mjs` compares Aside recorded events, not a folder `find`+`grep` vs `codemode --code` pair. `eval/make-corpus.mjs` builds a 60×50 synthetic tree and can be reused as a *companion* corpus, not as a rewrite of the operator folder.

README lead (`README.md:3`) must keep `55s` / `1s` / `51x` so `test/readme-51x.test.js:27-33` stays green. Strengthen the linked evidence; do not weaken the title.

## 7. String-lock tests

`test/readme-51x.test.js:19-40` asserts README phrases. `test/windows-hide.test.js:31-35` asserts the literal `windowsHide: true` is absent from `rg.js` / `rg-stream.js`. Both can pass while behavior is wrong (`windowsHide:true` without a space; 51x numbers never measured). WP5 adds behavior checks beside, not instead of, the copy locks that protect the operator wording.

## 8. A-round facts (reviewer-run, no diffs)

Independent A reviewer ([89f47e7b](89f47e7b-fb3f-436b-87f7-a19d28d7418b)) re-ran `npm test`: exit 0, 208 pass, 30244 ms. External claims re-checked: Codex LICENSE is Apache-2.0; SPDX identifier `MIT`; ripgrep#1808 is glob precedence and is **not** `-uuu`. Windows `.cmd` shims are not `execFile`-safe (`src/rg.js:31-34`). Those facts drove the five High folds in `000_plan.md` (per-line EOL, injectable rg spawn, locked `grep -R` baseline, `actions.check` assertion, npm-cli.js pack spawn).
