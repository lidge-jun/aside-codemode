# wp1 — cwd foundation (CLI)

Relative guest paths resolve against an explicit working directory. `roots`
stay the home-wide allowlist. MCP is not touched except unused shared helpers.

## IN / OUT

IN: `src/host/cwd.js` (NEW), `src/paths.js`, `src/cli.js`, `src/config.js` (env only if needed), `test/cwd.test.js` (NEW), `test/config.test.js` if `--cwd` must not be eaten as config.
OUT: `src/server.js` behavior change, AGENTS.md, README (wp5), apply_patch, Aside-shaped file API (wp2).

## NEW `src/host/cwd.js`

```js
import path from 'node:path';

export function resolveCwd({ argv = [], env = process.env, processCwd = process.cwd() } = {}) {
  const flagIdx = argv.indexOf('--cwd');
  if (flagIdx !== -1) {
    const v = argv[flagIdx + 1];
    if (!v || v.startsWith('-')) throw new Error('--cwd requires a directory path');
    return path.resolve(v);
  }
  if (env.CODEMODE_CWD) return path.resolve(env.CODEMODE_CWD);
  return path.resolve(processCwd);
}
```

Priority: `--cwd` > `CODEMODE_CWD` > `process.cwd()`. Always absolute.

### Field chain — `cwd` (PLAN-FIELD-CHAIN-01)

| Stage | Path | Notes |
| --- | --- | --- |
| Creation | `src/cli.js` argv `--cwd <dir>` OR env `CODEMODE_CWD` OR `process.cwd()` | `resolveCwd` |
| Serialization | N/A — not written to config JSON this unit | doctor prints it as JSON field `cwd` only |
| Deserialization | N/A + reason: runtime-only; next process re-resolves | — |
| Consumers | `makeRootGuard(..., { cwd })`; `assertInside` `path.resolve(cwd, p)`; `--doctor` `cwd` | relative `read_file.path` / `write_file.file_path` / `edit_file.path` / `search.*.path` |

`--cwd` is **not** a `loadConfig` key. `loadConfig` only reads `--config` (`src/config.js:120-121`).

Windows: `path.resolve` is the **host** Node path. A Windows absolute `C:\foo` read on macOS is already treated as absolute by `isAbsoluteAnyPlatform` in config roots (`src/config.js:54-56`). Guest file paths use the same host `path.resolve(cwd, p)`. Do not claim a macOS process can resolve `C:\` to a real file.

## MODIFY `src/cli.js` — `resolveCwd` MUST sit inside `fail()`

`loadConfig` is already in try/catch (`src/cli.js:31-36`). `makeRootGuard` is in a second try (`src/cli.js:38-43`). Insert a **third** guarded block (or fold into the first after config):

```js
let workCwd;
try {
  workCwd = resolveCwd({ argv });
} catch (e) {
  fail(e.message);
}
```

`--cwd` as last argv (`codemode --cwd` with no dir) → `resolveCwd` throws → `{ok:false,error:"--cwd requires a directory path"}` exit 1.
Do **not** call `resolveCwd` unguarded between the two existing try/catch blocks.

Usage (`src/cli.js:80-82`) after:

```
usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N] [--cwd <dir>]
       node src/cli.js --doctor [--config <file>] [--cwd <dir>]
```

## MODIFY `src/paths.js`

`makeRootGuard(roots)` → `makeRootGuard(roots, { cwd } = {})`.

`assertInside(p)` today (`src/paths.js:57-62`):

```js
    let cur = path.resolve(p);
```

After:

```js
    const base = cwd ? path.resolve(cwd) : process.cwd();
    let cur = path.resolve(base, p);
```

Host-absolute `p` (`path.isAbsolute(p)` on **this** OS) ignores `cwd`. A foreign-OS absolute (e.g. `C:\\foo` on darwin) is **not** host-absolute; `path.resolve(base, p)` may join it as a relative segment. Do not treat that as a successful Windows path.
If `cwd` is set and is not inside any root, do **not** auto-widen roots.
`assertInside` on a relative file still fails if the resolved path escapes roots.

Export `guard.cwd = cwd ? path.resolve(cwd) : undefined` for `--doctor`.

Pass `{ cwd: workCwd }` into `makeRootGuard`.

`--doctor` report gains `cwd: workCwd`.

Keep `--cwd` in argv; `loadConfig` ignores it.

Activation: `codemode --cwd /tmp/proj --code "return await fs.exists('README.md')"`
with roots including `/tmp/proj` → true when that file exists. Same call without
`--cwd` from another process cwd → looks at that cwd's README (or miss).

## MODIFY `src/server.js`

Do **not** add MCP cwd in this phase. Shared `makeRootGuard` default (no cwd)
keeps current daemon-cwd behavior for the unused MCP process.

## NEW `test/cwd.test.js`

Cases:
1. `--cwd` wins over `CODEMODE_CWD` and process cwd (call `resolveCwd` directly).
2. `CODEMODE_CWD` wins over process cwd.
3. `makeRootGuard([root], { cwd: root })` + relative `'a.txt'` after `fs.write` via absolute path — `assertInside('a.txt')` equals `path.join(root,'a.txt')`.
4. relative path resolving outside roots throws `RootEscapeError`.
5. `--cwd` pointing outside roots does not throw at guard construction; only the escaped file path throws.
6. CLI subprocess: `node src/cli.js --cwd` (no dir) → stdout JSON `{ok:false,error}` contains `requires a directory`, exit 1.
7. CLI subprocess: `node src/cli.js --doctor --cwd <tmpdir>` → exit 0, parsed `cwd` equals resolved tmpdir.

Verifier: `npm test` — `package.json:11` `node --test "test/*.test.js"` includes `test/cwd.test.js`. Baseline this P: exit 0, 47 tests. After B: 47 + new cwd tests, exit 0.

Conditional path (C-ACTIVATION-GROUNDING-01): missing `--cwd` value (`--cwd` last argv) throws before runCode; observable `{ok:false,error}` from `fail()`.
