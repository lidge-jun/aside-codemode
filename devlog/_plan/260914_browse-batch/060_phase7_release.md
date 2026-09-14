# 060 — Phase wp7: release (version, public SoT, main, doctor)

Unit: `devlog/_plan/260914_browse-batch/`. Implementation-phase doc (060-range).
Closes **#23**. Depends on wp2–wp6 having landed on `origin/dev`. Does not
re-implement capture, extract, cache, or the session spawn path.

This file is the copy-paste PRD for wp7. An implementer who has not seen the
conversation should be able to land the docs/version bump, merge `dev` into
`main`, and close #6–#23 from this document alone.

Re-verify line numbers against the tree at the start of wp7. wp2–wp6 will have
moved README / `GUEST_API_DOC` / doctor lines. Quoted `path:line` below is
current HEAD of this docs-only pass (`src/` still has no `browse/` directory).
Guest **names** for wp2/wp4/wp5 are locked by 010/030/040; wp6 names are locked
by [050](050_phase6_repetition.md): `browse.searchMany`, `browse.downloadMedia`,
`browse.watch`, `browse.prefetch`, and root `recipes.run|list|describe|check`.
No `web` or `media` root. #15 is the file cache, not a guest verb.

---

## 1. Purpose and issues closed

#23 is the tracking issue: ship the A-shaped guest surface (`browse.*` /
`report.*`, plus the one-level roots later phases added) with a B-shaped
engine (Aside REPL CLI, not Playwright/CDP). Closing it means the public
package on `origin/main` actually contains that namespace, CI on that SHA is
green on all five combos, and a global install from `main` runs
`codemode --doctor`.

Independently verifiable at close (000): `origin/main` contains the `dev`
head that wp7 tagged 0.2.0, hosted CI on that SHA is `completed/success` on
all five matrix jobs, and `codemode --doctor` after `npm install -g .` from
that SHA prints JSON whose `version` is `"0.2.0"`.

This phase also closes the tracking loop for #6–#22: each already has a phase
that implemented it; wp7 is the evidence-gated `gh issue close`. #11's
resource-blocking half stays **refused** (001 E3), not faked.

---

## 2. Scope

### IN

- MODIFY `package.json` — version `0.1.0` → `0.2.0`, description names the
  new public guest namespaces. No `dependencies` key. `engines.node` stays
  `>=18`.
- MODIFY `README.md` / `README.ko.md` — final Guest API table (union of
  landed names), measured browse constraints, keep the `NPM_CONFIG_PREFIX`
  pitfall, add a Windows prefix sentence.
- MODIFY `templates/AGENTS.codemode.md` — available-tools + `--doctor --browse`
  + do-not-kill-the-CLI.
- MODIFY `src/tools.js` `GUEST_API_DOC` — reconcile so every REGISTRY path
  has a bullet. `inputSchema` stays `{code, timeoutMs}`.
- MODIFY `src/cli.js` doctor payload — add `version` from `package.json` so
  a stale global binary cannot impersonate 0.2.0.
- NEW `test/guest-api-sot.test.js` — documentation SoT: every guest path in
  `REGISTRY` appears in README / README.ko / AGENTS / `GUEST_API_DOC`.
- Release sequence: confirm `origin/dev` CI green on all five combos, merge
  `dev` into `main` with `--no-ff`, push, `git ls-remote` on
  `refs/heads/main`, wait for and verify the `main` CI run.
- Deploy verify: global install from that `main` SHA, then `codemode --doctor`
  including the `NPM_CONFIG_PREFIX` pitfall.
- Issue-closing checklist for #6–#23.
- Rollback plan if `main` CI goes red. **No force-push to `main`.**

### OUT

- Any `src/host/browse/**` or `src/host/report/**` behaviour change.
- New npm dependencies. A bundled browser. Playwright/CDP.
- `npm publish` to the registry. README install remains clone +
  `npm install -g .`.
- Force-push, `git reset --hard` of `origin/main`, or rewriting `main`
  history.
- Tests that launch a browser or call live `aside repl`. Timing as a
  correctness oracle.
- Closing #11 as "resource blocking shipped". Blocking is not implementable
  (`page.route` absent, `p.on('request')` delivered 0 events — 001 E3).
- Changing file/search semantics, the `node:vm` trust model, or
  `~/.aside` credentials.

### Binding evidence this phase must not contradict

| Id | Fact | Consequence here |
| --- | --- | --- |
| E1 | Aside CLI exit code is 0 on failure; trailer is `[ok \| Nms]` / `[error \| Nms]` | Deploy success for a **repl** job is never `aside.exe`'s exit code. `codemode --doctor` **does** use `process.exit(report.ok ? 0 : 1)` (`src/cli.js:78`) — that exit **is** meaningful. |
| E3 | no `page.route`; `p.on('request')` = 0 events | Public docs must say `block` / `route` are `ENOTSUP`. #11 close comment must say blocking is refused. |
| E4 | `screenshot.maxWidth` silently ignored; viewport not settable; `pdf({format:'A4'})` is US Letter; only `paperWidth`/`paperHeight` inches give A4 | README table and `GUEST_API_DOC` must say `maxWidth` / `viewport` / `pdf.format` are `ENOTSUP`. `report.build` item fails unless MediaBox matches (040). |
| E5 | killing the CLI leaks tabs permanently; later sessions cannot close them | AGENTS + README: do not kill the CLI to cancel. Cleanup is script `finally`; host deadline below in-script deadline. |
| E6 | one repl = one session, ~1.4–2.4s overhead, 120s cap; 5 pages 908ms parallel vs 3397ms sequential | Docs describe batch-in-one-call, not one process per URL. |
| CI | `.github/workflows/ci.yml:15-25` is five combos, `fail-fast: false`, `cancel-in-progress: true` | "Green" means **all five job names** `success` on the **exact head SHA**. A cancelled run is not green. A later push cancels the run you were watching. |
| Doctor | `--doctor` currently runs **after** `makeRootGuard` (`src/cli.js:45-79`) | wp2 already moves this (010 §3.15). wp7 does not re-do that move; it only adds `version`. `--doctor` without `--browse` must not require Aside (CI has none). |
| Prefix | `README.md:33-37` | Aside sets `NPM_CONFIG_PREFIX`, which wins over npm's default prefix. Global install proof must check **which binary** `codemode` resolved, not only that some `codemode` exists. |

Amendment to #23's option A (`cdpUrl|playwright`): 000 decided A-shaped
surface, B-shaped engine. Public docs must not claim Playwright.

---

## 3. File change map

| Path | Op | Role |
| --- | --- | --- |
| `package.json` | MODIFY | `0.2.0` + description; no deps |
| `src/cli.js` | MODIFY | doctor `version` field |
| `src/tools.js` | MODIFY | final `GUEST_API_DOC` bullets |
| `README.md` | MODIFY | intro, Guest API table, constraints, prefix |
| `README.ko.md` | MODIFY | same names, Korean role text |
| `templates/AGENTS.codemode.md` | MODIFY | tools + doctor --browse + leak warning |
| `test/guest-api-sot.test.js` | NEW | SoT presence test, no browser |
| `.github/workflows/ci.yml` | (none) | five-combo matrix is the verifier target, not an edit |
| `src/host/browse/**` | (none) | already landed by wp2–wp6 |

Do not add `index.js` barrels. Do not add `CHANGELOG.md` (not in this
repo's convention today). Do not add a `web` root — 010 forbade it;
`web.readText` shipped as `browse.readText` (030); `web.searchMany` if
needed is `browse.searchMany` unless 050 added a one-level root and
documented it.

050 locked the extra names. wp7's SoT union **must** include them:
`browse.searchMany`, `browse.downloadMedia`, `browse.watch`,
`browse.prefetch`, `recipes.run`, `recipes.list`, `recipes.describe`,
`recipes.check`. wp6 adds `recipes` to `ROOTS` (050); wp7 does not.

---

### 3.1 Version number (decision)

Current `package.json:3`:

```json
  "version": "0.1.0",
```

Ship **`0.2.0`**.

| Candidate | Why not / why |
| --- | --- |
| `0.1.1` | Patch. This is a new public guest namespace (`browse.*`, `report.*`, `api.*`), not a bugfix of 0.1.0. |
| `0.2.0` | **Chosen.** 0.x minor for an additive public contract. Existing `search.*` / `fs.*` / `read_file` stay. Browse is opt-in (`browseCaps.enabled`). |
| `1.0.0` | Over-claims stability. The engine is Aside REPL with documented ENOTSUP (route, viewport, `pdf.format`), kill-leaks-tabs (E5), and CLI exit 0 on failure (E1). 1.0.0 would freeze that as a stable promise. |

Semver on 0.x: a new public namespace is a minor, not a patch. Stay in 0.x
until the ENOTSUP set shrinks or is accepted as the 1.0 contract on purpose.

---

### 3.2 MODIFY `package.json`

Current `package.json:1-24`:

```json
{
  "name": "aside-codemode",
  "version": "0.1.0",
  "description": "CLI code mode for the Aside agent: one `codemode --code` guest with Aside-shaped file tools and rg-backed search",
  "type": "module",
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "test": "node scripts/run-tests.mjs"
  },
  "bin": {
    "codemode": "bin/codemode.mjs"
  },
  "files": [
    "bin/",
    "src/",
    "scripts/",
    "templates/",
    "codemode.config.example.json",
    "README.md",
    "README.ko.md",
    "LICENSE"
  ]
}
```

After — only `version` and `description` change. Do **not** add
`dependencies`. Do **not** drop `README.ko.md` from `files` (CI step
`npm pack --dry-run` at `.github/workflows/ci.yml:42-43` is the pack
oracle).

```json
{
  "name": "aside-codemode",
  "version": "0.2.0",
  "description": "CLI code mode for the Aside agent: one `codemode --code` guest with Aside-shaped file tools, rg-backed search, and opt-in browse/report host globals (Aside REPL engine, not Playwright)",
  "type": "module",
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "test": "node scripts/run-tests.mjs"
  },
  "bin": {
    "codemode": "bin/codemode.mjs"
  },
  "files": [
    "bin/",
    "src/",
    "scripts/",
    "templates/",
    "codemode.config.example.json",
    "README.md",
    "README.ko.md",
    "LICENSE"
  ]
}
```

`bin/codemode.mjs:1-10` already resolves `src/cli.js` relative to the
install, so a global link keeps working. Do not point the bin at `src/cli.js`
directly (AGENTS already forbids invoking `src/cli.js`).

---

### 3.3 MODIFY `src/cli.js` — doctor `version`

wp2 rewrites the doctor branch (010 §3.15) so it still prints when roots are
missing and so `--doctor --browse` attaches the capability matrix. **At the
start of wp7, patch the landed doctor object, not the pre-wp2 block.**

Current pre-wp2 block (`src/cli.js:57-78`) for orientation only:

```js
if (has('--doctor')) {
  const report = {
    ok: true,
    node: process.version,
    platform: process.platform,
    cwd: workCwd,
    roots: assertInside.roots,
    missingRoots: assertInside.missingRoots,
    configSources: config._sources,
    rgPath: config.rgPath,
    excludeGlobs: config.excludeGlobs,
  };
  // ...
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}
```

After (shape to merge into the wp2 object):

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
```

Place the import with the other imports (`src/cli.js:5-11` today). Do **not**
use `import pkg from '../package.json' assert { type: 'json' }` — Node 18.0
in the CI matrix (`.github/workflows/ci.yml:16-17`) is the floor;
`createRequire` is the portable read.

Inside the doctor `report` object, first field after `ok`:

```js
    ok: true,
    version: pkg.version,
    node: process.version,
```

`version` must be enumerable so `JSON.stringify` keeps it. Do not read
`process.env.npm_package_version` — that is unset for a global bin.

`--doctor` without `--browse` still must not require Aside (010 S44,
`test/cwd.test.js:68-74` stays exit 0). Adding `version` does not change
`ok` rules: `ok` tracks rg (+ roots) unless `--browse` is present.

Usage line (`src/cli.js:84` today; wp2 adds `[--browse]`):

```
       node src/cli.js --doctor [--browse] [--config <file>] [--cwd <dir>]
```

Bare `--browse` without `--doctor` still falls through to usage/exit 2
(002: unknown flags are ignored; 010 keeps that).

---

### 3.4 MODIFY `src/tools.js` — final `GUEST_API_DOC`

SOT-SYNC-01 (000): guest-visible names live in the README tables,
`GUEST_API_DOC`, and the actions REGISTRY. wp2/wp4/wp5 already insert
bullets in their C. wp7 **reconciles**. At start of wp7:

1. Read `REGISTRY` via `createActions().list()` (`src/host/actions.js`; wp2
   splices `BROWSE_ACTIONS`; wp5 splices `API_ACTIONS` / `REPORT_ACTIONS`;
   wp6 splices its own). `hostMethods` walks one level (`src/sandbox.js:9-20`).
2. Diff `path` values against `GUEST_API_DOC`.
3. Add any missing bullet. Delete bullets for names that were never
   registered. Do not keep `web.readText` or `web.searchMany` unless 050
   actually registered a `web` root (it must not; 010 + 030).

Current bullets `src/tools.js:7-23`. After the actions bullet
(`src/tools.js:19`) the landed set must include **at least** these
(signatures from 010/030/040; do not rewrite them into a different contract):

```
  '- browse.exec({ urls, timeoutMs?, waitUntil?, snapshot?, screenshot?, pdf? }) => {items,timings,slowest,complete,truncated,partial,leakedUrls,status,scope} — one Aside repl job. Engine is the Aside CLI, not Playwright. viewport/maxWidth/pdf.format/route are ENOTSUP. Killing the CLI leaks tabs; that path returns partial plus leakedUrls.',
  '- browse.probe() => capability matrix (static; --doctor --browse). Does not spawn a browser unless CODEMODE_BROWSE_LIVE=1.',
  '- browse.captureMany(items[], {concurrency?, outDir?, text?, type?, quality?}) => {items,complete,partial,leakedUrls,scope} — one Aside repl, in-script tab pool. Per-item {error}; siblings kept. maxWidth is ENOTSUP (Aside ignores it; clip is the geometry control). JPEG quality default 90.',
  '- browse.screenshot({url, selector?, clip?, margin?, type?, quality?, outDir}) — captureMany wrapper. There is no page handle.',
  '- browse.readText(url|url[], {fallback?, concurrency?}) => {title,markdown,byline,publishedAt,links,needsBrowser,engine} — host fetch then readability. Browser fallback only when detectJsRequired is true and fallback is whenRequired|always. Issue #8 name web.readText ships as browse.readText (hostMethods is one-level).',
  '- browse.extract(url, schema, { waitFor?, timeoutMs? }) => {ok,url,data,missing,hints} — CSS extract to typed JSON. Does not return a snapshot. type: krw|usd|int|date|string. Missing fields are null + nearby-text hints. Default wait is domcontentloaded, never networkidle. block/route is ENOTSUP (Aside has no page.route; request events are zero).',
  '- browse.snapshot(url, { compact?, waitFor?, timeoutMs? }) => {tree?,refs,diff,hash,cached,truncated} — accessibility snapshot. Repeat in the same execute_code omits tree and returns diff only. compact keeps named roles. Over-size trees auto-compact with truncated:true.',
  '- browse.open(url, { waitFor?, timeoutMs? }) => {ok,url,title,wait} — navigate + wait + close. No page handle survives the call.',
  '- api.batch([{kind, ...}]) => {items,complete,partial} — public YouTube oEmbed, iTunes lookup, Play Store details HTML in parallel. slack.history returns EAUTH (token required, out of scope). Guest still has no fetch.',
  '- report.build({ template:\'paged-report\', title, date?, sections, out, paperWidth?, paperHeight? }) => {ok,pdf,pages,mediaBox,qa,items} — Aside pdf() with paperWidth/paperHeight in inches (A4 default). format:\'A4\' is ENOTSUP (silently Letter). The item fails if MediaBox is not the requested box even when the file exists. chrome: is ENOTSUP.',
```

Then append 050's bullets (050 §5.14), using that signature text:

```
  '- browse.searchMany([{q, within?}], {dedupe?, max?, engine?}) => {items,complete,partial} — parallel web search. Default engine is DuckDuckGo HTML. URL dedupe keeps the first query. within is 14d/2w/1m/1y. engine:\'google\' is ENOTSUP until a googleSearch callable is proven. Pipe URLs into browse.readText. There is no web.* guest root.',
  '- browse.downloadMedia(kind, {outDir, id?, videoId?, url?}) => {ok,files} — original image bytes from iTunes screenshotUrls, Play img src, YouTube i.ytimg.com, or X og:image. Never page.screenshot.',
  '- browse.watch([{url, selector?}], {store?}) => {items} — persist text hashes; unchanged URLs return {changed:false} only.',
  '- browse.prefetch(urls, {mode?, force?}) => {warmed,skipped,failed} — warm the tmpdir TTL cache. No daemon.',
  '- recipes.run(name, args) / recipes.list / recipes.describe / recipes.check — site recipes with no LLM turn. Built-ins: playstore.whatsnew, appstore.app, youtube.shorts.search. .js recipe files are ENOTSUP.',
```

Also keep the 010 sentence on the last contract bullet (`src/tools.js:21`
today): `browse.*` results are plain objects; they do not use the search
`{rows,...}` envelope.

`inputSchema` stays `{code, timeoutMs}` (`src/tools.js:28-36`). Do not add
a browse-specific MCP tool. `TOOL_NAME` stays `execute_code`.

Opening line (`src/tools.js:8`) currently says "local search and file tools".
After:

```
  'Run JavaScript that orchestrates local search, file tools, and opt-in browse/report/api host RPCs in ONE call, instead of many separate tool calls.',
```

The "no direct require/process/fetch/network API" line (`src/tools.js:10`)
stays. `browse.readText` / `api.batch` are host RPCs; the guest still has
no `fetch`.

---

### 3.5 MODIFY `README.md`

#### 3.5.1 Intro

Current `README.md:7-9`:

```
**aside-codemode** gives Aside a single place to search, filter, read and summarize local files. Keep intermediate data out of the model context; return the answer and the evidence needed to judge it.

Aside exec does not attach MCP servers on current builds. The working path is one `bash` call to the `codemode` CLI plus a rule in `~/.aside/u/0/AGENTS.md`. File cards in the Aside UI still come from native `read_file` / `write_file` / `edit_file`. Guest JavaScript uses those same shapes.
```

After, keep both paragraphs and insert one sentence after the first:

```
**aside-codemode** gives Aside a single place to search, filter, read and summarize local files. Keep intermediate data out of the model context; return the answer and the evidence needed to judge it. From 0.2.0 an opt-in `browse.*` / `report.*` / `api.*` guest namespace batches browser and public-API work the same way — the engine is the already-installed Aside REPL CLI, not Playwright, not a bundled browser.

Aside exec does not attach MCP servers on current builds. The working path is one `bash` call to the `codemode` CLI plus a rule in `~/.aside/u/0/AGENTS.md`. File cards in the Aside UI still come from native `read_file` / `write_file` / `edit_file`. Guest JavaScript uses those same shapes. Browse calls also render as bash cards; they do not create native file cards.
```

Do not change Requirements (`README.md:11-15`): Node >= 18, ripgrep, macOS
and Windows. Do not add Playwright as a requirement. Aside CLI is optional
until the guest actually calls `browse.exec` / `captureMany`;
`browse.probe` and `--doctor` without `--browse` must work without it.

#### 3.5.2 Global install — keep the pitfall, add Windows

Current `README.md:17-37` stays, including:

the `NPM_CONFIG_PREFIX` paragraph at `README.md:33-37` and the Homebrew
example `npm install -g --prefix=/opt/homebrew .`. Do not delete those lines.

After that fenced block, add one paragraph. Do not replace the Homebrew
example (it is the macOS form):

```
Windows: the same env var wins. `npm install -g .` can succeed and still leave `codemode` off PATH, or leave you running a stale 0.1.0. Check with `npm prefix -g` and `where.exe codemode` (then `codemode --doctor` and read `version`). If the prefix is not a PATH directory, re-install with `npm install -g --prefix=<dir-on-PATH> .`. Unset `NPM_CONFIG_PREFIX` in that shell if you want npm's default prefix.
```

The clone URL stays `https://github.com/lidge-jun/aside-codemode.git`. wp7
install-from-main uses `origin/main` at the verified SHA, not a random
`dev` checkout.

#### 3.5.3 Guest API table

Current table `README.md:47-55`:

```
| Name | Role |
| --- | --- |
| `search.files` / `search.content` / `search.count` | ripgrep-backed list, content, pre-flight counts |
| `read_file({ path, offset?, limit? })` | Aside-shaped read. `offset` / `limit` are 1-indexed **lines**. Unpaged reads over 262144 bytes throw |
| `write_file({ file_path, content })` | Aside-shaped create-only (`wx`). Overwrite throws |
| `edit_file({ path, appendText?, edits })` | Unique `oldText` → `newText` on the original file |
| `apply_patch(text)` | Guest helper. Codex `*** Begin Patch` text → `write_file` / `edit_file`. Success `{}`. Not an AGENTS verb |
| `fs.readMany` / `grepFile` / `mkdir` / `stat` / `exists` / `list` | Compound helpers. `fs.read` / `fs.write` are deprecated byte / overwrite aliases |
| `actions.list` / `find` / `describe` / `check` | In-sandbox discovery |
```

wp2/wp4/wp5 already append rows in their C; those inserts will have shifted
line numbers. wp7's after-state is the **union**, not a second copy of the
search rows. Final table (existing seven rows unchanged, then):

```
| `browse.probe()` | Static Aside capability matrix. `codemode --doctor --browse`. Does not spawn `repl` unless `CODEMODE_BROWSE_LIVE=1` |
| `browse.exec({ urls, timeoutMs?, snapshot?, screenshot?, pdf? })` | One Aside `repl` job. Plain envelope with `items`, timings, complete/truncated/partial/leakedUrls. `viewport` / `maxWidth` / `pdf.format` / `route` are `ENOTSUP` |
| `browse.captureMany` | One Aside repl, in-script tab pool, screenshot+text. Per-item `{error}`. `maxWidth` is ENOTSUP; pass `clip` or `selector` |
| `browse.screenshot` | `captureMany` wrapper. No page handle |
| `browse.readText` | Host fetch → markdown. Browser fallback only when JS is required and `fallback` is on. Guest still has no `fetch` |
| `browse.extract` / `browse.snapshot` / `browse.open` | CSS extract (no snapshot dump); cached compact snapshot; navigate+wait+close. Default wait `domcontentloaded`, never `networkidle`. `block` is ENOTSUP |
| `api.batch` | Public YouTube oEmbed, iTunes lookup, Play details HTML. Slack history needs auth and returns EAUTH |
| `report.build` | Paged HTML → Aside `pdf()` in inches. Item fails unless MediaBox matches. `format: 'A4'` is ENOTSUP (silently Letter) |
```

Then the 050 rows (050 §5.18):

```
| `browse.searchMany` | Parallel web search, URL dedupe, `within` date filter. Default engine is DuckDuckGo HTML. `googleSearch` is ENOTSUP until a callable is proven |
| `browse.downloadMedia` | Original image bytes (iTunes / Play / YouTube thumb / X og:image). Not a page screenshot |
| `browse.watch` | Persist text hashes; diffs only for changed URLs |
| `browse.prefetch` | Warm the tmpdir TTL cache. No daemon |
| `recipes.run` / `list` / `describe` / `check` | Site recipes, no LLM turn. JSON steps only |
```

Do not invent `web.*` or `media.*`. Do not invent `browse.tab.open` (002:
`hostMethods` walks one level, `src/sandbox.js:9-20`). One sentence under
the table from 050: the file cache lives under `os.tmpdir()`, is **not** a
security boundary, and is keyed by account/profile/auth/locale/viewport/schema
version so parallel `execute_code` processes share hits.

`README.md:45` stays true:

```
The guest API does not expose `require`, `process`, `fetch`, or network tools.
```

`browse.readText` / `api.batch` are host RPCs, not a guest `fetch`.

#### 3.5.4 NEW subsection after the Guest API table

Insert after the table (before `**.gitignore is on by default**` at
`README.md:57`) a short constraints block. This is the public form of 001:

```
### Browse constraints (measured, Aside REPL)

These are not Playwright bugs we can patch in this repo. The host refuses
options Aside would silently ignore:

- `page.route` is absent. `page.on('request')` delivered zero events. Resource blocking (#11) is not implemented; `block` is `ENOTSUP`.
- `screenshot.maxWidth` is ignored by Aside; `viewportSize` is not settable. Geometry is `clip` (or a selector crop). Passing `maxWidth` / `viewport` throws `ENOTSUP` rather than producing a 1440px image and reporting success.
- `pdf({ format: 'A4' })` produced US Letter (`MediaBox 0 0 612 792`). `report.build` sends `paperWidth` / `paperHeight` in inches and **fails the item** if the file's MediaBox is not that box.
- The Aside CLI exits 0 on in-script failure. Success of a repl job is the trailing `[ok | Nms]` marker plus the claimed files, not the process exit code. `codemode --doctor` is different: its exit **is** `report.ok`.
- Killing `aside.exe` leaks tabs permanently. Later CLI sessions cannot close them. Cancellation is deadline-driven; the compiled script closes tabs in `finally`. Do not `taskkill` the CLI to cancel.
- One `repl` invocation is one session (fresh `pwd`, ~1.4–2.4s process overhead, 120s cap). Put N URLs in one script. Five pages measured 908ms parallel vs 3397ms sequential inside one invocation.

`browseCaps.enabled: false` (or missing Aside when a spawn is required) throws `EDISABLED` / resolver error on `browse.exec` / `captureMany`. `browse.probe()` still returns the matrix.
```

Do not paste probe scripts. Do not claim a speedup number for browsing in
this README; 000's 51x folder number is search, not browse.

---

### 3.6 MODIFY `README.ko.md`

Same structure, same **identifiers**. Do not translate `browse.captureMany`,
`ENOTSUP`, `MediaBox`, `NPM_CONFIG_PREFIX`.

Intro after `README.ko.md:7`, one added sentence:

```
0.2.0부터 opt-in `browse.*` / `report.*` / `api.*` 게스트 네임스페이스가 브라우저·공개 API 작업도 같은 방식으로 묶습니다. 엔진은 이미 설치된 Aside REPL CLI이며 Playwright나 번들 브라우저가 아닙니다.
```

Guest API table after `README.ko.md:55` (union; Korean role text):

```
| `browse.probe()` | Aside 능력 행렬. `codemode --doctor --browse`. `CODEMODE_BROWSE_LIVE=1`이 아니면 `repl`을 띄우지 않습니다 |
| `browse.exec({ urls, timeoutMs?, snapshot?, screenshot?, pdf? })` | Aside `repl` 한 번. `items`·timings·complete/truncated/partial/leakedUrls. `viewport` / `maxWidth` / `pdf.format` / `route`는 `ENOTSUP` |
| `browse.captureMany` | Aside repl 한 번, 스크립트 안 탭 풀, 스크린샷+텍스트. 항목 실패는 `{error}`. `maxWidth`는 ENOTSUP, `clip`/`selector` 사용 |
| `browse.screenshot` | `captureMany` 래퍼. page 핸들 없음 |
| `browse.readText` | 호스트 fetch → 마크다운. JS가 필요할 때만 브라우저 폴백. 게스트에 `fetch`는 없습니다 |
| `browse.extract` / `browse.snapshot` / `browse.open` | CSS 추출(스냅샷 덤프 없음); 캐시된 compact 스냅샷; 이동+대기+닫기. 기본 대기는 `domcontentloaded`, `networkidle` 없음. `block`은 ENOTSUP |
| `api.batch` | 공개 YouTube oEmbed, iTunes lookup, Play 상세 HTML. Slack history는 인증이 필요하고 EAUTH |
| `report.build` | paged HTML → Aside `pdf()` (인치). MediaBox가 요청과 다르면 항목 실패. `format: 'A4'`는 ENOTSUP (조용히 Letter) |
```

Then the 050 rows, same identifiers:

```
| `browse.searchMany` | 웹검색 병렬, URL 중복 제거, `within` 날짜 필터. 기본 엔진은 DuckDuckGo HTML. `googleSearch`는 callable이 증명되기 전까지 ENOTSUP |
| `browse.downloadMedia` | 원본 이미지 바이트 (iTunes / Play / YouTube thumb / X og:image). 페이지 스크린샷 아님 |
| `browse.watch` | 텍스트 해시 저장. 바뀐 URL만 diff |
| `browse.prefetch` | tmpdir TTL 캐시 워밍. 데몬 없음 |
| `recipes.run` / `list` / `describe` / `check` | 사이트 레시피, LLM 턴 없음. JSON 스텝만 |
```

`README.ko.md:33-37` keeps the `NPM_CONFIG_PREFIX` pitfall. After the
Homebrew example, the same Windows paragraph as 3.5.2 in Korean:

```
Windows도 같은 환경 변수가 이깁니다. `npm install -g .`이 성공해도 `codemode`가 PATH에 없거나 옛 0.1.0을 실행할 수 있습니다. `npm prefix -g`와 `where.exe codemode`로 확인한 뒤 `codemode --doctor`의 `version`을 읽으세요. prefix가 PATH 디렉터리가 아니면 `npm install -g --prefix=<PATH에 있는 디렉터리> .`로 다시 설치합니다.
```

Constraints subsection title: `### 브라우즈 제약 (실측, Aside REPL)`. Same
six bullets as 3.5.4, Korean prose, English identifiers.

---

### 3.7 MODIFY `templates/AGENTS.codemode.md`

Current tools sentence `templates/AGENTS.codemode.md:9-16`:

```
Code is an async function body. Use `await` for tool operations and `return` for
the answer. Available tools: `search.files|content|count`,
`read_file({path, offset?, limit?})` (1-indexed lines),
`write_file({file_path, content})` (create-only),
`edit_file({path, edits, appendText?})`, and compound `fs.*` helpers.
`apply_patch(text)` is a guest helper, not a separate AGENTS command.
```

wp2 already appends `browse.exec|probe`; wp4/wp5 append more. wp7 after-state
of that paragraph:

```
Code is an async function body. Use `await` for tool operations and `return` for
the answer. Available tools: `search.files|content|count`,
`read_file({path, offset?, limit?})` (1-indexed lines),
`write_file({file_path, content})` (create-only),
`edit_file({path, edits, appendText?})`, compound `fs.*` helpers,
`browse.probe|exec|captureMany|screenshot|readText|extract|snapshot|open`,
`browse.searchMany|downloadMedia|watch|prefetch`,
`api.batch`, `report.build`, and `recipes.run|list|describe|check`.
`apply_patch(text)` is a guest helper, not a separate AGENTS command.
When browse is enabled, batch URLs in one `--code` call. Do not spawn `aside`
from the agent card and do not kill the CLI to cancel — leaked tabs cannot be
closed later. `maxWidth`, `viewport`, `pdf.format`, and `block`/`route`
are ENOTSUP. Default wait is `domcontentloaded`, never `networkidle`.
Guest has no `fetch`; `browse.readText`, `browse.searchMany`, `api.batch`,
and `browse.downloadMedia` are host RPCs. Do not call `googleSearch` from the
guest (`engine:'google'` is ENOTSUP until a callable is proven).
```

050 already adds `recipes` to `ROOTS`. wp7 only documents it.

Current doctor sentence `templates/AGENTS.codemode.md:31`:

```
run `{{NODE}} {{CLI}} --doctor`.
```

After (010 already asks for this; wp7 must still be present after later
appends):

```
If resolution looks wrong, run `{{NODE}} {{CLI}} --doctor`. If browsing is
needed, run `{{NODE}} {{CLI}} --doctor --browse` and read `version`,
`browse.page.absent`, and `browse.asideResolved`. Do not look up `aside`
on PATH from the agent card.
```

Keep `{{NODE}}` `{{CLI}}` `{{CWD_HINT}}`. Do not tell the agent to
`npm install -g`.

---

### 3.8 NEW `test/guest-api-sot.test.js`

Zero dependencies. `node:test` + `node:assert/strict`. Reads files from
disk; does **not** spawn Aside; does **not** use elapsed time.

```js
// test/guest-api-sot.test.js
// wp7 — public SoT: every REGISTRY path is named in README / README.ko /
// templates/AGENTS.codemode.md / GUEST_API_DOC. No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createActions } from '../src/host/actions.js';
import { TOOL_DEF } from '../src/tools.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const SOURCES = {
  readme: read('README.md'),
  readmeKo: read('README.ko.md'),
  agents: read('templates/AGENTS.codemode.md'),
  guestDoc: TOOL_DEF.description,
};

function guestPaths() {
  return createActions().list()
    .map((row) => row.path)
    .filter((p) => /^(browse|report|api|recipes)\./.test(p));
}

test('package version is 0.2.0 and has no dependencies', () => {
  assert.equal(pkg.version, '0.2.0');
  assert.equal(pkg.engines.node, '>=18');
  assert.equal('dependencies' in pkg, false);
  assert.match(pkg.description, /browse\/report/);
  assert.match(pkg.description, /not Playwright/);
});

test('every browse/report/api/recipes REGISTRY path is in all four SoTs', () => {
  const paths = guestPaths();
  assert.ok(paths.includes('browse.probe'), paths.join(','));
  assert.ok(paths.includes('browse.captureMany'), paths.join(','));
  assert.ok(paths.includes('browse.searchMany'), paths.join(','));
  assert.ok(paths.includes('browse.downloadMedia'), paths.join(','));
  assert.ok(paths.includes('browse.watch'), paths.join(','));
  assert.ok(paths.includes('browse.prefetch'), paths.join(','));
  assert.ok(paths.includes('report.build'), paths.join(','));
  assert.ok(paths.includes('api.batch'), paths.join(','));
  assert.ok(paths.includes('recipes.run'), paths.join(','));
  assert.ok(paths.filter((p) => p.startsWith('browse.')).length >= 12, paths.join(','));
  for (const name of paths) {
    for (const [label, text] of Object.entries(SOURCES)) {
      assert.ok(text.includes(name), name + ' missing from ' + label);
    }
  }
});

test('public docs do not claim Playwright engine or guest fetch', () => {
  assert.match(SOURCES.readme, /not Playwright/);
  assert.doesNotMatch(SOURCES.readme, /cdpUrl\|playwright/);
  assert.doesNotMatch(SOURCES.agents, /Playwright/);
  assert.match(SOURCES.readme, /ENOTSUP/);
  assert.match(SOURCES.readme, /NPM_CONFIG_PREFIX/);
  assert.match(SOURCES.readmeKo, /NPM_CONFIG_PREFIX/);
  assert.match(SOURCES.readme, /MediaBox/);
  assert.match(SOURCES.guestDoc, /no direct require\/process\/fetch/);
});

test('README.ko keeps English guest identifiers', () => {
  for (const name of guestPaths()) {
    assert.ok(SOURCES.readmeKo.includes(name), name);
  }
});

test('inputSchema stays code + timeoutMs', () => {
  assert.deepEqual(Object.keys(TOOL_DEF.inputSchema.properties).sort(), ['code', 'timeoutMs']);
  assert.equal(TOOL_DEF.inputSchema.additionalProperties, false);
});
```

Use `createActions().list()` rather than exporting `REGISTRY`, matching
`test/actions.test.js:11` (`list().length >= 11` is a floor, not exact).
The only `src/host/actions.js` edit allowed in wp7 is none, unless `list()`
does not yet return browse rows after wp2–wp6 — then the bug is in those
phases, not here.

Red-green for docs: run this test **before** adding the README rows on a
tree that already has browse in REGISTRY. It must fail (names missing from
README). Then add the rows; it must pass. On this docs-only HEAD REGISTRY
has no browse paths yet — implement the test in wp7 after wp2–wp6, not now.

Do not import `session.js`. Do not set `CODEMODE_BROWSE_LIVE`.

---

### 3.9 NOT modified in wp7

| File | Why |
| --- | --- |
| `src/host/browse/**`, `src/host/report/**` | Behaviour already landed |
| `src/sandbox.js` ROOTS | wp2 adds `browse`/`report`; wp5 adds `api`; wp6 adds `recipes`. wp7 does not invent `web` or `media` |
| `src/execution-worker.js` | wp2 freeze |
| `.github/workflows/ci.yml` | five combos already correct; do not add an Aside install step (CI has no Aside product on Linux) |
| `package.json` `files` | already includes README / templates / src |
| `test/search-boundary.test.js` | wp2 t8 owns the time-oracle fix; wp7 only consumes the green suite |
| `~/.aside/**` | out of scope |

---

## 4. Dependency order

### 4.1 Edits inside the tree (before any push)

1. Re-verify this doc against the tree: open 010/030/040/050, list every
   `REGISTRY` path, list every README row. If 050's names differ from the
   issue titles, **050 wins**.
2. `package.json` version + description (§3.2).
3. `src/cli.js` doctor `version` (§3.3) on the **landed** doctor object.
4. `src/tools.js` `GUEST_API_DOC` reconcile (§3.4).
5. `README.md` then `README.ko.md` (§3.5–3.6). English first so the Korean
   table can copy identifiers.
6. `templates/AGENTS.codemode.md` (§3.7).
7. `test/guest-api-sot.test.js` (§3.8).
8. Run the local verifier in §6. Do not push a red suite.

Do not merge to `main` before the docs/version commit is on `origin/dev`
**and** that SHA's CI is green on all five combos.

### 4.2 Release sequence (strict order — a skipped step is a stop)

User authorization for this unit already includes push to `origin/dev` per
phase and merge to `main` in wp7 (000). Do not force-push `main`. Do not
push `main` until step 2 is green.

Record every SHA and run id in the wp7 evidence note (devlog, not the
README). Re-read remotes at execution time; the SHAs below are this
docs-only pass and will be stale.

**Step 1 — identify the candidate SHA**

```
git fetch origin
git ls-remote origin refs/heads/dev
```

Let `DEV_SHA` be the object id of `refs/heads/dev`. It must contain the
wp7 version commit (show `package.json` at that SHA and read `"version": "0.2.0"`).
Today's docs-only HEAD is **not** that SHA. This pass saw
`origin/dev` = `dd1b033d41cca394aadfcd125495f5b07b78fd41` and
`origin/main` = `8223264b4e82bea3e8034fad0ff0989bc35fc788`; both will have
moved.

**Step 2 — confirm hosted CI on that exact SHA, all five combos**

```
gh run list --repo lidge-jun/aside-codemode --branch dev --json databaseId,headSha,conclusion,status,event,displayTitle,url
```

Pick the run where `headSha == DEV_SHA` and `event == push`. A
`pull_request` duplicate is not the gate. `status == queued|in_progress`
→ wait (`gh run watch <id>`). Concurrency group in
`.github/workflows/ci.yml:5-7` is `ci-<github.ref>` with
`cancel-in-progress: true`: do not push again while watching.

Then:

```
gh run view <id> --repo lidge-jun/aside-codemode --json conclusion,status,headSha,jobs
```

Require:

- `conclusion == success`
- `headSha == DEV_SHA`
- every one of these job names present with `conclusion == success`:
  - `test (ubuntu-latest, node-18)`
  - `test (ubuntu-latest, node-20)`
  - `test (ubuntu-latest, node-22)`
  - `test (macos-latest, node-22)`
  - `test (windows-latest, node-22)`

The matrix is `.github/workflows/ci.yml:15-25`. `fail-fast: false` so a
green mac job plus a red Windows job is a **red run**. Inspect all five,
not the first success.

A Windows red that is **only** `test/search-boundary.test.js` time-oracle
(000) is a stop if wp2 t8 did not land. Do not merge a known-red suite
"because it is the old flake". After t8, that test is not a time oracle
and a red is a real regression.

Baseline that this unit must not regress: run `34801531821` on `3b566e7`
was `completed/success` (000). That SHA is **not** the merge candidate.
Docs-only run `34806283897` went red on Windows only — proof that "4/5
green" is not the gate.

**Step 3 — merge `dev` into `main` with a merge commit**

```
git fetch origin
git checkout main
git merge --ff-only origin/main
git merge --no-ff origin/dev -m "release 0.2.0: browse/report guest namespace"
git push origin main
```

`--no-ff` is mandatory even if a fast-forward is possible. Rollback (§7) is
`git revert -m 1 <merge_sha>`. A fast-forward leaves no merge commit and
makes "revert the release" a range revert that is easy to get wrong.
**Never `git push --force` / `--force-with-lease` to `origin/main`.**

If `main` and `dev` have diverged (they have as of this pass), the merge
commit has two parents. Conflicts: stop, do not invent a resolution that
drops `main`-only commits. Report the conflicted paths.

**Step 4 — verify `origin/main` with `git ls-remote`**

```
git ls-remote origin refs/heads/main
git rev-parse HEAD
```

The object id of `refs/heads/main` **must equal** the local merge commit
`HEAD`. Also:

```
git ls-remote origin refs/heads/dev
git rev-parse HEAD^2
```

`HEAD^2` (the second parent) must equal `origin/dev`. `HEAD^1` is the
previous `main`. If `ls-remote` does not match, **stop**. Do not close
issues. Do not install from a local worktree and call it `main`.

Let `MAIN_SHA` be that `refs/heads/main` object id.

**Step 5 — wait for and verify CI on `main`**

```
gh run list --repo lidge-jun/aside-codemode --branch main --json databaseId,headSha,conclusion,status,event,url
```

Pick `headSha == MAIN_SHA` and `event == push`. Watch until completed.
Re-run the same five-job inspection as step 2. `npm pack --dry-run` is a
step of that job (`.github/workflows/ci.yml:42-43`); a skipped pack step
(Windows failed tests skip it, as run `34806283897` did) means that combo
is not green.

If this run is red → **rollback §7 immediately**. Do not close issues. Do
not global-install that SHA as the released product.

**Step 6 — deploy verify (global install from `main`, then doctor)**

Use a **fresh clone** or `git fetch` + detached `MAIN_SHA`, not the dirty
worktree. On Windows use a directory from `mkdtemp` / `%TEMP%`, not `/tmp`:

```
git fetch origin
git cat-file -t <MAIN_SHA>     # must be commit
git clone --no-checkout https://github.com/lidge-jun/aside-codemode.git <fresh-dir>
git -C <fresh-dir> checkout --detach <MAIN_SHA>
```

Then the README procedure, **observing the prefix pitfall**:

1. Print `npm prefix -g` and the value of `NPM_CONFIG_PREFIX`
   (`$env:NPM_CONFIG_PREFIX` / `$NPM_CONFIG_PREFIX`).
2. If `NPM_CONFIG_PREFIX` is set and that directory is **not** on PATH,
   this is ACTIVATION P1: `npm install -g .` without `--prefix` will
   plant the bin where `codemode` is not found, or shadow it. Follow
   `README.md:33-37` (macOS Homebrew example) or the Windows sentence in
   §3.5.2.
3. `npm install -g .` (or with `--prefix`).
4. Resolve the binary: `where.exe codemode` / `command -v codemode`.
   The resolved path must live under the prefix you just installed to, not
   an older clone.
5. `codemode --doctor`
6. `codemode --doctor --browse`

Read the JSON. Do not trust exit 0 alone until you have parsed it — but
unlike Aside `repl`, doctor exit **is** `report.ok` (`src/cli.js:78`).
Required fields after wp7:

| Field | `--doctor` | `--doctor --browse` |
| --- | --- | --- |
| `version` | `"0.2.0"` | `"0.2.0"` |
| `node` | starts with `v18` or higher | same |
| `rgResolved` | a real path if rg is installed | same |
| `browse` | may be absent (010 S44) | object present |
| `browse.page.absent` | n/a | includes `"route"` |
| `browse.screenshot.maxWidthHonoured` | n/a | `false` |
| `browse.pdf.formatA4Honoured` | n/a | `false` |
| `browse` kill-leaks-tabs flag (010 key) | n/a | `true` |
| `browse.asideResolved` | n/a | path on a machine with Aside; `null` + `asideError` on CI is exit 1 and is **not** a release failure for CI, but **is** a failure of *this* operator deploy if Aside is installed and still unresolved |

If `version` is `"0.1.0"`, you ran a stale global bin (exactly the
prefix pitfall). Uninstall / re-prefix / re-check `where.exe`. That is
ACTIVATION P2.

Do **not** run live `aside repl` as a release gate. Tests never launch a
browser. A manual smoke of `browse.probe()` via
`codemode --code "return await browse.probe()"` is allowed on the operator
machine; it must not spawn `repl` unless `CODEMODE_BROWSE_LIVE=1`.

**Step 7 — close issues** using §5.6. #23 last.

---

## 5. Testable acceptance criteria

Every conditional path has an **ACTIVATION SCENARIO**. Timing is never the
oracle. Aside `repl` is never the oracle. Hosted CI job conclusions and
file contents are.

### 5.1 Package and doctor version

| # | Path | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| V1 | version bump | Read `package.json` after the wp7 commit. | `"version": "0.2.0"`. Not 0.1.1, not 1.0.0. |
| V2 | description | same file. | mentions browse/report and `not Playwright`. Still `engines.node === ">=18"`. no `dependencies` key. |
| V3 | pack tarball name | `npm pack --dry-run` in the commit. | stdout contains `0.2.0` in the tarball name and includes `README.md`, `README.ko.md`, `LICENSE`, `templates/AGENTS.codemode.md`, `src/cli.js`. |
| V4 | doctor version field | `spawnSync(process.execPath, [cli, '--doctor', '--cwd', dir])` with a temp dir, same shape as `test/cwd.test.js:68-74`. | stdout JSON `version === '0.2.0'`, `status === 0` when rg resolves. No Aside required. |
| V5 | doctor --browse still prints matrix | `spawnSync(..., ['--doctor', '--browse', '--config', cfg])` with `CODEMODE_ASIDE` pointing at a missing path (010 S43). | JSON has `version === '0.2.0'`, `browse.page.absent` includes `route`, `browse.screenshot.maxWidthHonoured === false`, `browse.pdf.formatA4Honoured === false`, `browse.asideResolved === null`, exit 1. |
| V6 | doctor without --browse ignores missing Aside | 010 S44 + cwd test. | no Aside failure; `browse` key not required; exit 0 when rg+cwd ok. |
| V7 | createRequire works on Node 18 | CI job `test (ubuntu-latest, node-18)` after the version commit. | job success. A SyntaxError on JSON import would fail this job and prove the wrong import style was used. |

### 5.2 Public SoT (docs)

| # | Path | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| D1 | REGISTRY → four files | `node --test test/guest-api-sot.test.js`. | 0 failures. Every `browse.*` / `report.*` / `api.*` / `recipes.*` path from `actions.list()` is a substring of README.md, README.ko.md, templates/AGENTS.codemode.md, and `TOOL_DEF.description`. |
| D2 | missing-row tripwire | Run the SoT test after REGISTRY has browse paths but **before** the README table edit. | test fails because `browse.captureMany` (etc.) is missing from README. After the table edit, the same test passes. Red before green. |
| D3 | Korean identifiers | D1's README.ko assertions. | `browse.captureMany` etc. appear untranslated. |
| D4 | guest has no fetch | Read `README.md:45` (line may shift) and `GUEST_API_DOC` line `src/tools.js:10`. | still says no `fetch`. `browse.readText` is described as a host RPC. |
| D5 | ENOTSUP facts | README constraints subsection. | text includes `page.route`, `maxWidth`, `pdf.format` or `format: 'A4'`, `MediaBox`, leaked tabs, `[ok | Nms]`. |
| D6 | NPM_CONFIG_PREFIX kept | grep README.md and README.ko.md. | both still contain `NPM_CONFIG_PREFIX`. Homebrew `--prefix=/opt/homebrew` example remains. Windows `where.exe codemode` sentence present in both. |
| D7 | inputSchema | `TOOL_DEF.inputSchema`. | keys `code`, `timeoutMs` only; `additionalProperties: false`. |
| D8 | no web/media root | `actions.list()` paths. | no `web.*`, no `media.*`. #8/#13/#19 names are `browse.readText`, `browse.downloadMedia`, `browse.searchMany`. `recipes.*` paths exist. |
| D9 | AGENTS doctor --browse | read `templates/AGENTS.codemode.md`. | contains `--doctor --browse`, `{{NODE}}`, `{{CLI}}`, and leaked-tabs / do-not-kill wording. |
| D10 | dual path | README Dual path section (`README.md:88-92` today). | browse is a bash card, not a native file card. |

### 5.3 Release control flow

| # | Path | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| R1 | stop on incomplete matrix | `gh run view` on `DEV_SHA` shows 4 success + 1 failure (e.g. Windows). | **do not** run `git merge` / `git push origin main`. Evidence: no new object on `refs/heads/main` (`git ls-remote` still previous SHA). |
| R2 | stop on SHA mismatch | a `success` run exists on `dev` but `headSha !== DEV_SHA` (older green, e.g. `34801531821` / `3b566e7`). | do not merge. Wait for a run whose `headSha` equals `ls-remote origin refs/heads/dev`. |
| R3 | stop on cancelled run | push again while watching; concurrency group in `ci.yml:5-7` cancels the previous. | cancelled ≠ success. Watch the **latest** run for that SHA. If the SHA changed, go back to step 1. |
| R4 | merge commit exists | after step 3. | `git cat-file -p MAIN_SHA` shows two `parent` lines. `parent[1] == DEV_SHA`. |
| R5 | ls-remote matches | `git ls-remote origin refs/heads/main`. | object id `== MAIN_SHA ==` local `HEAD`. |
| R6 | main CI green | `gh run view` for `headSha == MAIN_SHA` on branch `main`. | all five job names success, including the pack step on each (not skipped). |
| R7 | main CI red | any of the five jobs failure/cancelled. | enter §7 rollback. Issues stay open. |
| R8 | no force-push | `git push --force origin main` is not in the command list that was run. | GitHub compare shows a new commit on top of previous `main`, never a rewind without a revert commit. |

### 5.4 Prefix / global install

| # | Path | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| P1 | prefix not on PATH | In a disposable shell, set `NPM_CONFIG_PREFIX` to a temp dir not on PATH, `cd` the detached `MAIN_SHA` clone, `npm install -g .`, then `codemode --doctor` **without** changing PATH. | command-not-found **or** a binary whose `version !== "0.2.0"`. This proves `README.md:33-37` is still a real pitfall. Then `npm install -g --prefix=<dir-on-PATH> .` and `where.exe codemode` points under that prefix; doctor `version === "0.2.0"`. |
| P2 | stale 0.1.0 on PATH | If an older global bin exists, install 0.2.0 into a prefix that is **behind** that older dir on PATH. | `codemode --doctor` prints `"version": "0.1.0"` (or has no `version` field). Re-order / re-prefix until `version === "0.2.0"`. Release is not done while a stale bin wins. |
| P3 | happy path | prefix on PATH, Aside installed on the operator machine. | `codemode --doctor` exit 0, `version` 0.2.0, `rgResolved` set. `codemode --doctor --browse` exit 0, `asideResolved` set, matrix flags as V5 except resolver succeeds. |
| P4 | operator machine without Aside | same install, no Aside. | `--doctor` exit 0. `--doctor --browse` exit 1 with `asideError` and matrix still present. This is a valid operator state, not a rollback trigger. CI is this state. |
| P5 | do not use Aside exit code | if anyone runs `aside.exe repl <script>` during smoke. | success = trailing `[ok | Nms]` plus inspecting claimed files, **not** process exit 0 (E1). A smoke that treats exit 0 as pass is a failed verification, even if the script worked. |

### 5.5 Non-goals that must stay false

| # | Path | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| N1 | tests launch a browser | grep `test/*.test.js` for `aside.exe` spawn without injection, or `CODEMODE_BROWSE_LIVE=1` in CI yml. | zero matches in CI config. Live flag remains opt-in and off in `.github/workflows/ci.yml`. |
| N2 | new npm dependency | `package.json` after wp7. | no `dependencies` / `devDependencies` keys. |
| N3 | Playwright engine | README + GUEST_API_DOC. | "not Playwright"; no `cdpUrl` setup instructions. |
| N4 | resource blocking shipped | `actions.check('browse.open', { url: 'https://example.com', block: true })` or execution of `block: ['image']`. | `ENOTSUP` or catalog description says ENOTSUP (040). No `page.route` in `src/host/browse`. |

### 5.6 Issue-closing checklist

Close with `gh issue close <n> --repo lidge-jun/aside-codemode --comment '…'`
only after **R6** (main CI green) **and** **P3 or P4** (doctor from the
main SHA). Each comment must cite: implementing phase doc, the test file
that contains the ACTIVATION SCENARIO, `MAIN_SHA`, and the main CI run
URL. Do not close against a worktree.

| Issue | Phase | Evidence that proves it (what to point at) |
| --- | --- | --- |
| #6 `browse.captureMany()` | wp4 / 030 | `actions.list()` includes `browse.captureMany`. Tests in 030: one repl, in-script pool, per-item `{error}`, `finally` closes tabs. README row present (D1). |
| #7 `browse.watch()` | wp6 / 050 | `browse.watch`. 050 watch test: hash stored, unchanged URL returns `{changed:false}` only, changed URL returns a line diff. D1. |
| #8 fetch-first read | wp4 / 030 | Guest name is `browse.readText` not `web.readText` (`src/sandbox.js:9-20` one-level). Tests: host fetch → markdown; browser fallback only when `detectJsRequired` and `fallback` on. D4. |
| #9 `recipes.run()` | wp6 / 050 | Guest root `recipes` (`recipes.run` / `list` / `describe` / `check`). 050 recipe test with fixture stdout, no live Play/YouTube, no LLM turn. `.js` recipe files ENOTSUP. D1. |
| #10 `browse.extract` | wp5 / 040 | extract test: schema → JSON, missing fields null + hints, no snapshot dump. D1. |
| #11 wait + **blocking refused** | wp5 / 040 | Wait: default `domcontentloaded`, `networkidle` rejected (`EBADVAL` / ENOTSUP per 040). Blocking: `page.route` absent (001 E3, 010 doctor `browse.page.absent` includes `route`). Close comment **must** say resource blocking is not implementable and is not faked. |
| #12 host screenshot postprocess | wp4 / 030 | `maxWidth` throws `ENOTSUP` (not forwarded). Actual geometry from PNG IHDR / JPEG SOF. `clip` honoured. V5 `maxWidthHonoured === false`. |
| #13 original image download | wp6 / 050 | Guest name is `browse.downloadMedia`, not `media.download`. 050 media test with injected fetch; compiled source never contains `page.screenshot`. D1. |
| #14 snapshot cache + compact | wp5 / 040 | second `browse.snapshot` in one execution returns diff without tree; compact keeps named roles; `truncated:true` on oversize. |
| #15 shared cache TTL | wp6 / 050 | 000 close condition: cache key + TTL honoured **across two processes**. Fixture files, injected clock, not wall time. |
| #16 prefetch / warm-up | wp6 / 050 | `browse.prefetch`. No daemon/cron. 050: implemented **last**, after cross-process cache key+TTL tests. Prefetch test uses injected cache, no live page. |
| #17 login/CAPTCHA/block detect | wp3 / 020 | `test/browse-policy.test.js` C1–C17 against fixture stdout. Alternate path returned; no retry (C17). |
| #18 `api.batch()` | wp5 / 040 | `api.batch` root (not `browse.api.batch`). YouTube oEmbed / iTunes / Play HTML with injected fetch. Slack → `EAUTH` without a network call. |
| #19 searchMany | wp6 / 050 | `browse.searchMany` (**not** `web.searchMany`). Parallel queries, URL dedupe keeps first query, `within` date filter. Default engine fetch/DDG HTML. `engine:'google'` is ENOTSUP until a callable is proven. |
| #20 timings + doctor --browse | wp2 / 010 | Envelope timings fields from 010. V5 matrix. `browse.probe()` static. |
| #21 circuit breaker | wp3 / 020 | B1–B13 with injected clock. `cooldownMs: 0` sticky open (B9). Cancel is not a failure (X1–X4). Timeouts reject values > 25000 (T4), never sit at E4's ~30s. |
| #22 `report.build` MediaBox | wp5 / 040 | Letter fixture (`0 0 612 792`) fails an A4 request even if the file exists. Inch `paperWidth`/`paperHeight` path is the one that matches A4. `format:'A4'` is ENOTSUP. |
| #23 tracking | **wp7 / this file** | `origin/main` `ls-remote` == `MAIN_SHA`; `MAIN_SHA^2 == DEV_SHA`; main CI five/five green; `codemode --doctor` `version === "0.2.0"` from that install; D1 green; #6–#22 closed with the rows above. **Close #23 last.** |

#23's A/B question is answered in 000 and in doctor `browse.decision`
(010): A-shaped surface, B-shaped engine. The close comment must state
that, and that `cdpUrl|playwright` was **not** shipped.

---

## 6. Verifier

| Command | Observes this phase? | What to read |
| --- | --- | --- |
| `node --test test/guest-api-sot.test.js` | **yes** | 0 failures. D1–D4, V1–V2. Authoritative **local** gate for the docs/version slice. |
| `node --test test/cwd.test.js` | **yes, non-regression** | `CLI --doctor prints resolved --cwd` still exit 0 (`test/cwd.test.js:68-74`). V6. |
| `node src/cli.js --doctor --browse` (with injected missing Aside, as 010 S43) | **yes** | JSON `version`, matrix flags. Does **not** launch `repl`. |
| `npm test` | **yes, with caveat** | `scripts/run-tests.mjs` enumerates `test/*.test.js`, so the SoT test is included. Until wp2 t8 is on the SHA, `test/search-boundary.test.js:46` can still fail in the full Windows suite (000). Isolated re-run before treating it as a wp7 regression. Authoritative hosted gate is CI. |
| `npm pack --dry-run` | **yes** | V3. Same command CI runs (`.github/workflows/ci.yml:42-43`). |
| `gh run view <id> --json conclusion,jobs` on `DEV_SHA` then `MAIN_SHA` | **yes** | R1–R7. This is the authoritative **release** gate. Local green is not sufficient to merge. |
| `git ls-remote origin refs/heads/main` | **yes** | R5. A local `main` that was not pushed is not released. |
| `codemode --doctor` after `npm install -g .` from `MAIN_SHA` | **yes** | P1–P4. Inspect JSON `version`. Inspect `where.exe codemode` / `command -v`. Inspect `npm prefix -g` vs `NPM_CONFIG_PREFIX`. |
| Live Aside against x.com | **no** | Human-review, out of CI. Tests must never do this. |
| Aside `repl` process exit code | **no** | E1: not a success signal. |

Success for wp7 **code/docs** = SoT test 0 failures + cwd doctor test 0
failures + pack dry-run shows 0.2.0.

Success for wp7 **release** = that, plus R6, plus P3 or P4, plus #23 closed
last. A green `origin/dev` that was never merged is not #23 closed
(000: `origin/main` contains the dev head).

---

## 7. Risks — what would prove this design wrong

1. **`1.0.0` or `0.1.1` shipped.** V1 failing, or a tag `v1.0.0` on this
   surface, claims a stability the ENOTSUP set cannot keep. Revert the
   version commit; do not "just tag it."
2. **README claims Playwright / `page.route` / silent `maxWidth`.** D5/N3
   failing. That is #23 option A as originally written, which 000 rejected.
3. **SoT drift:** `browse.captureMany` in REGISTRY but missing from
   README.ko. D1/D3 failing. Agents on Korean AGENTS.md would not see the
   namespace. wp7 exists to stop that.
4. **Stale global bin.** P2: doctor without `version` (pre-wp7) or
   `"0.1.0"` after install. If we skip the doctor `version` field, P2
   cannot be distinguished from success. That would disprove §3.3.
5. **Merging a 4/5 CI run.** R1. Windows is the combo that has already gone
   red on a docs-only SHA (`34806283897`, job `test (windows-latest, node-22)`).
   "ubuntu is green" is not the gate.
6. **Trusting an older green SHA.** R2. `34801531821` on `3b566e7` is the
   000 baseline, not the 0.2.0 head.
7. **Force-push to `main` after a red CI.** This is the forbidden rollback.
   It rewrites a branch other operators may have cloned, and it hides the
   red run. The design is wrong if `origin/main` moves backward without a
   new revert commit.
8. **Fast-forward merge.** R4 fails (single parent). Rollback then requires
   reverting a range of feature commits, which can revert unrelated `main`
   history if someone else landed there. `--no-ff` exists to prevent that.
9. **Using Aside exit 0 as deploy proof.** P5. E1 would make a failed repl
   look installed-good.
10. **Closing #11 as blocking shipped.** N4. 001 E3 falsifies it. The close
    text must say refused.
11. **Closing #23 off `origin/dev`.** 000's close condition is
    `origin/main`. A green dev PR that never merged leaves the public
    clone URL on 0.1.0.
12. **CI cancel-in-progress while watching.** R3. Proof: the run id you
    recorded is `cancelled` and a newer run exists. Watch the newer one;
    do not treat cancelled as green.
13. **Adding a `web` root in wp7 to match issue titles.** `hostMethods`
    one-level is already why 030 renamed `web.readText`. A seventh-phase
    rename is churn, not release.
14. **Tests that hit the network or Aside in CI.** N1. The five combos do
    not install Aside. A test that requires `aside.exe` will red Linux/mac
    and block the merge forever.

### Rollback (main CI red after the merge)

Trigger: R7 — any of the five `main` jobs failed, or the run cancelled and
no successor on `MAIN_SHA` will succeed.

1. Do **not** `git push --force` / `--force-with-lease` to `origin/main`.
2. Do **not** `git reset --hard` `origin/main` to the pre-merge SHA.
3. Do **not** delete the merge commit from `dev`. Fix-forward on `dev`.
4. On a checkout of `main` that matches `ls-remote`:

```
git fetch origin
git checkout main
git merge --ff-only origin/main
git revert -m 1 <MAIN_SHA>
git push origin main
```

   `-m 1` keeps parent 1 (old `main`) and drops parent 2 (`dev`). That
   is why step 3 used `--no-ff`.
5. Let `REVERT_SHA` be `git ls-remote origin refs/heads/main`.
6. Wait for CI on `REVERT_SHA` (same five-job inspection). That run must
   be green — it is a return to the pre-release `main` plus a revert
   commit. If the revert itself is red, **stop and report**; still no
   force-push.
7. Leave issues #6–#23 open. Post on #23 that `main` reverted
   `<MAIN_SHA>` → `<REVERT_SHA>` and that `dev` still holds 0.2.0 for a
   fix-forward.
8. Fix on `dev`, wait for `origin/dev` five/five green, merge `--no-ff`
   again. Do not rebase `main` onto a rewritten `dev`.

If the merge never pushed (R1/R2/R3 stop), there is nothing to revert.
`origin/main` stays at the previous SHA (`8223264` as of this docs pass,
re-read with `ls-remote` at execution time).

---

## 8. Caller contract

wp7 does not add guest methods. Callers of 0.2.0 see the union of wp2–wp6
names. Agents must keep using the absolute `{{NODE}} {{CLI}}` pair from
register (`README.md:26`, `bin/codemode.mjs:1-10`). PATH `codemode` is
for the operator and for this phase's doctor proof.

A later 1.0.0, if any, is a **new** decision once the ENOTSUP set is
accepted or gone. It is not this phase.
