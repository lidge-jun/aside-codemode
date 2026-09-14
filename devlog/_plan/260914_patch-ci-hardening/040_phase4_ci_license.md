# WP4 — MIT LICENSE, npm files[], GitHub Actions

Depends on WP1–WP3 so CI runs the new tests. No production runtime logic except `package.json` `files`.

## Loop spec

- Archetype: satisfy-spec.
- Trigger: WP0 D + WP1–WP3 contracts exist.
- Goal: SPDX MIT file in the tarball; Actions runs `npm test` on Node 18/20/22 after installing `rg`.
- Non-goals: npm publish, branch protection, Codecov, `npm ci`, copying Codex Apache-2.0, parent-repo CI.
- Verifier: `npm pack --dry-run` lists `LICENSE`; workflow file exists; `npm test` exit 0. This command does observe `package.json` and the packed `LICENSE`. Workflow YAML is human-reviewed this session (no push → Actions does not run).
- Stop: c-4 local proof. Remote CI is residual until the user pushes.
- Escalation: license family change to Apache is NEEDS_HUMAN.

## IN / OUT

IN: NEW `LICENSE`, MODIFY `package.json` `files`, NEW `.github/workflows/ci.yml`, MODIFY `README.md` and `README.ko.md` (required license footer; not optional).  
OUT: patch/search algorithms, 51x numbers. Do not create a new docs folder. Do not add a CI badge that implies origin/main is already green.

## NEW `LICENSE`

Exact SPDX MIT body from https://raw.githubusercontent.com/spdx/license-list-data/main/text/MIT.txt with the copyright line filled. Holder is the GitHub owner (`lidge-jun`). Mark NEEDS_HUMAN only if the user rejects that name.

```
MIT License

Copyright (c) 2026 lidge-jun

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Do not add a NOTICE that implies OpenAI copyright on this tree.

## MODIFY `package.json`

```diff
   "files": [
     "bin/",
     "src/",
     "scripts/",
     "templates/",
     "codemode.config.example.json",
     "README.md",
-    "README.ko.md"
+    "README.ko.md",
+    "LICENSE"
   ]
```

`license` field already `"MIT"` — keep. Do not add dependencies. `eval/bench-search.mjs` is repo/CI evidence and is **not** in `files[]` (030). Do not move it into `scripts/` just to pack it.

## NEW `.github/workflows/ci.yml`

```yaml
name: ci
on:
  push:
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    name: test (${{ matrix.os }}, node-${{ matrix.node }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            node: '18'
          - os: ubuntu-latest
            node: '20'
          - os: ubuntu-latest
            node: '22'
          - os: macos-latest
            node: '22'
          - os: windows-latest
            node: '22'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - name: Install ripgrep (Linux)
        if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y ripgrep
      - name: Install ripgrep (macOS)
        if: runner.os == 'macOS'
        run: brew install ripgrep
      - name: Install ripgrep (Windows)
        if: runner.os == 'Windows'
        run: choco install ripgrep -y
      - name: Test
        run: npm test
      - name: Pack includes LICENSE
        run: npm pack --dry-run
```

No `npm ci` / `npm install` (zero deps). Pinning checkout/setup-node to `@v4` matches the testing-skill template. Do not add `taiki-e/install-action` for ripgrep (not a TOOLS.md manifest; fallback is cargo-binstall).

Optional job `pack` is folded into the same job so LICENSE is checked on every OS.

## NEW `test/license-pack.test.js` (small)

Read `LICENSE` and assert it contains `MIT License` and `Copyright (c) 2026 lidge-jun`. Spawn pack **without** a `npm` / `npm.cmd` shim (`src/rg.js:31-34`: `.cmd` is EINVAL via `execFile`/`spawn` without a shell):

```js
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function npmCliJs() {
  const execDir = path.dirname(process.execPath);
  const candidates = [
    path.join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('npm-cli.js not found next to node; cannot pack');
}

const pack = spawnSync(process.execPath, [npmCliJs(), 'pack', '--dry-run'], {
  encoding: 'utf8',
  cwd: repoRoot,
});
assert.equal(pack.status, 0, pack.stderr);
assert.match(`${pack.stdout}\n${pack.stderr}`, /LICENSE/);
```

This observes the pack list on every `npm test`, including Windows CI. Do not put `apt`/`Ubuntu`/`## Linux` in README or AGENTS (`test/readme-51x.test.js:66-71`).

Do not parse `windowsHide` here.

## README SoT (required, not optional)

Append as the last line of `README.md` (after the existing closing paragraph; do not invent a `## Linux` heading):

`License: MIT (see LICENSE).`

`README.ko.md` last line:

`라이선스: MIT (LICENSE 참고).`

If those sentences already exist, leave them. Do not create a badge that implies Actions is already green on `origin/main`.

## Activation

| Case | How | Observe |
| --- | --- | --- |
| Pack | `npm pack --dry-run` | `LICENSE` in file list |
| Workflow | file exists at `.github/workflows/ci.yml` | matrix 18/20/22 + rg install + `npm test` |
| Tests | `npm test` | 0 fail |

## Residuals / bypass

Actions does not run until `dev` is pushed (DEV-GIT-PUSH-01). Completion this session is local pack + workflow presence + `npm test`. choco/brew flake on runners is residual; ubuntu apt is the primary expected green path. Windows `#5` hide opt-in remains env-gated (`CODEMODE_WINDOWS_HIDE`).
