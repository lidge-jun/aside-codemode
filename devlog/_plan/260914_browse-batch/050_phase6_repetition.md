# 050 — wp6 repetition savings (closes #19, #13, #15, #7, #9, #16)

Unit: `devlog/_plan/260914_browse-batch/`. Work-phase wp6 of [000_plan.md](000_plan.md).
Binding evidence: [001_probe_evidence.md](001_probe_evidence.md). Binding seams: [002_design_inputs.md](002_design_inputs.md).
This file is the copy-paste PRD for wp6. Re-verify line numbers at wp6 P (wp2–wp5 will have moved them).

Class: C3. Zero npm dependencies. Node >=18 (`package.json` engines). Tests never launch a browser. Timing is never a correctness oracle (`test/write-hardening.test.js:4-7`). Independently verifiable at close (000): the shared file cache honours its key and TTL across two processes.

---

## 1. Purpose and issues closed

Ship the repetition layer so a daily research routine does not re-search, re-capture, or re-click the same surfaces across parallel `execute_code` processes.

| Issue | Guest name that ships | Close condition |
| --- | --- | --- |
| #19 | `browse.searchMany(queries, opts)` | N queries run in parallel; URL dedupe keeps the first query; `within` is a date filter. Default engine is fetch-first. `googleSearch` is used only after a concrete callable is proven. |
| #13 | `browse.downloadMedia(kind, opts)` | Original bytes are fetched from `img src` / thumbnail / iTunes screenshot URLs. Compiled source never contains `page.screenshot`. |
| #15 | `src/host/browse/cache.js` | File-backed TTL under `os.tmpdir()`, keyed by account/profile/auth/locale/viewport/schema version. Two forked processes see one write. |
| #7 | `browse.watch(list, opts)` | Per-URL text hash persisted; unchanged URLs return `{changed:false}` only; changed URLs return a line diff. |
| #9 | `recipes.run(name, args)` | Named site recipe returns structured data with **zero** LLM turns. Selector failure names the step. Must not bypass `runGuardedBatch` (020 §8). |
| #16 | `browse.prefetch(urls, opts)` | **Last.** Warms the #15 cache. Not implemented until cache key+TTL tests are green. No daemon, no cron. |

#19 proposed `web.searchMany`. That name does **not** ship as a `web` guest root. Same reason as #8 in 030 §1: `hostMethods` walks one level (`src/sandbox.js:9-20`) and `browse.readText` already absorbed `web.readText`. A one-method `web` root that cannot pipe into `web.readText` is a footgun. Canonical: `browse.searchMany` then `browse.readText(urls)`. 040's `api` exception does not apply — `searchMany` is a one-level browse verb.

#13 proposed `media.download`. Canonical: `browse.downloadMedia`. No `media` root.

#9 proposed `recipes.run` as its own namespace. That **does** ship as guest root `recipes` (like `api`): `browse.recipes.run` can never register.

---

## 2. Scope

### IN

- NEW `src/host/browse/cache.js` — file-backed TTL, cooperating-process lock via `withFileLock` (`src/host/file-lock.js:203-213`).
- NEW `src/host/browse/search-web.js` — `searchMany`, DDG HTML parser, `within` parser, URL canonicalizer, googleSearch probe compiler.
- NEW `src/host/browse/media.js` — kind-dispatch original-image download.
- NEW `src/host/browse/watch.js` — hash store + `lineDiff` (reuses 040 `extract.js` exports).
- NEW `src/host/browse/recipes.js` — JSON-only built-in recipes + `createRecipes({run,list,describe,check})`.
- NEW `src/host/browse/prefetch.js` — cache warm-up. Lands **after** cache tests.
- MODIFY `src/host/browse/browse.js` — add `searchMany`, `downloadMedia`, `watch`, `prefetch`; wrap `captureMany` / `readText` / `extract` with the file cache.
- MODIFY `src/host/globals.js`, `src/sandbox.js`, `src/execution-worker.js`, `src/host/actions.js`, `src/tools.js`, `src/config.js`, `codemode.config.example.json`, README / README.ko / `templates/AGENTS.codemode.md`.
- NEW tests listed in §5.14. Inject `fetchImpl` / `session.run` / `nowMs` / `cacheDir`. `fork()` ready/go for the cross-process cache test.

### OUT

- A `web` or `media` guest root.
- Evaluating user `.js` recipe files (`Function`, `vm.Script`, `import()` of a guest path). JSON steps only; `.js` recipes are `ENOTSUP`.
- A prefetch daemon, cron, or Aside scheduled task. The guest/agent calls `browse.prefetch`.
- Persistent circuit-breaker state (wp3 breaker stays in-memory per execution). Cache is for successful bodies, not open circuits.
- Replacing wp5's in-execution snapshot `Map` (#14). That Map still omits `tree` on repeat **inside one** `execute_code`. File cache is the cross-process layer.
- `page.route` / resource blocking / `screenshot.maxWidth` / `pdf({format:'A4'})` / viewport writes (E3/E4).
- Storing credentials, cookies, or Slack tokens in the cache. Auth context is a **label** (`'none'` / `'aside-repl'`), never a secret.
- Killing the Aside CLI as cleanup (E5). Recipes own `finally` + `closeTab`.
- New npm dependencies. Live network / live Aside in `npm test`. Timing as a correctness oracle.
- Joining the search `toJSON` RPC lane (`src/sandbox.js:110-112`).

### Binding evidence this phase must not contradict

| Id | Fact | Consequence here |
| --- | --- | --- |
| E1 | CLI exit 0 on failure; trailer `[ok \| Nms]` / `[error \| Nms]`; 1.4–2.4s overhead; one repl = one session; 120s cap | Search/recipes that need a browser compile **one** script. Success is trailer + claimed files, never exit 0. |
| E2 | `googleSearch` is an object; prototype enumeration returns only `Object.prototype`; detect with `typeof obj.method` | Probe compiler emits `typeof googleSearch[name]` for a fixed name list. Never `getPrototypeOf` / `getOwnPropertyNames`. Default engine is fetch-first. |
| E3 | no `page.route`; `p.on('request')` delivers 0 events; `evaluate` / `click` / `waitForSelector` present; `download` global is `undefined` | Media download is host `fetch`, not Aside `download`. Recipes click via `page.click` / `evaluate`, never request interception. |
| E4 | `maxWidth` ignored; viewport not settable (`1440x900`); clip works; `pdf({format:'A4'})` is Letter | Cache **still keys viewport** as `'1440x900'` so a future honouring invalidates entries. Media never asks Aside to screenshot. |
| E5 | kill leaks tabs forever; later session cannot close them; host wait must let script `finally` run | Recipe scripts close tabs in `finally`. `scriptDeadlineMs < hostWaitMs`. Prefetch/searchMany fetch-first paths spawn nothing. |
| E6 | 5 pages 908ms parallel vs 3397ms sequential in one script | `searchMany` parallelises queries in-process via `Promise.all`. Recipe multi-URL work goes through `runGuardedBatch`. |

file-lock (`src/host/file-lock.js:1-10, 31, 203-213`) is the cooperating-process pattern: `O_EXCL` lock files under `os.tmpdir()/codemode-locks`, canonical key, never steal a lock, bounded wait. It is **explicitly not a security boundary** — same class of statement as `src/sandbox.js:2`. Cache files are readable by other local users. Do not put tokens in them.

---

## 3. Locked decisions

### 3.1 `googleSearch` is unproven until a callable is observed

001 E2: `Object.getOwnPropertyNames(Object.getPrototypeOf(googleSearch))` is useless. A live Aside CLI may grow a method tomorrow; wp6 must not pretend it exists.

**Proof protocol (the only way `engine:'google'` is allowed):**

1. `compileGoogleSearchProbeScript()` emits a script that records `typeof googleSearch` and `typeof googleSearch[name]` for `GOOGLE_SEARCH_METHODS = ['search','query','run','find','webSearch','google']`. It does not call any method. It does not enumerate the prototype.
2. Unit tests inspect that source string. They never spawn Aside.
3. A live run happens only under `CODEMODE_BROWSE_LIVE=1` (same gate as 010 probe). On success the host writes `{cliVersion, method, typeof: 'function', provenAt}` to `<cacheDir>/google-search-probe.json` via `cache.set`.
4. `browse.searchMany` default `engine` is `'fetch'`. `'google'` throws `BrowseOptionError` `ENOTSUP` unless (a) the test injects `googleSearchImpl`, or (b) the probe file names a method whose recorded typeof is `'function'`.
5. There is no silent fallback that opens Google SERP tabs. Fetch-first is DuckDuckGo HTML (`https://html.duckduckgo.com/html/?q=`). If DDG HTML is empty, the query item is `ok:false` `ENONE`, not a Google scrape.

Injected `googleSearchImpl(query, opts) => Promise<results[]>` is the test double for (a). Production never defines it.

### 3.2 Cache key and TTL

Default TTL **600000 ms (10 min)** as #15 asked. Default dir `path.join(os.tmpdir(), 'codemode-browse-cache')`. Not inside roots. `assertInside` does not apply to cache files (they are host-private, like lock files at `src/host/file-lock.js:31`).

Key material (all of these, always, even when a field is the default):

| Field | Default | Why it is in the key |
| --- | --- | --- |
| `account` | `'anon'` | #15: different Aside accounts must not share bodies |
| `profile` | `'default'` | browser profile / `browseCaps.profile` |
| `auth` | `'none'` (fetch) or `'aside-repl'` (browser path) | logged-in vs logged-out HTML |
| `locale` | `'und'` | Play/App Store copy differs by `hl` / `country` |
| `viewport` | `'1440x900'` | E4 measured, not settable; still keyed |
| `schemaVersion` | per-kind constant (`search/1`, `readText/1`, `extract/1`, `watch/1`, `capture/1`) | extract schema changes must miss |
| `kind` | required | text vs screenshot vs search vs watch |
| `id` | canonical URL or `kind+q+within` | the thing fetched |

Digest = `sha256(JSON.stringify(fields)).slice(0, 40)`. Two different spellings of the same http(s) URL canonicalize first (see `canonicalUrl`).

Atomic write: temp file in the same directory + `rename`. Read may proceed without a lock; write and TTL-delete run inside `withFileLock(targetJson)`. A lock we do not own is never deleted (`src/host/file-lock.js:8-10`).

Expired entry = miss (and delete under the lock). `nowMs` is injected so expiry tests do not sleep.

### 3.3 Recipes are data, not code

#9 asked for `~/.codemode/recipes/*.js`. Loading guest-written JS into the host is `eval`. Out. Built-ins live in `recipes.js` as JSON-serialisable step lists. Optional extra recipes: `*.json` files under `browseCaps.recipesDir` that pass `assertInside`. A `.js` file there is `ENOTSUP` before any spawn.

### 3.4 Prefetch is last

#16 is a cache client. If cache key/TTL/lock is wrong, prefetch writes poison that later `readText` will trust. Implement `prefetch.js` only after the cross-process cache tests in §7.3 are green. Prefetch itself is a host function the guest calls — this repo has no scheduler.

---

## 4. Assumed contracts from wp2–wp5 (amend at wp6 P if names drifted)

- `createBrowseSession` is the only spawn+deadline+parse path (002 A1, 010). Success = trailing `[ok | Nms]` **and** claimed files (E1). `scriptDeadlineMs < hostWaitMs` (E5).
- `createBrowse` returns a frozen **one-level** object. wp4: `captureMany` / `screenshot` / `readText`. wp5: `extract` / `snapshot` / `open` plus `probe` / `exec` if present. wp6 **spreads those** and adds methods. Do not replace the factory.
- `createFetchFirst().readText` is the fetch-first engine (030 §5.2). wp6 wraps it with cache; it does not reimplement readability.
- `createApi().batch` (040) already hits iTunes lookup / Play details HTML / YouTube oEmbed. `downloadMedia` **reuses those parsers or the same URLs**; it does not add YouTube Data API v3 or Play Developer OAuth.
- `lineDiff` / `hashTree` / `applyExtractSchema` live in 040 `extract.js`. Watch imports them. Do not copy-paste a second diff.
- `runGuardedBatch` (020 §3.1) is the only skip/retry brain. Recipes pass `runItem`; they do not open a private retry loop.
- `readImageSize` (030 `image.js`) attaches width/height after a download. Media does not resize (030 §3.1 ENOTSUP).
- Browse envelopes are plain enumerable objects. Do not set `toJSON` (`src/sandbox.js:110-112`).
- Guest still has no `fetch` (`src/tools.js:10`, `README.md:45`).

---

## 5. File change map

| Path | Op | Role |
| --- | --- | --- |
| `src/host/browse/cache.js` | NEW | File-backed TTL + key |
| `src/host/browse/search-web.js` | NEW | `searchMany` + DDG parser + probe compiler |
| `src/host/browse/media.js` | NEW | Original-image download |
| `src/host/browse/watch.js` | NEW | Hash + diff |
| `src/host/browse/recipes.js` | NEW | JSON recipes + guest factory |
| `src/host/browse/prefetch.js` | NEW | Cache warm-up (last) |
| `src/host/browse/browse.js` | MODIFY (wp2/4/5; absent today) | Wire methods + cache wrap |
| `src/host/browse/schema.js` | MODIFY (wp2) | Option tables + action catalogs |
| `src/host/browse/probe.js` | MODIFY (wp2) | Doctor rows for search/cache |
| `src/host/globals.js` | MODIFY | Inject `recipes` |
| `src/sandbox.js` | MODIFY | `ROOTS` += `recipes` |
| `src/execution-worker.js` | MODIFY | Pre-create/freeze `recipes` |
| `src/host/actions.js` | MODIFY | Splice `RECIPE_ACTIONS` |
| `src/tools.js` | MODIFY | `GUEST_API_DOC` bullets |
| `src/config.js` | MODIFY | `browseCaps` cache/recipes fields + env |
| `codemode.config.example.json` | MODIFY | Document the keys |
| `test/config.test.js` | MODIFY | Copy of new fields |
| `README.md` / `README.ko.md` / `templates/AGENTS.codemode.md` | MODIFY | SoT rows |
| `test/browse-cache.test.js` etc. | NEW | §5.14 |
| `test/fixtures/browse-search/*.html` | NEW | DDG HTML fixtures |

No DELETE. No `index.js` barrels (002). Browse never imports `./report/*`.

---

### 5.1 NEW `src/host/browse/cache.js`

```js
// src/host/browse/cache.js
// wp6 #15 — file-backed TTL cache for cooperating codemode processes.
// NOT a security boundary: contents live under os.tmpdir() and are readable
// by other local users. Never store tokens, cookies, or Authorization values.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withFileLock } from '../file-lock.js';

export const DEFAULT_TTL_MS = 600_000;
export const DEFAULT_CACHE_DIRNAME = 'codemode-browse-cache';
export const SCHEMA_VERSIONS = Object.freeze({
  search: 'search/1',
  readText: 'readText/1',
  extract: 'extract/1',
  watch: 'watch/1',
  capture: 'capture/1',
  probe: 'probe/1',
});

export function defaultCacheDir(tmpdir = os.tmpdir()) {
  return path.join(tmpdir, DEFAULT_CACHE_DIRNAME);
}

export function canonicalUrl(url) {
  const u = new URL(url);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  const drop = [];
  for (const k of u.searchParams.keys()) {
    if (/^utm_/i.test(k) || k === 'fbclid' || k === 'gclid') drop.push(k);
  }
  for (const k of drop) u.searchParams.delete(k);
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export function cacheKey(fields) {
  const payload = {
    account: fields.account ?? 'anon',
    profile: fields.profile ?? 'default',
    auth: fields.auth ?? 'none',
    locale: fields.locale ?? 'und',
    viewport: fields.viewport ?? '1440x900',
    schemaVersion: fields.schemaVersion ?? 'v1',
    kind: fields.kind,
    id: fields.id,
  };
  if (!payload.kind || payload.id == null || payload.id === '') {
    throw Object.assign(new Error('cacheKey requires kind and id'), { code: 'EBADVAL' });
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 40);
}

export function createBrowseCache({
  dir,
  ttlMs = DEFAULT_TTL_MS,
  nowMs = () => Date.now(),
  lockTimeoutMs,
  signal,
} = {}) {
  const root = dir || defaultCacheDir();
  mkdirSync(root, { recursive: true });

  function fileFor(key) {
    return path.join(root, key + '.json');
  }

  async function get(fields) {
    const key = cacheKey(fields);
    const target = fileFor(key);
    if (!existsSync(target)) return { hit: false, key };
    let parsed;
    try { parsed = JSON.parse(readFileSync(target, 'utf8')); }
    catch { return { hit: false, key, reason: 'corrupt' }; }
    const age = nowMs() - (parsed.fetchedAt ?? 0);
    if (!Number.isFinite(age) || age < 0 || age > (parsed.ttlMs ?? ttlMs)) {
      await withFileLock(target, { timeoutMs: lockTimeoutMs, signal }, () => {
        try { unlinkSync(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      });
      return { hit: false, key, reason: 'expired', age };
    }
    return { hit: true, key, value: parsed.value, fetchedAt: parsed.fetchedAt, ttlMs: parsed.ttlMs ?? ttlMs };
  }

  async function set(fields, value, { ttl = ttlMs } = {}) {
    const key = cacheKey(fields);
    const target = fileFor(key);
    const record = { key, fields, value, fetchedAt: nowMs(), ttlMs: ttl };
    await withFileLock(target, { timeoutMs: lockTimeoutMs, signal }, () => {
      const tmp = target + '.tmp-' + process.pid;
      writeFileSync(tmp, JSON.stringify(record));
      renameSync(tmp, target);
    });
    return { key, fetchedAt: record.fetchedAt };
  }

  return Object.freeze({ dir: root, ttlMs, get, set, cacheKey, canonicalUrl });
}
```

Screenshot blobs live next to the JSON as `<key>.bin` and are renamed in the same lock. Capture `value` is `{path, bytes, format, width, height, blob: true}`; the reader copies bytes out to the caller's `outDir` (assertInside) so guests never read the tmp cache path. `fields` in the JSON must not include token, cookie, or Authorization keys — tests grep the written file.

---

### 5.2 NEW `src/host/browse/search-web.js`

```js
// src/host/browse/search-web.js
// wp6 #19 — parallel web search. Default engine is fetch-first DDG HTML.
import { BrowseOptionError } from './schema.js';
import { SCHEMA_VERSIONS, canonicalUrl } from './cache.js';

export const GOOGLE_SEARCH_METHODS = Object.freeze(['search', 'query', 'run', 'find', 'webSearch', 'google']);
export const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';
export const SEARCH_UA = 'aside-codemode-search/0.1';
export const DEFAULT_SEARCH_MAX = 5;
export const MAX_SEARCH_QUERIES = 16;

export function parseWithin(within, nowMs) {
  if (within == null || within === '') return null;
  const m = /^(\d+)([dDwWmMyY])$/.exec(String(within));
  if (!m) throw new BrowseOptionError('browse.searchMany: within must look like 14d / 2w / 1m / 1y', 'EBADVAL');
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new BrowseOptionError('browse.searchMany: within count must be a positive integer', 'EBADVAL');
  }
  const day = 86400000;
  const ms = unit === 'd' ? n * day : unit === 'w' ? n * 7 * day : unit === 'm' ? n * 30 * day : n * 365 * day;
  const ddgDf = n <= 1 && unit === 'd' ? 'd'
    : ((unit === 'd' && n <= 7) || unit === 'w') ? 'w'
    : ((unit === 'd' && n <= 31) || unit === 'm') ? 'm'
    : 'y';
  const after = new Date(nowMs() - ms).toISOString().slice(0, 10);
  return { n, unit, ms, ddgDf, after };
}

export function unwrapDdgHref(href) {
  if (typeof href !== 'string' || !href) return null;
  try {
    const u = new URL(href, DDG_HTML_ENDPOINT);
    const inner = u.searchParams.get('uddg') || u.searchParams.get('u');
    const raw = inner ? decodeURIComponent(inner) : u.href;
    if (!/^https?:\/\//i.test(raw)) return null;
    if (/duckduckgo\.com\/y\.js/i.test(raw)) return null;
    return canonicalUrl(raw);
  } catch {
    return null;
  }
}

export function parseDdgHtml(html) {
  const results = [];
  const seen = new Set();
  const re = /<a[^>]+class=["'][^"']*result__(?:a|url)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = unwrapDdgHref(m[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = decodeEntities(String(m[2]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const after = html.slice(m.index, m.index + 1200);
    const snip = /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(after);
    const snippet = snip ? decodeEntities(snip[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : '';
    const time = /class=["'][^"']*result__timestamp[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(after);
    const publishedAt = time ? parseLooseDate(decodeEntities(time[1].replace(/<[^>]+>/g, '').trim())) : null;
    results.push({ url, title, snippet, publishedAt });
  }
  return results;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

export function parseLooseDate(s, nowMs = Date.now) {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  const rel = /^(\d+)\s+(day|week|month|year)s?\s+ago$/i.exec(s.trim());
  if (!rel) return null;
  const n = Number(rel[1]);
  const unit = rel[2].toLowerCase();
  const day = 86400000;
  const ms = unit === 'day' ? n * day : unit === 'week' ? n * 7 * day : unit === 'month' ? n * 30 * day : n * 365 * day;
  return new Date(nowMs() - ms).toISOString().slice(0, 10);
}

export function compileGoogleSearchProbeScript() {
  return '(async () => {\n'
    + '  const names = ' + JSON.stringify(GOOGLE_SEARCH_METHODS) + ';\n'
    + '  const methods = {};\n'
    + '  const type = typeof googleSearch;\n'
    + '  if (googleSearch && (type === "object" || type === "function")) {\n'
    + '    for (const n of names) methods[n] = typeof googleSearch[n];\n'
    + '  }\n'
    + '  console.log(JSON.stringify({ items: [{ ok: true, googleSearch: { type, methods } }], timings: [], leakedUrls: [] }));\n'
    + '})();\n';
}

export function googleMethodFromProbe(probe) {
  const methods = probe?.googleSearch?.methods || {};
  for (const n of GOOGLE_SEARCH_METHODS) {
    if (methods[n] === 'function') return n;
  }
  return null;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function validateSearchMany(queries, opts = {}) {
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new BrowseOptionError('browse.searchMany: queries must be a non-empty array', 'EBADVAL');
  }
  if (queries.length > MAX_SEARCH_QUERIES) {
    throw new BrowseOptionError('browse.searchMany: at most ' + MAX_SEARCH_QUERIES + ' queries', 'EBADVAL');
  }
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    if (typeof q === 'string') continue;
    if (q === null || typeOf(q) !== 'object') {
      throw new BrowseOptionError('browse.searchMany: queries[' + i + '] must be a string or {q, within?}', 'EBADVAL');
    }
    if (typeof q.q !== 'string' || !q.q.trim()) {
      throw new BrowseOptionError('browse.searchMany: queries[' + i + '].q is required', 'EBADVAL');
    }
  }
  if (opts.engine !== undefined && opts.engine !== 'fetch' && opts.engine !== 'google') {
    throw new BrowseOptionError("browse.searchMany: engine must be 'fetch' or 'google'", 'EBADVAL');
  }
  if (opts.max !== undefined && (!Number.isSafeInteger(opts.max) || opts.max <= 0)) {
    throw new BrowseOptionError('browse.searchMany: max must be a positive integer', 'EBADVAL');
  }
  if (opts.dedupe !== undefined && typeof opts.dedupe !== 'boolean') {
    throw new BrowseOptionError('browse.searchMany: dedupe must be boolean', 'EBADVAL');
  }
  return queries.map((q) => (typeof q === 'string' ? { q } : { q: q.q, within: q.within }));
}

export function dedupeResults(rows, { dedupe = true, max = DEFAULT_SEARCH_MAX } = {}) {
  const seen = new Set();
  return rows.map((row) => {
    const kept = [];
    let dropped = 0;
    for (const r of row.results || []) {
      if (kept.length >= max) { dropped += 1; continue; }
      if (dedupe && seen.has(r.url)) { dropped += 1; continue; }
      if (dedupe) seen.add(r.url);
      kept.push(r);
    }
    return { ...row, results: kept, deduped: dropped };
  });
}

export function filterByWithin(results, within) {
  if (!within) return results;
  return results.filter((r) => !r.publishedAt || r.publishedAt >= within.after);
}

export function createSearchMany({
  fetchImpl, cache, signal, nowMs = () => Date.now(), googleSearchImpl = null, identity = {},
} = {}) {
  const fetchFn = fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  if (typeof fetchFn !== 'function') throw new Error('browse.searchMany: fetch is not available');

  async function searchOne(query, opts) {
    if (signal?.aborted) return { q: query.q, ok: false, code: 'ECANCELLED', error: 'search cancelled', results: [] };
    const within = parseWithin(query.within ?? opts.within, nowMs);
    const engine = opts.engine || 'fetch';
    const fields = {
      ...identity, kind: 'search', schemaVersion: SCHEMA_VERSIONS.search, auth: 'none',
      id: JSON.stringify({ q: query.q, within: within?.after ?? null, engine }),
    };
    if (cache && opts.cache !== false) {
      const hit = await cache.get(fields);
      if (hit.hit) return { ...hit.value, cached: true };
    }
    let results;
    if (engine === 'google') {
      if (typeof googleSearchImpl !== 'function') {
        throw new BrowseOptionError(
          "browse.searchMany: engine 'google' is ENOTSUP until a googleSearch callable is proven (001 E2: prototype is opaque). Default engine is fetch (DuckDuckGo HTML). Re-run a live probe under CODEMODE_BROWSE_LIVE=1 or inject googleSearchImpl in tests.",
          'ENOTSUP',
        );
      }
      results = await googleSearchImpl(query.q, { within, signal });
    } else {
      const url = DDG_HTML_ENDPOINT + '?q=' + encodeURIComponent(query.q + (within ? ' after:' + within.after : ''))
        + (within ? '&df=' + encodeURIComponent(within.ddgDf) : '');
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(new Error('search timeout')), opts.timeoutMs ?? 8000);
      const onAbort = () => ac.abort(signal?.reason);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      try {
        const res = await fetchFn(url, { signal: ac.signal, headers: { 'user-agent': SEARCH_UA, accept: 'text/html' } });
        const html = await res.text();
        if (!res.ok) return { q: query.q, ok: false, code: 'EHTTP', error: 'search HTTP ' + res.status, results: [], engine: 'fetch' };
        results = parseDdgHtml(html);
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') {
          return { q: query.q, ok: false, code: 'ECANCELLED', error: 'search cancelled', results: [] };
        }
        return { q: query.q, ok: false, code: e.code ?? 'EFETCH', error: String(e.message || e), results: [] };
      } finally {
        clearTimeout(t);
        signal?.removeEventListener?.('abort', onAbort);
      }
    }
    results = filterByWithin(results, within);
    const row = { q: query.q, ok: true, results, engine, within: within ? { after: within.after, ddgDf: within.ddgDf } : null, cached: false };
    if (!row.results.length) { row.ok = false; row.code = 'ENONE'; row.error = 'no search results'; }
    if (cache && opts.cache !== false && row.ok) await cache.set(fields, row);
    return row;
  }

  async function searchMany(queries, opts = {}) {
    const list = validateSearchMany(queries, opts);
    const max = opts.max ?? DEFAULT_SEARCH_MAX;
    const dedupe = opts.dedupe !== false;
    const rows = await Promise.all(list.map((q) => searchOne(q, opts).catch((e) => {
      if (e && e.code === 'ENOTSUP') throw e;
      if (signal?.aborted) return { q: q.q, ok: false, code: 'ECANCELLED', error: 'search cancelled', results: [] };
      return { q: q.q, ok: false, code: e.code ?? 'EFETCH', error: String(e.message || e), results: [] };
    })));
    const items = dedupeResults(rows, { dedupe, max });
    const failed = items.filter((it) => it.ok !== true).length;
    return {
      items,
      complete: failed === 0,
      truncated: false,
      partial: failed > 0,
      scope: { engine: opts.engine || 'fetch', dedupe, max, n: list.length },
    };
  }

  return Object.freeze({ searchMany, parseDdgHtml, parseWithin, compileGoogleSearchProbeScript, googleMethodFromProbe });
}
```

Tests must spy fetch URLs: only `html.duckduckgo.com`. Never `google.com/search`. Unknown dates (`publishedAt: null`) survive `filterByWithin` — the query modifier (`after:YYYY-MM-DD` + `df=`) is the filter when DDG does not emit a timestamp.

---

### 5.3 NEW `src/host/browse/media.js`

Host `fetch` of original bytes. Aside's `download` global is `undefined` (001 E2). `page.screenshot` is forbidden in this module and in any compiled source it emits (it emits none — there is no repl script).

```js
// src/host/browse/media.js
// wp6 #13 — original-image download from img src / thumbnail / iTunes screenshot URLs.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { BrowseOptionError } from './schema.js';
import { readImageSize } from './image.js';

export const MEDIA_KINDS = Object.freeze([
  'appstore.screenshots', 'playstore.screenshots', 'youtube.thumbnail', 'x.post.media',
]);
export const MAX_MEDIA_FILES = 12;
export const MEDIA_UA = 'aside-codemode-media/0.1';

export function itunesLookupUrl(id, country) {
  return 'https://itunes.apple.com/lookup?id=' + encodeURIComponent(id) + '&country=' + encodeURIComponent(country || 'us');
}
export function playDetailsUrl(id, hl) {
  return 'https://play.google.com/store/apps/details?id=' + encodeURIComponent(id) + '&hl=' + encodeURIComponent(hl || 'en');
}
export function youtubeThumbUrl(videoId, name) {
  return 'https://i.ytimg.com/vi/' + encodeURIComponent(videoId) + '/' + name + '.jpg';
}

export function parseItunesScreenshotUrls(text) {
  let j;
  try { j = JSON.parse(text); } catch {
    return { ok: false, code: 'EPARSE', error: 'itunes lookup is not JSON', urls: [] };
  }
  const row = Array.isArray(j.results) ? j.results[0] : null;
  if (!row) return { ok: false, code: 'ENOTFOUND', error: 'itunes lookup returned no results', urls: [] };
  const urls = [...(row.screenshotUrls || []), ...(row.ipadScreenshotUrls || [])].filter((u) => typeof u === 'string');
  return { ok: urls.length > 0, urls: urls.slice(0, MAX_MEDIA_FILES), id: row.trackId, name: row.trackName || row.collectionName || null, code: urls.length ? null : 'ENONE' };
}

export function parsePlayScreenshotUrls(html) {
  const urls = [];
  const seen = new Set();
  const re = /https:\/\/play-lh\.googleusercontent\.com\/[^"'\s>]+/g;
  let m;
  while ((m = re.exec(html))) {
    const u = m[0].replace(/&amp;/g, '&');
    if (seen.has(u)) continue;
    seen.add(u);
    urls.push(u);
    if (urls.length >= MAX_MEDIA_FILES) break;
  }
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i.exec(html);
  if (og && !seen.has(og[1]) && urls.length < MAX_MEDIA_FILES) urls.unshift(og[1]);
  return { ok: urls.length > 0, urls, code: urls.length ? null : 'ENONE', error: urls.length ? null : 'play store HTML had no screenshot URLs' };
}

export function parseOgImage(html) {
  const og = /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)/i.exec(html)
    || /<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)/i.exec(html);
  return og ? og[1] : null;
}

export function createMedia({ fetchImpl, assertInside, signal, timeoutMs = 8000 } = {}) {
  const fetchFn = fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  if (typeof fetchFn !== 'function') throw new Error('browse.downloadMedia: fetch is not available');

  async function getText(url) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(new Error('media timeout')), timeoutMs);
    const onAbort = () => ac.abort(signal?.reason);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      const res = await fetchFn(url, { signal: ac.signal, headers: { 'user-agent': MEDIA_UA, accept: 'application/json, text/html;q=0.8, image/*;q=0.5' } });
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: res.ok, status: res.status, url: res.url || url, buf, text: buf.toString('utf8') };
    } finally {
      clearTimeout(t);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  async function saveBuf(buf, outDir, name) {
    mkdirSync(outDir, { recursive: true });
    const abs = path.join(outDir, name);
    writeFileSync(abs, buf);
    let info = null;
    try { info = readImageSize(buf); } catch { info = { format: 'bin', width: null, height: null }; }
    return { path: abs, bytes: buf.length, format: info.format, width: info.width, height: info.height };
  }

  async function downloadUrls(urls, outDir, prefix) {
    const files = [];
    for (let i = 0; i < urls.length; i++) {
      const got = await getText(urls[i]);
      if (!got.ok) {
        files.push({ ok: false, url: urls[i], code: 'EHTTP', error: 'HTTP ' + got.status });
        continue;
      }
      const ext = got.buf[0] === 0x89 ? 'png' : 'jpg';
      const saved = await saveBuf(got.buf, outDir, prefix + '-' + String(i + 1).padStart(2, '0') + '.' + ext);
      files.push({ ok: true, url: urls[i], ...saved });
    }
    return files;
  }

  async function downloadMedia(kind, opts = {}) {
    if (!MEDIA_KINDS.includes(kind)) {
      throw new BrowseOptionError('browse.downloadMedia: unknown kind ' + JSON.stringify(kind) + '. valid: ' + MEDIA_KINDS.join(', '), 'EBADKIND');
    }
    if (typeof opts.outDir !== 'string' || !opts.outDir) {
      throw new BrowseOptionError('browse.downloadMedia: outDir is required', 'EBADVAL');
    }
    const outDir = assertInside(opts.outDir);
    if (signal?.aborted) return { ok: false, kind, code: 'ECANCELLED', error: 'media cancelled', files: [] };

    if (kind === 'appstore.screenshots') {
      if (opts.id === undefined || opts.id === null) {
        throw new BrowseOptionError('browse.downloadMedia: appstore.screenshots requires id', 'EBADVAL');
      }
      const got = await getText(itunesLookupUrl(opts.id, opts.country));
      if (!got.ok) return { ok: false, kind, code: 'EHTTP', error: 'itunes lookup HTTP ' + got.status, files: [], id: opts.id };
      const parsed = parseItunesScreenshotUrls(got.text);
      if (!parsed.ok) return { ok: false, kind, code: parsed.code, error: parsed.error, files: [], id: opts.id };
      const files = await downloadUrls(parsed.urls, outDir, 'appstore-' + opts.id);
      return { ok: files.some((f) => f.ok), kind, id: opts.id, files, engine: 'fetch' };
    }

    if (kind === 'playstore.screenshots') {
      if (typeof opts.id !== 'string' || !opts.id) {
        throw new BrowseOptionError('browse.downloadMedia: playstore.screenshots requires id (package name)', 'EBADVAL');
      }
      const got = await getText(playDetailsUrl(opts.id, opts.hl));
      if (!got.ok) return { ok: false, kind, code: 'EHTTP', error: 'play store HTTP ' + got.status, files: [], id: opts.id };
      const parsed = parsePlayScreenshotUrls(got.text);
      if (!parsed.ok) return { ok: false, kind, code: parsed.code, error: parsed.error, files: [], id: opts.id };
      const files = await downloadUrls(parsed.urls, outDir, 'playstore-' + opts.id.replace(/[^a-z0-9._-]/gi, '_'));
      return { ok: files.some((f) => f.ok), kind, id: opts.id, files, engine: 'fetch' };
    }

    if (kind === 'youtube.thumbnail') {
      const videoId = opts.videoId || opts.id;
      if (typeof videoId !== 'string' || !videoId) {
        throw new BrowseOptionError('browse.downloadMedia: youtube.thumbnail requires videoId', 'EBADVAL');
      }
      const names = ['maxresdefault', 'sddefault', 'hqdefault'];
      const files = [];
      for (const name of names) {
        const got = await getText(youtubeThumbUrl(videoId, name));
        if (!got.ok) continue;
        const saved = await saveBuf(got.buf, outDir, 'yt-' + videoId + '-' + name + '.jpg');
        files.push({ ok: true, url: youtubeThumbUrl(videoId, name), ...saved });
        break;
      }
      if (!files.length) return { ok: false, kind, code: 'ENOTFOUND', error: 'no youtube thumbnail', files: [], id: videoId };
      return { ok: true, kind, id: videoId, files, engine: 'fetch' };
    }

    // x.post.media
    if (typeof opts.url !== 'string' || !/^https?:\/\//i.test(opts.url)) {
      throw new BrowseOptionError('browse.downloadMedia: x.post.media requires url', 'EBADVAL');
    }
    const got = await getText(opts.url);
    if (!got.ok) return { ok: false, kind, code: 'EHTTP', error: 'HTTP ' + got.status, files: [], url: opts.url };
    const img = parseOgImage(got.text);
    if (!img) return { ok: false, kind, code: 'ENONE', error: 'no og:image / twitter:image (do not screenshot the page)', files: [], url: opts.url };
    const files = await downloadUrls([img], outDir, 'x-media');
    return { ok: files.some((f) => f.ok), kind, url: opts.url, files, engine: 'fetch' };
  }

  return Object.freeze({ downloadMedia, parseItunesScreenshotUrls, parsePlayScreenshotUrls, parseOgImage });
}
```

X item that is a login wall / CAPTCHA (wp3 classify) is `EBLOCK` if `detectBlock` is passed and fires; still **no** screenshot fallback. Play/iTunes HTTP hosts must match the three URL builders above — tests spy fetch.

---

### 5.4 NEW `src/host/browse/watch.js`

Reuses 040 `lineDiff` / `hashTree`. Persistence is the #15 file cache with `kind:'watch'`, not `~/.codemode/watch.json` (that path is outside roots and not a cache key). Optional `opts.store` must pass `assertInside` and is a JSON map `url -> {hash, text, fetchedAt}` **in addition to** the TTL cache so a daily routine survives a 10-minute TTL. Default store: `path.join(cache.dir, 'watch-store.json')` (tmpdir, like the cache; not a security boundary).

```js
// src/host/browse/watch.js
// wp6 #7 — per-URL text hash; diff only when changed.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { withFileLock } from '../file-lock.js';
import { BrowseOptionError } from './schema.js';
import { hashTree, lineDiff } from './extract.js';
import { SCHEMA_VERSIONS, canonicalUrl } from './cache.js';

export const WATCH_TEXT_MAX = 32768;

export function normalizeWatchText(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function createWatch({ cache, readText, extract, assertInside, signal, nowMs = () => Date.now(), identity = {} } = {}) {
  async function loadStore(storePath) {
    if (!existsSync(storePath)) return {};
    try { return JSON.parse(readFileSync(storePath, 'utf8')); }
    catch { return {}; }
  }
  async function saveStore(storePath, data) {
    mkdirSync(path.dirname(storePath), { recursive: true });
    await withFileLock(storePath, { signal }, () => {
      const tmp = storePath + '.tmp-' + process.pid;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, storePath);
    });
  }

  async function watch(list, opts = {}) {
    if (!Array.isArray(list) || list.length === 0) {
      throw new BrowseOptionError('browse.watch: list must be a non-empty array of {url, selector?}', 'EBADVAL');
    }
    const storePath = opts.store
      ? assertInside(opts.store)
      : path.join(cache.dir, 'watch-store.json');
    const store = await loadStore(storePath);
    const items = [];
    for (const row of list) {
      const url = typeof row === 'string' ? row : row?.url;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        items.push({ url, ok: false, changed: false, code: 'EBADVAL', error: 'url must be http(s)' });
        continue;
      }
      const id = canonicalUrl(url) + (row?.selector ? '#' + row.selector : '');
      let text;
      if (row?.selector) {
        const ex = await extract(url, { body: { css: row.selector, type: 'string' } }, { timeoutMs: opts.timeoutMs });
        text = normalizeWatchText(ex?.data?.body);
      } else {
        const rt = await readText(url, { fallback: 'never' });
        text = normalizeWatchText(rt?.markdown || rt?.text || '');
      }
      if (text.length > WATCH_TEXT_MAX) text = text.slice(0, WATCH_TEXT_MAX);
      const hash = hashTree(text);
      const prev = store[id];
      const changed = !prev || prev.hash !== hash;
      const item = {
        url, ok: true, changed, hash, prevAt: prev?.fetchedAt ?? null, selector: row?.selector ?? null,
      };
      if (changed && prev) {
        const diff = lineDiff(prev.text, text);
        item.addedText = diff.split('\n').filter((l) => l.startsWith('+')).map((l) => l.slice(1));
        item.removedText = diff.split('\n').filter((l) => l.startsWith('-')).map((l) => l.slice(1));
        item.diff = diff;
      } else if (!changed) {
        // issue #7: unchanged is one line. Do not attach text/diff/screenshotPath.
      } else {
        item.addedText = text ? [text] : [];
        item.removedText = [];
        item.prevAt = null;
      }
      store[id] = { hash, text, fetchedAt: nowMs() };
      if (cache) {
        await cache.set({ ...identity, kind: 'watch', schemaVersion: SCHEMA_VERSIONS.watch, id }, { hash, changed });
      }
      items.push(item);
    }
    await saveStore(storePath, store);
    const changedN = items.filter((i) => i.changed).length;
    return { items, complete: items.every((i) => i.ok), partial: items.some((i) => !i.ok), scope: { n: list.length, changed: changedN, store: storePath } };
  }

  return Object.freeze({ watch, normalizeWatchText });
}
```

`opts.screenshot` is **not** implemented — capturing a screenshot on change is wp4 `captureMany`, opt-in later. Default is text-only so watch never leaks tabs (E5).

Selector path uses `browse.extract` (wp5) so tests inject the same fake session. No `page.textContent` (E3 absent).

---

### 5.5 NEW `src/host/browse/recipes.js`

JSON-only. No LLM. No `eval`. Browser recipes compile **one** repl script with `finally { closeTab }` and go through `runGuardedBatch`. Fetch recipes (`appstore.app`, `youtube.shorts.search`) spawn nothing.

```js
// src/host/browse/recipes.js
// wp6 #9 — site recipes as data. Guest root `recipes`.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { BrowseOptionError } from './schema.js';
import { runGuardedBatch, createCircuitBreakerFromConfig } from './policy.js';

export const RECIPE_STEPS = Object.freeze(['goto', 'waitForSelector', 'click', 'extract', 'fetchItunes', 'searchMany']);

export const BUILTIN_RECIPES = Object.freeze({
  'playstore.whatsnew': {
    description: 'Play Store details: wait for description, optionally click the "new features" expander, extract version/notes/rating/screenshots. One repl. No LLM.',
    inputs: {
      id: { type: 'string', required: true, description: 'package name' },
      hl: { type: 'string', required: false, description: 'Play hl (default ko)' },
    },
    engine: 'browser',
    steps: [
      { action: 'goto', url: 'https://play.google.com/store/apps/details?id={{id}}&hl={{hl}}' },
      { action: 'waitForSelector', selector: '[itemprop=description]' },
      { action: 'click', selector: 'button[jsname], button[aria-expanded="false"]', optional: true },
      { action: 'extract', schema: {
        name: { css: 'h1, [itemprop=name]', type: 'string' },
        notes: { css: '[itemprop=description]', type: 'string' },
        rating: { css: '[aria-label*="star" i], [itemprop=ratingValue]', type: 'string' },
        screenshots: { css: 'img[src*="play-lh.googleusercontent.com"]', attr: 'src', all: true, type: 'string' },
      } },
    ],
  },
  'appstore.app': {
    description: 'iTunes lookup JSON. No browser. Returns version, rating, screenshot URLs.',
    inputs: {
      id: { type: 'number', required: true, description: 'iTunes track id' },
      country: { type: 'string', required: false, description: 'default us' },
    },
    engine: 'fetch',
    steps: [{ action: 'fetchItunes' }],
  },
  'youtube.shorts.search': {
    description: 'searchMany with site:youtube.com/shorts plus within. No browser.',
    inputs: {
      q: { type: 'string', required: true, description: 'search query' },
      within: { type: 'string', required: false, description: 'e.g. 7d' },
    },
    engine: 'fetch',
    steps: [{ action: 'searchMany' }],
  },
});

export function interpolate(str, args) {
  return String(str).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, k) => {
    if (args[k] === undefined || args[k] === null) return '';
    return String(args[k]);
  });
}

export function compileRecipeScript(recipe, args, { scriptDeadlineMs }) {
  const job = {
    url: interpolate(recipe.steps.find((s) => s.action === 'goto')?.url || '', args),
    steps: recipe.steps.filter((s) => s.action !== 'goto').map((s) => ({
      ...s,
      selector: s.selector ? interpolate(s.selector, args) : s.selector,
    })),
    scriptDeadlineMs,
  };
  return '(async () => {\n'
    + '  const JOB = ' + JSON.stringify(job) + ';\n'
    + '  const opened = [];\n'
    + '  const items = [];\n'
    + '  try {\n'
    + '    const work = (async () => {\n'
    + '      const tab = await openTab(JOB.url);\n'
    + '      opened.push({ id: tab && (tab.id || tab.targetId || tab), url: JOB.url });\n'
    + '      const page = tab.page || tab;\n'
    + '      let extract = null;\n'
    + '      let failedStep = null;\n'
    + '      for (const step of JOB.steps) {\n'
    + '        try {\n'
    + '          if (step.action === "waitForSelector") await page.waitForSelector(step.selector, { timeout: 8000 });\n'
    + '          else if (step.action === "click") await page.click(step.selector);\n'
    + '          else if (step.action === "extract") {\n'
    + '            extract = await page.evaluate((schema) => {\n'
    + '              const out = {};\n'
    + '              for (const [key, spec] of Object.entries(schema)) {\n'
    + '                const attr = spec.attr || "textContent";\n'
    + '                if (spec.all) {\n'
    + '                  out[key] = [...document.querySelectorAll(spec.css)].map((n) => attr === "textContent" ? (n.textContent || "") : (n.getAttribute(attr) || ""));\n'
    + '                } else {\n'
    + '                  const n = document.querySelector(spec.css);\n'
    + '                  out[key] = n ? (attr === "textContent" ? (n.textContent || "") : (n.getAttribute(attr) || "")) : null;\n'
    + '                }\n'
    + '              }\n'
    + '              return out;\n'
    + '            }, step.schema);\n'
    + '          }\n'
    + '        } catch (err) {\n'
    + '          if (!step.optional) { failedStep = { action: step.action, selector: step.selector || null, error: String(err && err.message ? err.message : err) }; break; }\n'
    + '        }\n'
    + '      }\n'
    + '      items.push({ url: JOB.url, ok: !failedStep, extract, failedStep });\n'
    + '      console.log(JSON.stringify({ items, timings: [], leakedUrls: opened.map((o) => o.url) }));\n'
    + '    })();\n'
    + '    await Promise.race([work, sleep(JOB.scriptDeadlineMs).then(() => { const e = new Error("script deadline"); e.code = "ETIMEOUT"; throw e; })]);\n'
    + '  } catch (e) {\n'
    + '    if (!items.length) items.push({ url: JOB.url, ok: false, error: String(e && e.message ? e.message : e), code: e && e.code || null });\n'
    + '    console.log(JSON.stringify({ items, timings: [], leakedUrls: opened.map((o) => o.url), error: String(e && e.message ? e.message : e) }));\n'
    + '  } finally {\n'
    + '    for (const t of opened) { try { await closeTab(t.id); } catch (_) {} }\n'
    + '  }\n'
    + '})();\n';
}

export function loadUserRecipes(dir, assertInside) {
  if (!dir) return {};
  const root = assertInside(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) return {};
  const extra = {};
  for (const name of readdirSync(root)) {
    if (name.endsWith('.js')) {
      throw new BrowseOptionError('recipes: .js recipe files are ENOTSUP (JSON steps only, no eval): ' + name, 'ENOTSUP');
    }
    if (!name.endsWith('.json')) continue;
    const rec = JSON.parse(readFileSync(path.join(root, name), 'utf8'));
    if (!rec || typeof rec !== 'object' || !Array.isArray(rec.steps)) {
      throw new BrowseOptionError('recipes: ' + name + ' must be {description, inputs, steps[]}', 'EBADVAL');
    }
    extra[name.replace(/\.json$/, '')] = rec;
  }
  return extra;
}

export const RECIPE_ACTIONS = [
  { path: 'recipes.run', description: 'Run a named site recipe with no LLM turn.', signature: 'recipes.run(name, args) => Promise<{ok, name, data, failedStep}>', inputs: { name: { type: 'string', required: true, description: 'Recipe name' }, args: { type: 'object', required: false, description: 'Recipe inputs' } } },
  { path: 'recipes.list', description: 'List built-in and user JSON recipes.', signature: 'recipes.list() => {path, description}[]', inputs: {} },
  { path: 'recipes.describe', description: 'Show one recipe: inputs, engine, steps.', signature: 'recipes.describe(name) => object', inputs: { name: { type: 'string', required: true, description: 'Recipe name' } } },
  { path: 'recipes.check', description: 'Validate args against recipe.inputs (same shape as actions.check).', signature: 'recipes.check(name, args) => {ok, missing, unknown, typeErrors}', inputs: { name: { type: 'string', required: true, description: 'Recipe name' }, args: { type: 'object', required: false, description: 'Candidate args' } } },
];

export function createRecipes({
  session, searchMany, downloadMedia, api, config, signal, assertInside, parseReplTranscript, applyExtractSchema,
} = {}) {
  const user = loadUserRecipes(config?.browseCaps?.recipesDir, assertInside);
  const catalog = { ...BUILTIN_RECIPES, ...user };

  function get(name) {
    const rec = catalog[name];
    if (!rec) throw new BrowseOptionError('unknown recipe: ' + name + '. known: ' + Object.keys(catalog).join(', '), 'ENOTFOUND');
    return rec;
  }

  function check(name, args = {}) {
    const rec = get(name);
    const missing = []; const unknown = []; const typeErrors = [];
    const inputs = rec.inputs || {};
    for (const [k, spec] of Object.entries(inputs)) {
      if (spec.required && !(k in args)) missing.push(k);
      else if (k in args && spec.type === 'string' && typeof args[k] !== 'string') typeErrors.push({ name: k, want: 'string', got: typeof args[k] });
      else if (k in args && spec.type === 'number' && typeof args[k] !== 'number') typeErrors.push({ name: k, want: 'number', got: typeof args[k] });
    }
    for (const k of Object.keys(args)) if (!(k in inputs)) unknown.push(k);
    return { ok: missing.length === 0 && unknown.length === 0 && typeErrors.length === 0, missing, unknown, typeErrors };
  }

  async function run(name, args = {}) {
    const rec = get(name);
    const checked = check(name, args);
    if (!checked.ok) throw new BrowseOptionError('recipes.run: invalid args: ' + JSON.stringify(checked), 'EBADVAL');
    const filled = { hl: 'ko', country: 'us', ...args };

    if (name === 'appstore.app') {
      const batch = await api.batch([{ kind: 'itunes.lookup', id: args.id, country: filled.country }]);
      const item = batch.items[0];
      return { ok: item?.ok === true, name, engine: 'fetch', data: item, failedStep: item?.ok ? null : { action: 'fetchItunes', error: item?.error } };
    }
    if (name === 'youtube.shorts.search') {
      const q = args.q + ' site:youtube.com/shorts';
      const out = await searchMany([{ q, within: args.within }], { max: 8 });
      return { ok: out.complete, name, engine: 'fetch', data: out, failedStep: null };
    }

    // playstore.whatsnew and any browser extra
    const source = compileRecipeScript(rec, filled, { scriptDeadlineMs: 20000 });
    if (/page\.route|networkidle|format:\s*['"]A4['"]/.test(source)) {
      throw new Error('recipe compiler emitted a forbidden primitive');
    }
    const breaker = createCircuitBreakerFromConfig(config?.browseCaps);
    const url = interpolate(rec.steps.find((s) => s.action === 'goto').url, filled);
    const batch = await runGuardedBatch({
      urls: [url],
      signal,
      breaker,
      runItem: async ({ timeoutMs }) => {
        const raw = await session.run({ source, deadlines: { scriptDeadlineMs: Math.min(timeoutMs, 20000), hostWaitMs: Math.min(timeoutMs, 20000) + 2000 } });
        const parsed = parseReplTranscript ? parseReplTranscript(raw.stdout || raw) : (raw.items ? raw : { items: [] });
        const item = parsed.items?.[0] || {};
        return {
          finalUrl: item.url || url,
          title: item.title,
          extract: item.extract,
          failedStep: item.failedStep,
          error: item.ok === false ? { message: item.error || item.failedStep?.error, code: item.code } : null,
        };
      },
    });
    const item = batch.items[0];
    const extractStep = rec.steps.find((s) => s.action === 'extract');
    const applied = extractStep && applyExtractSchema ? applyExtractSchema(extractStep.schema, wrapRaw(item.extract || item /* outcome */)) : { data: item.extract || null, missing: [] };
    return {
      ok: item.ok === true,
      name,
      engine: 'browser',
      data: applied.data,
      missing: applied.missing,
      failedStep: item.failedStep || (item.ok ? null : { action: 'goto', error: item.reason }),
      complete: batch.complete,
      partial: batch.partial,
    };
  }

  function wrapRaw(extract) {
    if (!extract || typeof extract !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(extract)) {
      out[k] = v && typeof v === 'object' && 'raw' in v ? v : { raw: v };
    }
    return out;
  }

  return Object.freeze({
    run,
    list() { return Object.entries(catalog).map(([k, v]) => ({ path: k, description: v.description, engine: v.engine })); },
    describe(name) { const rec = get(name); return { name, ...rec }; },
    check,
  });
}
```

`page.click` is present (001 E3). Optional click failures do not fail the recipe. Required selector failures set `failedStep` and do not retry. `runGuardedBatch` still classifies login walls.

---

### 5.6 NEW `src/host/browse/prefetch.js` — LAST

Do not create this file until `test/browse-cache.test.js` (especially the two-process key+TTL cases in §7.3) is green. Prefetch is a cache client, not a scheduler.

```js
// src/host/browse/prefetch.js
// wp6 #16 — warm the file cache. Guest calls this; there is no cron in this repo.
import { BrowseOptionError } from './schema.js';
import { SCHEMA_VERSIONS, canonicalUrl } from './cache.js';

export function createPrefetch({ cache, readText, captureMany, identity = {} } = {}) {
  async function prefetch(urls, opts = {}) {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new BrowseOptionError('browse.prefetch: urls must be a non-empty array', 'EBADVAL');
    }
    const mode = opts.mode || 'readText';
    if (mode !== 'readText' && mode !== 'capture') {
      throw new BrowseOptionError("browse.prefetch: mode must be 'readText' or 'capture'", 'EBADVAL');
    }
    if (!cache) throw new BrowseOptionError('browse.prefetch: cache is not configured', 'ENOTSUP');
    const warmed = [];
    const failed = [];
    const skipped = [];
    for (const url of urls) {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        failed.push({ url, code: 'EBADVAL', error: 'url must be http(s)' });
        continue;
      }
      const fields = {
        ...identity,
        kind: mode === 'capture' ? 'capture' : 'readText',
        schemaVersion: mode === 'capture' ? SCHEMA_VERSIONS.capture : SCHEMA_VERSIONS.readText,
        id: canonicalUrl(url),
      };
      if (!opts.force) {
        const hit = await cache.get(fields);
        if (hit.hit) { skipped.push({ url, cache: 'hit', key: hit.key }); continue; }
      }
      try {
        if (mode === 'readText') {
          const value = await readText(url, { fallback: 'never', cache: false });
          if (value?.error) { failed.push({ url, code: value.error.code || 'EFETCH', error: value.error.error || value.error }); continue; }
          await cache.set(fields, value);
          warmed.push({ url, cache: 'write', engine: value.engine || 'fetch' });
        } else {
          const env = await captureMany([{ url }], { ...opts, cache: false });
          const item = env.items?.[0];
          if (!item || item.ok === false) { failed.push({ url, code: item?.code || 'EFAIL', error: item?.error || 'capture failed' }); continue; }
          await cache.set(fields, item);
          warmed.push({ url, cache: 'write', engine: 'browser' });
        }
      } catch (e) {
        failed.push({ url, code: e.code || 'EFAIL', error: String(e.message || e) });
      }
    }
    return {
      warmed, skipped, failed,
      complete: failed.length === 0,
      partial: failed.length > 0,
      scope: { mode, n: urls.length, force: opts.force === true },
    };
  }
  return Object.freeze({ prefetch });
}
```

`cache: false` on the inner `readText` / `captureMany` call prevents a re-entrancy loop if those wrappers also consult the cache. Freshness is decided **here**.

---

### 5.7 MODIFY `src/host/browse/browse.js` (wp2/4/5 file; **absent today**)

040 factory is frozen `{ captureMany, screenshot, readText, extract, snapshot, open }` (plus `probe`/`exec` if wp2 left them). After wp6, spread those and add the four verbs. Wrap `captureMany` / `readText` / `extract` with the file cache. Do not drop `captureMany`.

```js
import { createBrowseCache, SCHEMA_VERSIONS, canonicalUrl } from './cache.js';
import { createSearchMany } from './search-web.js';
import { createMedia } from './media.js';
import { createWatch } from './watch.js';
import { createPrefetch } from './prefetch.js';

// inside createBrowse, after captureMany/screenshot/readText/extract/snapshot/open exist:
const identity = {
  account: browseCaps?.account ?? 'anon',
  profile: browseCaps?.profile ?? 'default',
  locale: browseCaps?.locale ?? 'und',
  viewport: '1440x900',
};
const cache = createBrowseCache({
  dir: browseCaps?.cacheDir, ttlMs: browseCaps?.cacheTtlMs, signal,
});
const rawCaptureMany = captureMany;
const rawReadText = readText;
const rawExtract = extract;

async function cachedReadText(urlOrUrls, opts = {}) {
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  const out = [];
  const miss = [];
  for (let i = 0; i < urls.length; i++) {
    const fields = { ...identity, kind: 'readText', schemaVersion: SCHEMA_VERSIONS.readText, auth: 'none', id: canonicalUrl(urls[i]) };
    if (opts.cache !== false) {
      const hit = await cache.get(fields);
      if (hit.hit) { out[i] = { ...hit.value, cached: true }; continue; }
    }
    miss.push(i);
  }
  if (miss.length) {
    const fetched = await rawReadText(miss.map((i) => urls[i]), { ...opts, cache: false });
    const rows = Array.isArray(fetched) ? fetched : [fetched];
    for (let k = 0; k < miss.length; k++) {
      out[miss[k]] = rows[k];
      if (rows[k] && !rows[k].error) {
        await cache.set({ ...identity, kind: 'readText', schemaVersion: SCHEMA_VERSIONS.readText, auth: 'none', id: canonicalUrl(urls[miss[k]]) }, rows[k]);
      }
    }
  }
  return Array.isArray(urlOrUrls) ? out : out[0];
}

async function cachedCaptureMany(items, opts = {}) {
  if (opts.cache === false) return rawCaptureMany(items, opts);
  // Per-item get; misses batched into ONE rawCaptureMany (E6 / E1 one-repl).
  const list = Array.isArray(items) ? items : [items];
  const out = new Array(list.length);
  const miss = [];
  for (let i = 0; i < list.length; i++) {
    const url = typeof list[i] === 'string' ? list[i] : list[i]?.url;
    const fields = { ...identity, kind: 'capture', schemaVersion: SCHEMA_VERSIONS.capture, auth: 'aside-repl', id: canonicalUrl(url) };
    const hit = await cache.get(fields);
    if (hit.hit) { out[i] = { ...hit.value, cached: true }; }
    else miss.push(i);
  }
  if (miss.length) {
    const env = await rawCaptureMany(miss.map((i) => list[i]), { ...opts, cache: false });
    for (let k = 0; k < miss.length; k++) {
      const item = env.items[k];
      out[miss[k]] = item;
      if (item && item.ok !== false) {
        const url = typeof list[miss[k]] === 'string' ? list[miss[k]] : list[miss[k]]?.url;
        await cache.set({ ...identity, kind: 'capture', schemaVersion: SCHEMA_VERSIONS.capture, auth: 'aside-repl', id: canonicalUrl(url) }, item);
      }
    }
    return { ...env, items: out };
  }
  return { items: out, complete: true, truncated: false, partial: [], scope: { cache: 'all-hit' } };
}

const search = createSearchMany({ fetchImpl, cache, signal, identity });
const media = createMedia({ fetchImpl, assertInside, signal });
const watchFns = createWatch({ cache, readText: cachedReadText, extract: rawExtract, assertInside, signal, identity });
const prefetchFns = createPrefetch({ cache, readText: rawReadText, captureMany: rawCaptureMany, identity });

return Object.freeze({
  captureMany: cachedCaptureMany, screenshot, readText: cachedReadText,
  extract: rawExtract, snapshot, open, probe, exec,
  searchMany: (queries, opts) => search.searchMany(queries, opts),
  downloadMedia: (kind, opts) => media.downloadMedia(kind, opts),
  watch: (list, opts) => watchFns.watch(list, opts),
  prefetch: (urls, opts) => prefetchFns.prefetch(urls, opts),
});
```

`extract` is **not** file-cached by default: schema is the identity and wp5 already has an in-execution Map for snapshots. A caller who wants extract cached passes through `readText` + local parse. Do not silently cache extract JSON under a URL-only key (schema change would return stale typed values — that is why `schemaVersion` exists, and why we still skip it unless opts.cache === true with a schema hash in `id`).

If `probe`/`exec`/`open` are missing at wp6 P, omit them from the freeze rather than throwing. Amend this file if 040 used different local names.

---

### 5.8 MODIFY `src/host/browse/schema.js` (wp2 file; **absent today**)

Append option tables and catalogs. Keep existing `BROWSE_ACTIONS` / `API_ACTIONS` / `REPORT_ACTIONS`. Add:

```js
export const SEARCH_MANY_OPTS = {
  dedupe: { type: 'boolean', required: false, description: 'Drop URLs already returned by an earlier query (default true). First query wins.' },
  max: { type: 'number', required: false, description: 'Per-query result cap after dedupe (default 5).' },
  within: { type: 'string', required: false, description: 'Date window like 14d / 2w / 1m / 1y. Applied as after:YYYY-MM-DD plus DDG df=.' },
  engine: { type: 'string', required: false, description: "'fetch' (default, DDG HTML) or 'google' (ENOTSUP until a googleSearch callable is proven)." },
  cache: { type: 'boolean', required: false, description: 'Consult the file cache (default true).' },
};
export const MEDIA_OPTS = {
  outDir: { type: 'string', required: true, description: 'Directory inside roots to write original files.' },
  id: { type: 'string', required: false, description: 'iTunes track id or Play package name.' },
  videoId: { type: 'string', required: false, description: 'YouTube video id.' },
  url: { type: 'string', required: false, description: 'X post URL for x.post.media.' },
  country: { type: 'string', required: false, description: 'iTunes country (default us).' },
  hl: { type: 'string', required: false, description: 'Play hl (default en).' },
};
export const WATCH_OPTS = {
  store: { type: 'string', required: false, description: 'JSON path inside roots. Default is tmpdir watch-store.json.' },
  timeoutMs: { type: 'number', required: false, description: 'Per-URL budget.' },
};
export const PREFETCH_OPTS = {
  mode: { type: 'string', required: false, description: "'readText' (default) or 'capture'." },
  force: { type: 'boolean', required: false, description: 'Bypass TTL and rewrite.' },
};

export const BROWSE_ACTIONS_WP6 = [
  { path: 'browse.searchMany', description: 'Parallel web search with URL dedupe and optional date filter. Default engine is DuckDuckGo HTML. googleSearch is ENOTSUP until a callable is proven.', signature: 'browse.searchMany([{q, within?}], {dedupe?, max?, engine?}) => {items,complete,partial,scope}', inputs: { queries: { type: 'array', required: true, description: '{q, within?}[]' }, ...SEARCH_MANY_OPTS } },
  { path: 'browse.downloadMedia', description: 'Download original images from iTunes screenshots, Play img src, YouTube thumbnails, or X og:image. Never page.screenshot.', signature: 'browse.downloadMedia(kind, {outDir, id?, videoId?, url?, country?, hl?}) => {ok,files}', inputs: { kind: { type: 'string', required: true, description: MEDIA_KINDS.join('|') }, ...MEDIA_OPTS } },
  { path: 'browse.watch', description: 'Persist per-URL text hashes; return diffs only for changed URLs.', signature: 'browse.watch([{url, selector?}], {store?}) => {items,complete}', inputs: { list: { type: 'array', required: true, description: '{url, selector?}[]' }, ...WATCH_OPTS } },
  { path: 'browse.prefetch', description: 'Warm the file-backed TTL cache. No daemon.', signature: 'browse.prefetch(urls, {mode?, force?}) => {warmed,skipped,failed}', inputs: { urls: { type: 'array', required: true, description: 'http(s) URLs' }, ...PREFETCH_OPTS } },
];
```

Re-export `RECIPE_ACTIONS` from `recipes.js` (or copy the four rows here — one catalog owner, matching `SEARCH_ACTIONS` in `src/search-schema.js`). `BROWSE_ACTIONS` after wp6 = previous rows + `BROWSE_ACTIONS_WP6`.

`engine:'google'` is `ENOTSUP` at execution, not a catalog-unknown. `maxWidth` / `block` / `format` stay `ENOTSUP` as in 010/040; wp6 does not reopen them.

---

### 5.9 MODIFY `src/host/browse/probe.js` (wp2)

Add to the doctor object (010 `ASIDE_CAPS` / 030 matrix):

```js
matrix.searchMany = {
  guestName: 'browse.searchMany',
  defaultEngine: 'fetch',
  fetchEndpoint: 'https://html.duckduckgo.com/html/',
  googleSearch: 'unproven — typeof probe only; prototype is opaque (001 E2)',
};
matrix.cache = {
  dir: 'os.tmpdir()/codemode-browse-cache',
  ttlMs: 600000,
  lock: 'src/host/file-lock.js withFileLock',
  securityBoundary: false,
  key: ['account','profile','auth','locale','viewport','schemaVersion','kind','id'],
};
matrix.downloadMedia = { kinds: ['appstore.screenshots','playstore.screenshots','youtube.thumbnail','x.post.media'], screenshot: false };
matrix.watch = { store: 'file', diff: 'lineDiff' };
matrix.recipes = { names: ['playstore.whatsnew','appstore.app','youtube.shorts.search'], eval: false };
matrix.prefetch = { requires: 'cache' };
```

---

### 5.10 MODIFY `src/host/globals.js` (HEAD `src/host/globals.js:8-19`)

Current:

```js
export function createHostGlobals(config, assertInside, signal) {
  const rgRunner = createRgRunner(createRgResolver(config, process.env, { signal }), { excludeGlobs: config.excludeGlobs, signal });
  const hostFs = createFs({ assertInside, signal });
  return {
    search: createSearch({ rgRunner, assertInside, caps: config.searchCaps }),
    fs: hostFs,
    read_file: hostFs.read_file,
    write_file: hostFs.write_file,
    edit_file: hostFs.edit_file,
    apply_patch: createApplyPatch({ write_file: hostFs.write_file, edit_file: hostFs.edit_file }),
    actions: createActions(),
  };
}
```

After wp5 this already has `browse` / `report` / `api` and a shared `session` (040 §5.11). wp6 **keeps that session** and adds `recipes`:

```js
import { createRecipes } from './browse/recipes.js';

  const recipes = createRecipes({
    session, searchMany: browse.searchMany, downloadMedia: browse.downloadMedia,
    api, config, signal, assertInside,
    parseReplTranscript, applyExtractSchema,
  });
  return { /* existing keys */, browse, report, api, recipes };
```

Create `browse` before `recipes` so `browse.searchMany` exists. One `createBrowseCache` inside `createBrowse`; do not construct a second cache in `createRecipes`.

---

### 5.11 MODIFY `src/sandbox.js:7` ROOTS

Current: `const ROOTS = ['search', 'fs', 'actions', 'read_file', 'write_file', 'edit_file', 'apply_patch'];`

After wp5: those plus `'browse', 'report', 'api'`.

After wp6:

```js
const ROOTS = ['search', 'fs', 'actions', 'read_file', 'write_file', 'edit_file', 'apply_patch', 'browse', 'report', 'api', 'recipes'];
```

Do not walk a second object level. Do not add a `msg.browse` restore lane next to `src/sandbox.js:110-112`.

---

### 5.12 MODIFY `src/execution-worker.js:50-56`

Current:

```js
const injected = { search: {}, fs: {}, actions: {} };
for (const name of manifest) {
  const [root, method] = name.split('.');
  if (method) injected[root][method] = (...args) => root === 'actions' ? syncRpc(name, args) : rpc(name, args);
  else injected[root] = (...args) => rpc(name, args);
}
for (const key of ['search', 'fs', 'actions']) Object.freeze(injected[key]);
```

After wp5 the freeze list includes `browse`, `report`, `api`. After wp6:

```js
const injected = { search: {}, fs: {}, actions: {}, browse: {}, report: {}, api: {}, recipes: {} };
// ... same loop ...
for (const key of ['search', 'fs', 'actions', 'browse', 'report', 'api', 'recipes']) Object.freeze(injected[key]);
```

Pre-create is mandatory: `injected[root][method] =` throws if `recipes` is missing (002).

---

### 5.13 MODIFY `src/host/actions.js:11-12`

Current: `const REGISTRY = [ ...SEARCH_ACTIONS, { path: 'read_file', ...`

After wp5 this already splices `BROWSE_ACTIONS` / `REPORT_ACTIONS` / `API_ACTIONS` (040 §5.14). wp6 adds:

```js
import { RECIPE_ACTIONS } from '../browse/recipes.js';

const REGISTRY = [
  ...SEARCH_ACTIONS,
  ...BROWSE_ACTIONS,
  ...REPORT_ACTIONS,
  ...API_ACTIONS,
  ...RECIPE_ACTIONS,
  {
    path: 'read_file',
```

`test/actions.test.js:11` asserts `list().length >= 11` (floor). Add assertions in wp6 tests that `actions.list('recipes')` returns four rows and `actions.list('browse.searchMany')` is non-empty.

---

### 5.14 MODIFY `src/tools.js:7-23` GUEST_API_DOC

Append bullets after the wp5 browse/api/report bullets (040 §5.15), before the closing `.join('\n')`:

```
  '- browse.searchMany([{q, within?}], {dedupe?, max?, engine?}) => {items,complete,partial} — parallel web search. Default engine is DuckDuckGo HTML. URL dedupe keeps the first query. within is 14d/2w/1m/1y. engine:\'google\' is ENOTSUP until a googleSearch callable is proven (the Aside global is opaque; prototype enumeration is empty). Pipe URLs into browse.readText. There is no web.* guest root.',
  '- browse.downloadMedia(kind, {outDir, id?, videoId?, url?}) => {ok,files} — original image bytes from iTunes screenshotUrls, Play img src, YouTube i.ytimg.com, or X og:image. Never page.screenshot. download global is undefined in Aside CLI.',
  '- browse.watch([{url, selector?}], {store?}) => {items} — persist text hashes; unchanged URLs return {changed:false} only.',
  '- browse.prefetch(urls, {mode?, force?}) => {warmed,skipped,failed} — warm the tmpdir TTL cache. No daemon.',
  '- recipes.run(name, args) / recipes.list / recipes.describe / recipes.check — site recipes with no LLM turn. Built-ins: playstore.whatsnew (one repl), appstore.app (iTunes fetch), youtube.shorts.search (searchMany). .js recipe files are ENOTSUP.',
```

Leave `inputSchema` as `{code, timeoutMs}` (`src/tools.js:28-36`).

---

### 5.15 MODIFY `src/config.js` (HEAD `src/config.js:29-36`, `:109-112`, `:124-130`)

Current defaults:

```js
const DEFAULTS = {
  roots: [],
  rgPath: null,
  maxResultBytes: 65536,
  maxTimeoutMs: 120000,
  searchCaps: { files: 5000, content: 500 },
  excludeGlobs: DEFAULT_EXCLUDES,
};
```

wp2–wp5 already add `browseCaps` / `apiCaps` / `reportCaps`. wp6 field-wise copies **inside** the existing `browseCaps` object (a key not copied is silently dropped — 002, `src/config.js:96-114`):

```js
      if ('cacheTtlMs' in obj.browseCaps) {
        cfg.browseCaps.cacheTtlMs = requireInteger('browseCaps.cacheTtlMs', obj.browseCaps.cacheTtlMs, 0, 86_400_000);
      }
      if ('cacheDir' in obj.browseCaps && (typeof obj.browseCaps.cacheDir === 'string' || obj.browseCaps.cacheDir === null)) {
        cfg.browseCaps.cacheDir = obj.browseCaps.cacheDir;
      }
      if ('account' in obj.browseCaps && typeof obj.browseCaps.account === 'string') cfg.browseCaps.account = obj.browseCaps.account;
      if ('profile' in obj.browseCaps && typeof obj.browseCaps.profile === 'string') cfg.browseCaps.profile = obj.browseCaps.profile;
      if ('locale' in obj.browseCaps && typeof obj.browseCaps.locale === 'string') cfg.browseCaps.locale = obj.browseCaps.locale;
      if ('recipesDir' in obj.browseCaps && (typeof obj.browseCaps.recipesDir === 'string' || obj.browseCaps.recipesDir === null)) {
        cfg.browseCaps.recipesDir = obj.browseCaps.recipesDir;
      }
```

Defaults to merge into whatever `browseCaps` already exists:

```js
    cacheTtlMs: 600000,
    cacheDir: null,      // => os.tmpdir()/codemode-browse-cache
    account: 'anon',
    profile: 'default',
    locale: 'und',
    recipesDir: null,
```

Env (flat, last-win, after `src/config.js:124-130`):

- `CODEMODE_BROWSE_CACHE_TTL_MS`
- `CODEMODE_BROWSE_CACHE_DIR`
- `CODEMODE_BROWSE_ACCOUNT`
- `CODEMODE_BROWSE_PROFILE`
- `CODEMODE_BROWSE_LOCALE`

No nested env for recipesDir (002: no nested env convention). `cacheTtlMs: 0` means "always miss" (useful in tests), not "infinite".

Do **not** import `cache.js` from `config.js` (layering).

---

### 5.16 MODIFY `codemode.config.example.json`

Current has `searchCaps` at `:6-9`. After wp5 it also has `browseCaps.waitForByHost` etc. Append inside `browseCaps`:

```json
    "cacheTtlMs": 600000,
    "cacheDir": null,
    "account": "anon",
    "profile": "default",
    "locale": "und",
    "recipesDir": null
```

Keep wp2/wp5 keys; do not delete `asidePath` / `enabled` / `concurrency` / `waitForByHost`.

---

### 5.17 MODIFY `test/config.test.js`

Add cases: file copy of `browseCaps.cacheTtlMs`; env `CODEMODE_BROWSE_CACHE_TTL_MS` wins; `CODEMODE_BROWSE_ACCOUNT` copies into `browseCaps.account`; unknown nested key not copied is absent. Follow the existing searchCaps pattern in this file.

---

### 5.18 MODIFY README / README.ko / templates (SOT-SYNC-01)

`README.md:47-55` and `README.ko.md:47-55` Guest API tables — append after the wp5 rows:

English:

```
| `browse.searchMany` | Parallel web search, URL dedupe, `within` date filter. Default engine is DuckDuckGo HTML. `googleSearch` is ENOTSUP until a callable is proven |
| `browse.downloadMedia` | Original image bytes (iTunes / Play / YouTube thumb / X og:image). Not a page screenshot |
| `browse.watch` | Persist text hashes; diffs only for changed URLs |
| `browse.prefetch` | Warm the tmpdir TTL cache. No daemon |
| `recipes.run` / `list` / `describe` / `check` | Site recipes, no LLM turn. JSON steps only |
```

Korean: same names, short roles (검색 병렬+중복제거+날짜 / 원본 이미지 / 해시 감시 / 캐시 워밍 / LLM 없는 레시피).

One sentence under the table: the file cache lives under `os.tmpdir()`, is **not** a security boundary, and is keyed by account/profile/auth/locale/viewport/schema version so parallel `execute_code` processes share hits.

`templates/AGENTS.codemode.md:9-16` — after the available-tools sentence, add: `browse.searchMany`, `browse.downloadMedia`, `browse.watch`, `browse.prefetch`, `recipes.run` are host RPCs; do not call `googleSearch` or `aside` from the guest. Keep `{{NODE}}` `{{CLI}}` `{{CWD_HINT}}`.

Do not claim the guest gained `fetch` or a `web` root. `README.md:45` stays true.

---

### 5.19 NEW tests (never launch a browser)

Pattern: `node:test` + `node:assert/strict`; fixtures under `mkdtempSync(path.join(tmpdir(), ...))`; `fork()` ready/go for cross-process (`test/write-hardening.test.js:4-7, 43-57`). Inject `fetchImpl` / `session.run` / `nowMs` / `cacheDir`. Timing is not an oracle. `scripts/run-tests.mjs` enumerates `test/*.test.js` — no runner edit.

| File | Covers |
| --- | --- |
| `test/browse-cache.test.js` | key identity, TTL with injected nowMs, corrupt/expired, two-process fork, lock timeout, no-token grep |
| `test/browse-search.test.js` | searchMany branches in §7.1 |
| `test/browse-media.test.js` | downloadMedia branches in §7.2 |
| `test/browse-watch.test.js` | watch branches in §7.4 |
| `test/browse-recipes.test.js` | recipes branches in §7.5 |
| `test/browse-prefetch.test.js` | prefetch branches in §7.6 — write this file last |
| `test/fixtures/browse-search/ddg-two-hits.html` | two `result__a` + one ad y.js |
| `test/fixtures/browse-search/ddg-dated.html` | timestamp + snippet |
| `test/fixtures/browse-media/itunes-screens.json` | `screenshotUrls` array |
| `test/fixtures/browse-media/play-shots.html` | play-lh URLs + og:image |
| `test/fixtures/browse-media/x-og.html` | og:image |
| `test/fixtures/browse-media/x-none.html` | no og tag |

Shared fake fetch:

```js
function fakeFetch(map) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), signal: init.signal });
    const hit = map.get(String(url)) || [...map.entries()].find(([k]) => String(url).startsWith(k));
    const rec = hit ? (hit[1] ?? hit) : { status: 404, body: '' };
    if (rec.throw) throw rec.throw;
    return {
      ok: (rec.status ?? 200) >= 200 && (rec.status ?? 200) < 300,
      status: rec.status ?? 200,
      url: rec.url || String(url),
      headers: { get: (n) => rec.headers?.[n.toLowerCase()] || rec.contentType || 'text/html' },
      text: async () => rec.body || '',
      arrayBuffer: async () => rec.buf || Buffer.from(rec.body || ''),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
```

Cross-process cache child (ready/go, no sleep):

```js
import { fork } from 'node:child_process';
// child.mjs: import createBrowseCache, process.send('ready'), on 'go' get+set, process.send(result)
```

PNG fixture for media dimension tests: 1×1 PNG (89 50 4E 47 … IHDR 1×1) already used conceptually in 030; a 32-byte-minimum buffer that `readPngIhdr` accepts. JPEG tests can skip encode and assert `format:'bin'` when bytes are not PNG/JPEG, or pass a truncated JPEG to assert per-file `ok:false` without failing the batch.

---

## 6. Dependency order of edits inside wp6

Prefetch is last on purpose. Do not reorder 1–6 vs 10.

1. `src/host/browse/cache.js` + `test/browse-cache.test.js` (key, TTL, fork, lock). Gate for everything else.
2. `src/config.js` + example json + `test/config.test.js` so `browseCaps.cacheTtlMs` is not silently dropped.
3. `src/host/browse/search-web.js` + DDG fixtures + `test/browse-search.test.js`.
4. `src/host/browse/media.js` + media fixtures + `test/browse-media.test.js`.
5. `src/host/browse/watch.js` + `test/browse-watch.test.js` (needs cache + readText/extract fakes).
6. `src/host/browse/recipes.js` + `test/browse-recipes.test.js` (needs searchMany + api + session fake + `runGuardedBatch`).
7. MODIFY `schema.js` / `probe.js` catalogs.
8. MODIFY `browse.js` cache wrap + method wiring.
9. MODIFY globals / sandbox ROOTS / execution-worker freeze / actions / tools / README / AGENTS.
10. `src/host/browse/prefetch.js` + `test/browse-prefetch.test.js` — **only after step 1's two-process tests are green**.
11. Wiring test: `runCode('return [typeof browse.searchMany, typeof recipes.run, typeof browse.prefetch]')` with fake session/fetch.

Do not spawn Aside. Do not add npm dependencies. Do not land prefetch.js before the cache fork test.

---

## 7. Testable acceptance criteria (every conditional path)

For each row: ACTIVATION SCENARIO = how a unit test triggers it; OBSERVABLE = what proves that branch ran. No elapsed-time oracles.

### 7.1 `browse.searchMany` (#19) — `test/browse-search.test.js`

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| Q1 | empty / non-array | `searchMany()` / `null` / `[]` | throws `BrowseOptionError` `EBADVAL` |
| Q2 | over cap | 17 queries | `EBADVAL` matching `at most 16` |
| Q3 | missing q | `[{}]` | `EBADVAL`, **zero** fetch calls |
| Q4 | parallel fetch | two queries, fetchImpl records call order without waiting | both URLs requested; envelope `items.length===2` |
| Q5 | DDG parse | fixture `ddg-two-hits.html` | two results with unwrapped `uddg` URLs, titles, snippets |
| Q6 | skip ads | fixture contains `duckduckgo.com/y.js` | that href absent from `results` |
| Q7 | dedupe on | query A then B share a URL | URL present only on A; B.deduped >= 1 |
| Q8 | dedupe off | same, `dedupe:false` | URL present on both |
| Q9 | max | 3 hits, `max:1` | `results.length===1`, `deduped===2` |
| Q10 | within parse | `within:'14d'` with `nowMs: () => Date.parse('2026-09-14T00:00:00Z')` | fetch URL contains `after:2026-08-31` and `df=m` |
| Q11 | within host filter | results dated 2026-08-01 and 2026-09-10, `within:'14d'` at that nowMs | only 2026-09-10 kept; null publishedAt **kept** |
| Q12 | bad within | `within:'fortnight'` | `EBADVAL` before fetch |
| Q13 | HTTP fail | fetch status 403 | item `ok:false` `EHTTP`, sibling query still present |
| Q14 | fetch throw | fetchImpl rejects | item `ok:false`, batch does not throw |
| Q15 | abort | aborted AbortSignal | item `ECANCELLED` |
| Q16 | no results | empty HTML | item `ENONE` |
| Q17 | engine google, unproven | `engine:'google'` without googleSearchImpl | throws `ENOTSUP`, message names `googleSearch` and `001 E2`, **zero** fetch to google.com |
| Q18 | engine google, injected | `googleSearchImpl` returns two hits | those hits in `items[0].results`, `engine:'google'`, DDG fetch count **0** |
| Q19 | engine bad | `engine:'bing'` | `EBADVAL` |
| Q20 | probe source | `compileGoogleSearchProbeScript()` | contains `typeof googleSearch`; contains `typeof googleSearch[n]` or `typeof googleSearch[n]` loop; does **not** contain `getPrototypeOf` or `getOwnPropertyNames`; does **not** call `.search(` |
| Q21 | googleMethodFromProbe | methods `{search:'function', query:'undefined'}` | returns `'search'`; all undefined returns `null` |
| Q22 | cache hit | second `searchMany` same q+within on same cache | fetch call count stays 1; `cached:true` |
| Q23 | cache key locale | same q, identity.locale `'ko'` vs `'en'` | two fetches |
| Q24 | hosts | spy URLs | only `html.duckduckgo.com`; never `google.com/search` |
| Q25 | string query | `searchMany(['foo'])` | treated as `{q:'foo'}` |

### 7.2 `browse.downloadMedia` (#13) — `test/browse-media.test.js`

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| M1 | unknown kind | `'foo'` | `EBADKIND`, lists `MEDIA_KINDS` |
| M2 | missing outDir | `{}` | `EBADVAL` before fetch |
| M3 | outDir outside roots | `assertInside` throws | no write, no fetch |
| M4 | appstore success | iTunes JSON fixture with 2 screenshotUrls; image bytes PNG | `files.length===2`, IHDR width/height set, paths under outDir |
| M5 | appstore empty | `results:[]` | `ENOTFOUND`, files `[]` |
| M6 | appstore missing id | no id | `EBADVAL`, zero fetch |
| M7 | playstore success | play-lh URLs in HTML | those URLs fetched; files written |
| M8 | playstore none | empty HTML | `ENONE` |
| M9 | youtube maxres | first thumb 200 | one file, `maxresdefault` in url; sd/hq **not** fetched |
| M10 | youtube fallback | maxres 404, hq 200 | one file from hqdefault; sd may be attempted per names order — observable: maxres then next name, stop on first 200 |
| M11 | youtube none | all 404 | `ENOTFOUND` |
| M12 | youtube missing id | no videoId | `EBADVAL` |
| M13 | x og:image | x-og.html | one file from that URL |
| M14 | x no image | x-none.html | `ENONE`, error mentions `do not screenshot` |
| M15 | x HTTP fail | 403 | `EHTTP`, no screenshot path on the item |
| M16 | per-file HTTP fail | 2 URLs, second 404 | `files[1].ok===false`, `files[0].ok===true`, kind `ok:true` (some files) |
| M17 | abort | aborted signal | `ECANCELLED` |
| M18 | no screenshot | grep `src/host/browse/media.js` | no `page.screenshot`, no `screenshot(` |
| M19 | hosts | spy | only itunes.apple.com, play.google.com, i.ytimg.com, and the X URL under test |

### 7.3 file cache (#15) — `test/browse-cache.test.js`

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| C1 | miss | empty dir, `get` | `hit:false` |
| C2 | set/get | `set` then `get` same fields | `hit:true`, value deep-equal |
| C3 | key account | same id, account `'a'` vs `'b'` | second is miss |
| C4 | key profile | profile `'p1'` vs `'p2'` | miss |
| C5 | key auth | `'none'` vs `'aside-repl'` | miss |
| C6 | key locale | `'ko'` vs `'en'` | miss |
| C7 | key viewport | `'1440x900'` vs `'800x600'` | miss (even though E4 cannot set viewport, the key still distinguishes) |
| C8 | key schemaVersion | `extract/1` vs `extract/2` | miss |
| C9 | key kind | `readText` vs `search` | miss |
| C10 | canonical URL | `http://WWW.Example.com/x/?utm_source=a#h` vs `http://example.com/x` | same digest |
| C11 | TTL miss | `nowMs` returns fetchedAt+ttlMs+1 | `hit:false`, `reason:'expired'`, file unlinked |
| C12 | TTL hit | nowMs returns fetchedAt+ttlMs-1 | `hit:true` |
| C13 | ttl 0 | `ttlMs:0`, set then get at same nowMs | miss (0 is always-miss, not infinite) |
| C14 | corrupt JSON | write `not-json` to the target | `hit:false`, `reason:'corrupt'` |
| C15 | missing kind/id | `cacheKey({})` | throws `EBADVAL` |
| C16 | two-process | `fork()` ready/go: child A `set`, child B `get` same dir+fields | B reports `hit:true` with A's value. Barrier is IPC, not sleep (`test/write-hardening.test.js:43-57`) |
| C17 | two-process different account | same as C16 but B uses another account | B miss |
| C18 | lock timeout | hold the lock file with `wx` in parent, child `set` with `lockTimeoutMs: 20` | child throws `ELOCKED` / `LockTimeoutError`; parent lock **not** stolen (file-lock.js:8-10) |
| C19 | no secrets | `set` a value, grep the json | no keys named token/cookie/authorization |
| C20 | default dir | `defaultCacheDir()` | equals `path.join(os.tmpdir(), 'codemode-browse-cache')` |
| C21 | captureMany wrap | fake rawCaptureMany increments a counter; two `cachedCaptureMany` same URL | counter === 1; second item `cached:true` |
| C22 | readText wrap | same for `cachedReadText` | fetch/raw count === 1 |
| C23 | wrap cache:false | `cache:false` on second call | raw count === 2 |

### 7.4 `browse.watch` (#7) — `test/browse-watch.test.js`

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| W1 | first seen | readText returns `'hello'`, empty store | `changed:true`, `prevAt:null`, `addedText` contains hello, no `removedText` rows from a previous body |
| W2 | unchanged | second watch, same text | `changed:false`; keys `diff`, `addedText`, `removedText`, `screenshotPath` **absent** |
| W3 | changed | store has `'a\nb'`, new text `'a\nc'` | `changed:true`, `removedText` includes `b`, `addedText` includes `c` |
| W4 | selector | extract fake returns field body `'X'` | extract called with that css; readText **not** called |
| W5 | bad url | `ftp://x` | item `EBADVAL`, not thrown batch |
| W6 | empty list | `[]` | throws `EBADVAL` |
| W7 | store outside roots | `store:'C:\\Windows\\x.json'` and assertInside throws | no write |
| W8 | default store | omit store | writes under `cache.dir/watch-store.json` |
| W9 | two-process store | fork ready/go both watch same URL first time | both see a store file; second process's second call in-process still uses hashes — at least one write survived (lock) |
| W10 | hash stable | `normalizeWatchText('  a \r\n\r\n b  ')` vs `'a\n\nb'` | same `hashTree` |
| W11 | cap | 40k text | stored length `WATCH_TEXT_MAX` |
| W12 | no screenshot | grep watch.js | no `page.screenshot` |

### 7.5 `recipes.run` (#9) — `test/browse-recipes.test.js`

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| R1 | list | `recipes.list()` | includes the three built-ins |
| R2 | describe unknown | `'nope'` | `ENOTFOUND`, message lists known |
| R3 | check missing | `playstore.whatsnew` without id | `ok:false`, `missing:['id']` |
| R4 | check unknown arg | extra `foo` | `unknown:['foo']` |
| R5 | run invalid args | same as R3 via `run` | throws `EBADVAL`, **zero** session.run |
| R6 | appstore.app fetch | api.batch fake itunes success | `engine:'fetch'`, `session.run` **not** called, data from itunes |
| R7 | youtube.shorts.search | searchMany fake | query contains `site:youtube.com/shorts`; no spawn |
| R8 | playstore compile | capture `compileRecipeScript` | contains `openTab`, `waitForSelector`, `page.click`, `page.evaluate`, `finally`, `closeTab`; does **not** contain `page.route`, `networkidle`, `format:'A4'`, `getPrototypeOf` |
| R9 | playstore success | fake session stdout with extract | `ok:true`, `data` typed via applyExtractSchema |
| R10 | required selector fail | item `failedStep:{action:'waitForSelector',selector:'[itemprop=description]'}` | `ok:false`, that failedStep returned; **no retry** (runItem called once) |
| R11 | optional click fail | click throws inside script but optional:true — fake extract still arrives | `ok:true` (compiler swallows optional) |
| R12 | guarded batch | domain circuit already open | item skipped `circuit-open`; session.run not called |
| R13 | user json recipe | recipesDir with `foo.json` | `list` includes `foo` |
| R14 | user js recipe | recipesDir with `foo.js` | `ENOTSUP` mentioning eval / JSON, before spawn |
| R15 | abort | aborted signal during browser recipe | `ECANCELLED` via runGuardedBatch |
| R16 | no LLM | grep recipes.js | no `openai`, no `complete`, no `prompt` |

### 7.6 `browse.prefetch` (#16) — `test/browse-prefetch.test.js` (last)

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| P1 | empty | `[]` | `EBADVAL` |
| P2 | miss write | readText fake returns markdown | `warmed[0].cache==='write'`; subsequent cache.get is hit |
| P3 | hit skip | prefetch twice, same urls, no force | second `skipped[0].cache==='hit'`; raw readText count === 1 |
| P4 | force | second with `force:true` | raw count === 2; warmed not skipped |
| P5 | bad url | `ftp://x` | failed `EBADVAL` |
| P6 | readText error | raw returns `{error:{code:'EHTTP'}}` | failed, not written |
| P7 | mode capture | captureMany fake | kind `'capture'` in cache key (different from readText key — a later readText still misses) |
| P8 | bad mode | `mode:'pdf'` | `EBADVAL` |
| P9 | no cache | createPrefetch without cache | `ENOTSUP` |
| P10 | inner cache:false | spy raw readText opts | `cache===false` so wrap does not recurse |
| P11 | mixed | one hit, one miss, one fail | warmed+skipped+failed lengths sum to n; `complete:false` |

### 7.7 wiring

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| G1 | guest names | `runCode('return [typeof browse.searchMany, typeof browse.downloadMedia, typeof browse.watch, typeof browse.prefetch, typeof recipes.run]', { globals: createHostGlobals(...) })` with fakes | all `'function'` |
| G2 | no web/media roots | `typeof web`, `typeof media` | `'undefined'` |
| G3 | one-level | `typeof browse.recipes` | `undefined` |
| G4 | no fetch in guest | existing sandbox test still `typeof fetch === 'undefined'` | unchanged |
| G5 | actions catalog | `actions.find('searchMany')[0].path` | `browse.searchMany` |
| G6 | recipes catalog | `actions.list('recipes')` | four paths |
| G7 | doctor | probe matrix includes `searchMany.defaultEngine==='fetch'` and `cache.securityBoundary===false` | unit-test probe export; live Aside not required |
| G8 | envelope | searchMany return has enumerable `items`, `complete`, `partial`; no `toJSON` | `JSON.stringify` keeps items; `typeof return.toJSON === 'undefined'` |

---

## 8. Verifiers

| Command | Exit | Observes this phase's change? |
| --- | --- | --- |
| `node --test test/browse-cache.test.js test/browse-search.test.js test/browse-media.test.js test/browse-watch.test.js test/browse-recipes.test.js test/browse-prefetch.test.js` | 0 | **yes** — direct. Prefetch file is last; running it before cache is green is an implementer error, not a verifier skip. |
| `npm test` | 0 (hosted CI is authoritative if `search-boundary` still races locally; 000) | **yes** — `scripts/run-tests.mjs` enumerates `test/*.test.js` |
| `node --test test/config.test.js` | 0 | **yes** — `browseCaps.cacheTtlMs` / account env copy |
| `node --test test/actions.test.js` | 0 | **yes** — catalog floor; wp6 tests assert new paths |
| `rg -n "getPrototypeOf\|getOwnPropertyNames" src/host/browse/search-web.js` | no matches | **yes** — E2 |
| `rg -n "page.screenshot\|page.route" src/host/browse/media.js src/host/browse/recipes.js src/host/browse/watch.js src/host/browse/prefetch.js` | no matches | **yes** |
| `rg -n "web\.searchMany\|guest root `web`" src/host src/sandbox.js src/execution-worker.js` | no `web` root registration | **yes** — rename is intentional |
| Live `aside.exe repl` googleSearch typeof probe | n/a | **no** — not in CI. Human-review under `CODEMODE_BROWSE_LIVE=1`. A proven callable is written to the probe cache file; until then engine google stays ENOTSUP. |
| `gh run list --repo lidge-jun/aside-codemode` | 0 after push | **yes** for "CI still green", **not** for DDG HTML (fixtures observe that) |

If a verifier does not read the new files, the row is human-review. Do not claim `npm test` observed two-process TTL unless `test/browse-cache.test.js` ran in that invocation (it will, via enumeration).

Success of a live Aside search is **not** `exit code 0` (E1). A live probe is successful only with a trailing `[ok | Nms]` **and** a JSON body that names a method with `typeof === 'function'`.

---

## 9. Risks — what would prove this design wrong

| Claim | Falsifier | Response |
| --- | --- | --- |
| DDG HTML is a stable fetch-first SERP | DDG returns a captcha / empty / changed class names | item `ENONE`/`EPARSE`; do **not** silently scrape Google; amend parser with a new fixture |
| `googleSearch.search` will appear | live probe records a function | write the probe file; `engine:'google'` becomes legal with that method name. Do not guess signatures beyond the injected impl |
| Prototype really is empty forever | Aside ships enumerable methods | still use `typeof obj.method` (E2); adding names to `GOOGLE_SEARCH_METHODS` is the amend |
| tmpdir cache is shared enough for #15 | Windows users have per-user temp and parallel agents already share it; if they do not, two-process test still passes on one temp | document `browseCaps.cacheDir` as the override; do not write under `~/.aside` |
| file-lock serializes cache writes | a lost update in the fork test | that is a product bug; do not fall back to in-memory Map (that is the defect file-lock.js:4-7 exists to prevent) |
| lock is a security boundary | another local user reads cache JSON | expected. Tests grep for tokens. Not a sandbox |
| watch store in tmpdir survives daily | OS clears temp | optional `opts.store` inside roots is the durable path; default tmp is the no-config path |
| `appstore.app` needs a browser | iTunes lookup lacks notes | still fetch-first; Play "what's new" is the browser recipe. Do not spawn for iTunes |
| Play expander selector is stable | click misses, extract still has description | optional click + failedStep on required wait. Amend selector in BUILTIN_RECIPES, not an LLM repair loop |
| prefetch without a scheduler is enough for #16 | user wanted cron | out of scope; guest/agent or OS task calls `browse.prefetch`. Do not add a daemon |
| wrapping captureMany breaks wp4 envelopes | cached hit drops `partial` / leakedUrls | all-hit envelope still has enumerable `items`+`complete`; mixed hit/miss merges raw envelope metadata from the miss spawn |
| `web.searchMany` name is load-bearing for agents | callers write `web.searchMany` and get unknown host action | GUEST_API_DOC + README + actions.didYouMean should mention `browse.searchMany`. Do not add a `web` root |
| date filter needs publishedAt | DDG has no timestamps | query modifier `after:`+`df=` still applied; null dates kept. Falsified only if we drop null dates |
| 1×1 PNG is enough for #13 | caller needed raster quality proof | original bytes + IHDR is the close; we refused resize in 030 |

This design is wrong if:

- `browse.searchMany({engine:'google'})` spawns Google SERP tabs without a proven callable,
- a cache hit from account A is served to account B,
- `browse.downloadMedia` compiles or calls `page.screenshot`,
- `recipes.run` retries a failed selector via a second LLM-shaped loop or bypasses `runGuardedBatch`,
- prefetch writes into a cache whose key/TTL tests are red,
- two forked processes with the same key miss after one `set` (000 close condition).
