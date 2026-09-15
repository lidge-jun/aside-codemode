# WP2 — grepFile completeness + glob precedence docs

Re-verify at P: `decorateSearchResult` and `fs.grepFile` line numbers.

## WP2 P revalidation (2026-09-14)

Previous D (WP1): line-based `apply_patch` shipped at `1196d1a`; 218/218; CLI foobar refused. Direction unchanged — helper search completeness next; do not edit `patch.js` / `line-edit.js`.

Live after WP1:
- `src/host/fs.js:101-146` `grepFile` still returns a bare array; stop condition `:136` is `hits.length < max || pendingAfter.length > 0` (the gap-stop 020 already forbids).
- `src/sandbox.js:110` still `search.*` only.
- `src/host/actions.js:189` still `isSearch` only for value checks.
- `decorateSearchResult` still at `src/search-result.js:56`.

No amendment to D5/D6/D10. Execute this file as written (including test 5b + `createActions`).

## Loop spec

- Archetype: satisfy-spec.
- Trigger: WP0 D; independent of WP1 sources except shared README SoT — do not edit patch files here. If WP1 already touched README patch sentences, only add search/glob sentences.
- Goal: `fs.grepFile` reports truncation the way `search.content` does; invalid `max` throws; glob-vs-ignore is explicit in schema + both READMEs + AGENTS template.
- Non-goals: changing ripgrep glob semantics; followSymlinks; new search APIs.
- Verifier: `npm test` glob includes `test/fs.test.js`, `test/regressions.test.js`, `test/search-hardening.test.js`, NEW `test/grepfile-envelope.test.js`. Phrase tests in `test/readme-51x.test.js` must still see 55s/1s/51x.
- Stop: c-2 evidence.
- Escalation: do not set `noIgnore` default true.

## IN / OUT

IN: `src/host/fs.js` (`grepFile` + `decorateSearchResult` import only), `src/search-schema.js` (glob description + existing `OPTS`; do not export validators), `src/sandbox.js:110` + `src/execution-worker.js:24-25` (RPC envelope), `src/host/actions.js` grepFile row + check(), `src/tools.js` one search/glob sentence, `README.md`, `README.ko.md`, `templates/AGENTS.codemode.md`, NEW `test/grepfile-envelope.test.js`.  
OUT: `patch.js`, `line-edit.js`, LICENSE, CI, 51x numbers. Do not change `context` from a string to `{before,after}` (would break `test/regressions.test.js:186`).

## MODIFY `src/search-schema.js`

Do **not** import this module from `fs.js` (architect D2/D8). Keep `positiveInt` / `nonNegativeInt` private. `max` and `context` already live in `OPTS`, so `actions.check` can reuse `checkOptionValue` for `fs.grepFile` without a new schema.

`OPTS.glob.description` (`:76-80`):

```diff
-    description: "ripgrep -g glob, e.g. '**/*.ts'",
+    description: "ripgrep -g glob, e.g. '**/*.ts'. Inclusive globs can match some gitignored/hidden files even when noIgnore/hidden are false (ripgrep glob precedence, not a root escape, and not -uuu).",
```

`SEARCH_ACTIONS` `search.files` and `search.content` `notes` (`:164`, `:171`): append the same precedence sentence.

## MODIFY `src/host/fs.js` `grepFile` (`:100-144`)

```diff
+import { decorateSearchResult } from '../search-result.js';
```

At the start of `grepFile`, **inline** the same rules as `search-schema.js:33-45` (do not import that file):

```js
if (!Number.isSafeInteger(max) || max <= 0) throw new Error(`fs.grepFile: max must be a positive integer (got ${JSON.stringify(max)})`);
if (!Number.isSafeInteger(context) || context < 0) throw new Error(`fs.grepFile: context must be a non-negative integer (got ${JSON.stringify(context)})`);
```

Default `max = 100` is a valid positive int. Callers that omit `max` still work.

Scan logic: keep collecting while `hits.length < max`. After `max` hits, continue `eachLine` until one more `re.test(line)` **or** EOF. Set `truncated = extraMatch`. Do not push the extra row.

```js
let extraMatch = false;
await eachLine(target, (line, lineNo) => {
  // existing pendingAfter drain (keep: finish last accepted hit's context)
  if (hits.length < max && re.test(line)) {
    // existing hit push + optional pendingAfter open
  } else if (hits.length >= max && !extraMatch && re.test(line)) {
    extraMatch = true;
    return pendingAfter.length > 0;
  }
  // existing before window when context > 0
  return !extraMatch || pendingAfter.length > 0;
}, { signal, maxLineBytes: MAX_GREP_LINE_BYTES });
```

A non-matching line after `max` must **not** stop the scan. `eachLine` stops only on `false` (`file-read.js:131`). `return pendingAfter.length > 0` with `context === 0` is `false` and would miss a later match (`hit / gap / hit`). Continue until an extra match or EOF.

// after building context strings:
return decorateSearchResult(hits.slice(0, max), {
  truncated: extraMatch,
  complete: !extraMatch,
  scope: { kind: 'grepFile', max, context, ignoreCase },
});
```

`toMatcher` / `boundLine` unchanged. `eachLine` already strips `\r` (`file-read.js:128`).

Exact `max` hits at EOF → `truncated:false`, `complete:true`.

## MODIFY RPC restore (explorer hazard)

`worker_threads` structuredClone drops non-enumerable metadata. `search.*` already round-trips via `toJSON` + `restoreSearchResult` (`src/sandbox.js:109-111`, `src/execution-worker.js:22-25`). `fs.grepFile` is registered as `fs.grepFile` (`sandbox.js:16`). Without the same flag, a guest `hits.length` after `await fs.grepFile` would still see an array (clone keeps elements) but `.truncated` would vanish; `JSON.stringify(hits)` inside the guest would also be a bare array.

```diff
-          const search = msg.name.startsWith('search.') && typeof value?.toJSON === 'function';
+          const search = typeof value?.toJSON === 'function'
+            && (msg.name.startsWith('search.') || msg.name === 'fs.grepFile');
```

Do not restore on arbitrary objects with a `rows` field (worker comment `:22-23` stays). Add a `runCode` case in `test/grepfile-envelope.test.js`: guest returns the grepFile value; CLI/JSON envelope has `result.truncated === true` when `max:1` on a 3-hit file.

`context` stays a **string** of joined lines (`fs.js:140`). Do not copy `search.content`'s `{before,after}`.

## MODIFY `src/host/actions.js` `check`

`:184-192` today value-validates only `search.*`. Also run `checkOptionValue` for `fs.grepFile` keys `max` and `context` (those names already exist in `OPTS`).

```diff
-        } else if (name in args && isSearch) {
+        } else if (name in args && (isSearch || rec.path === 'fs.grepFile')) {
```

## MODIFY catalog

`src/host/actions.js:73-82`:

```diff
-    signature: 'fs.grepFile(path, pattern, { context?, max?, ignoreCase? }?) => Promise<{line,text,context?}[]>',
+    signature: 'fs.grepFile(path, pattern, { context?, max?, ignoreCase? }?) => Promise<{line,text,context?}[]>',
+    notes: 'Array ergonomics unchanged. Non-enumerable .truncated/.complete/.partial/.scope; JSON is {rows,complete,truncated,partial,scope}. max must be a positive integer (default 100).',
```

Update `inputs.max.description` to `Max matches (default 100). Positive integer; invalid values throw. Hitting max sets .truncated after a one-match lookahead.`

`src/tools.js` after the ignore sentence (`:20`), add: `Inclusive search.glob can match gitignored/hidden files even when noIgnore/hidden are false.` And: `fs.grepFile uses the same completeness envelope as search.*.`

## MODIFY SoT prose

`README.md` after the `.gitignore` paragraph (`:57`), new short paragraph:

`Inclusive \`glob\` values (for example \`**/*.js\`) are ripgrep \`-g\` / \`--glob\` globs. They can match some gitignored or hidden files even when \`noIgnore\` and \`hidden\` are false. That is ripgrep glob precedence ([ripgrep#1808](https://github.com/BurntSushi/ripgrep/issues/1808)), not a workspace escape, and it is **not** the same as \`-uuu\`: ignore rules still apply to paths the glob does not force in. Exclusive globs (\`-g '!…'\`) still hide paths. Set \`noIgnore\` / \`hidden\` explicitly when you want ignore-or-dotfile control without an inclusive glob.`

`README.ko.md` matching Korean paragraph after `:57`.

`templates/AGENTS.codemode.md` after the ignore paragraph (`:21-23`):

`An inclusive \`glob\` can match gitignored or hidden files even when \`noIgnore\` and \`hidden\` are false (ripgrep \`-g\` precedence). Do not treat \`glob: "**/*.js"\` as an extension filter that still honors ignore.`

Keep the three placeholders `{{NODE}}` `{{CLI}}` `{{CWD_HINT}}`. English only.

## NEW `test/grepfile-envelope.test.js`

Fail on HEAD, then pass:

1. Three matching lines, `max: 1` → `length===1`, `truncated===true`, `complete===false`, `JSON.parse(JSON.stringify(hits))` has `truncated: true` and `rows.length===1`.
2. Three matching lines, `max: 3` → `truncated===false`, `complete===true`.
3. `max: -1`, `max: 0`, `max: 1.5`, `max: NaN` → throw `/positive integer/`.
4. `context: -1` → throw `/non-negative/`.
5. Existing realm/global regex cases in `write-hardening.test.js` still pass (array length / line text).
5b. **Separated extra match** — file `hit\ngap\nhit\n`, pattern `hit`, `max:1`, `context:0` → `length===1`, `truncated===true`, `complete===false`. Must fail if the scan returns `false` on `gap`.
6. **`actions.check` agrees with runtime** — exact import, no phantom factory:

```js
import { createActions } from '../src/host/actions.js';
const actions = createActions();
```

   - `actions.check('fs.grepFile', { path: 'f.txt', pattern: 'a', max: -1 })` → `ok === false` and `invalid.length >= 1`
   - `actions.check('fs.grepFile', { path: 'f.txt', pattern: 'a', context: -1 })` → `ok === false` and `invalid.length >= 1`
   - `actions.check('fs.grepFile', { path: 'f.txt', pattern: 'a', max: 1 })` → `ok === true`
   Do **not** treat a passing runtime-only suite as enough. `createHostActions` does not exist (`src/host/actions.js:149`).

`test/regressions.test.js:179-186` still asserts `hits.length === 2` — decoration must keep enumerable length.

## Activation

| Case | How | Observe |
| --- | --- | --- |
| Truncation | `max:1` on 3 hits | envelope |
| Invalid max | `max:-1` | throw, not `[]` |
| Discovery | `actions.check('fs.grepFile', { path, pattern, max: -1 })` | `ok:false`, `invalid` non-empty |
| Glob docs | `rg -n "glob precedence|Inclusive|not -uuu|-uuu" README.md README.ko.md templates/AGENTS.codemode.md src/search-schema.js` | hits |

## Residuals

A guest that `return`s `hits.map(...)` still drops metadata (already documented for search). Pathological JS regex in `grepFile` can still block the host loop (`README.md:143`).
