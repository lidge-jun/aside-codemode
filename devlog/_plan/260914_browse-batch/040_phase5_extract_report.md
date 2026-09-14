# 040 — wp5 extraction and reports (closes #18, #10, #14, #11 wait-half, #22)

Unit: `devlog/_plan/260914_browse-batch/`. Work-phase wp5 of [000_plan.md](000_plan.md).
Binding evidence: [001_probe_evidence.md](001_probe_evidence.md). Binding seams: [002_design_inputs.md](002_design_inputs.md).
wp2 contract this phase extends: [010_phase2_foundations.md](010_phase2_foundations.md).

This document is the implementer's only spec for wp5. Re-verify line numbers at wp5 P (wp2–wp4 will have moved them). Do not invent extra npm dependencies, a second browser engine, `page.route`, or `pdf({format:'A4'})`.

## 1. Purpose and issues closed

Ship the extraction / API / wait / report layer on top of the wp2 session contract so a guest can pull structured values and assemble an A4 PDF without dumping accessibility trees or claiming a PDF that is the wrong page box.

| Issue | Closed by | Independently verifiable |
| --- | --- | --- |
| #18 | `api.batch` in `adapters.js` | one call fans out YouTube oEmbed + iTunes lookup + Play HTML parse; Slack item is `EAUTH` without a fetch |
| #10 | `browse.extract(url, schema)` | return is schema-typed JSON; `tree` / `snapshot` keys are absent |
| #14 | host snapshot cache + compact | second call in the same `execute_code` omits `tree` and returns a short `diff`; compact roles shrink the tree |
| #11 | wait-strategy half only | compiled script waits on a named selector / `domcontentloaded`; `block:` throws `ENOTSUP` before spawn |
| #22 | `report.build` + `pagebox.js` | A4 request whose MediaBox is `0 0 612 792` fails the item even if the file exists |

Criterion from the goalplan: `report.build` fails an item whose MediaBox is not the requested box.

## 2. Scope

### IN

- NEW `src/host/browse/adapters.js` — `createApi({ fetchImpl, signal, timeoutMs, maxBatch }).batch(requests)`.
- NEW `src/host/browse/extract.js` — schema validate, type parsers, extract/snapshot/open script compilers.
- MODIFY `src/host/browse/policy.js` (created wp3) — add `resolveWait` / `compileWaitSnippet`; refuse `block`.
- MODIFY `src/host/browse/schema.js` (created wp2) — extract/snapshot/open/batch/report option SSOT, fill `REPORT_ACTIONS` / `API_ACTIONS`.
- MODIFY `src/host/browse/script.js` (created wp2) — insert wait after `openTab`; never emit `networkidle` by default; never emit `page.route` / `pdf({format`.
- MODIFY `src/host/browse/browse.js` (created wp2) — add `extract`, `snapshot`, `open` on the frozen one-level object.
- MODIFY `src/host/report/report.js` (empty factory in wp2) — `build`.
- NEW `src/host/report/html.js`, `pdf.js`, `pagebox.js`.
- Guest root `api` (one-level `hostMethods` cannot register `browse.api.batch`; issue #18's snippet is `api.batch`).
- Config: `browseCaps.waitForByHost`, `browseCaps.snapshotMaxChars`, `apiCaps`, `reportCaps`.
- SoT: `GUEST_API_DOC`, `BROWSE_ACTIONS`/`API_ACTIONS`/`REPORT_ACTIONS`, README / README.ko Guest API rows, `templates/AGENTS.codemode.md`.
- Tests under `test/browse-extract.test.js`, `test/api-batch.test.js`, `test/browse-wait.test.js`, `test/report-build.test.js`. Never launch Aside or a browser.

### OUT

- Resource blocking / `page.route` / `p.on('request')` (measured E3). **Refused, not faked.** Written record in §3.
- Slack `conversations.history` (token required). Kind is accepted so the batch does not throw; the item is `EAUTH`. No token parameter.
- YouTube Data API v3 (API key). Public oEmbed only.
- Google Play Developer API (OAuth). Public details HTML only.
- System Chrome / `chrome:` option on `report.build` (`ENOTSUP`). Engine is Aside REPL (000 / 010).
- `file://` navigation (issue #22: Aside cannot open it). `page.setContent` (E3 absent).
- `pdf({format:'A4'})` (E4: US Letter). Always `paperWidth`/`paperHeight` in inches.
- File-backed TTL cache (`cache.js`, #15) — wp6. This phase's snapshot cache is **in-memory, per `execute_code`**.
- `browse.captureMany` / `web.readText` / recipes / watch / searchMany (wp4 / wp6).
- New npm dependencies. Live network in `npm test`. Timing as a correctness oracle.
- Joining the search `toJSON` RPC lane (`src/sandbox.js:110-112`).

## 3. Written record — #11 resource-blocking half is refused

Issue #11 asked for `browse.open(url, { block: ["image","font","media","ads"], waitFor, timeoutMs })` via Playwright `page.route`.

Measured (`001` E3, probe `cap-probe2.js:8-10`):

- `typeof p.route` is `undefined` (`pageAbsent` includes `route` / `unroute`).
- `p.on('request', fn)` is accepted and delivered **0** events across a full `goto`.

Therefore this phase implements **only** the wait-strategy half. Passing `block`, `blockResources`, or `route` throws `BrowseOptionError` with code `ENOTSUP` **before** `resolveAside` / spawn, using the wp2 string already reserved in `schema.js` `UNSUPPORTED.route` (010 §3.1). Do not intercept `window.fetch` as a substitute (that is not resource blocking and would silently change page behaviour). Closing #11 must quote this section plus the test `block option throws ENOTSUP before spawn`.

Wait-strategy half (implemented):

- Default wait is `waitForLoadState('domcontentloaded')`, **never** `networkidle`.
- `waitFor: { selector }` or a CSS-string waitFor uses `page.waitForSelector` (measured present, `cap-probe2.js:23`).
- `waitFor: 'networkidle'` is an explicit opt-in that emits `waitForLoadState('networkidle')`; it is not the default.
- `waitFor: 'text'` maps to `domcontentloaded` then `waitForSelector('body')`. `waitForFunction` is absent (E3).
- Per-host defaults live in `browseCaps.waitForByHost` (issue example: `play.google.com: { waitFor: "[itemprop=description]" }`).

## 4. Assumed contracts from wp2–wp4 (amend at wp5 P if names drifted)

From 010, this phase **calls** and does not reimplement:

- `createBrowseSession({ config, env, signal, spawnImpl, execFileImpl }).run({ job, source, workDir, deadlines })` — custom `source` skips `compileBrowseScript` (010 §3.5). Success = trailing `[ok | Nms]` AND claimed files. `scriptDeadlineMs < hostWaitMs`. Kill sets `killed` + `leakedUrls`.
- `computeDeadlines`, `BrowseOptionError`, `A4_INCHES`, `UNSUPPORTED.route`, `ASIDE_REPL_CAP_MS` 120000, argv budget 24000 bytes (`E2BIG`).
- `buildBrowseEnvelope` / `applyArtifactInspection` — enumerable object, no `toJSON`, failures in `items[]` (`src/sandbox.js:110-112` search lane stays search-only).
- `createBrowse` returns a frozen one-level object (wp2: `probe` + `exec`/`run`). wp5 adds methods to that factory.
- `src/host/report/report.js` is an empty frozen factory in wp2 so `report` can be injected; wp5 replaces it with `{ build }`.
- wp3 `policy.js` owns breaker + block-detect. wp5 only **adds** wait exports; if the file is missing at wp5 P, stop and amend — do not create a second wait module.
- wp4 may already call `compileBrowseScript`. The wait insertion in §5.6 must apply to that compiler so `captureMany` inherits selector waits.

`hostMethods` walks **one** level (`src/sandbox.js:9-20`). Nested `browse.api.batch` can never register. Guest names in this phase: `browse.extract`, `browse.snapshot`, `browse.open`, `api.batch`, `report.build`.

## 5. File change map

No DELETE. Quote below for files that exist at HEAD now; files created in wp2–wp4 are MODIFY with the exact after-state of the wp5 addition.

### 5.1 NEW `src/host/browse/adapters.js`

Host-only `fetch` (Node >=18). Guest still has no `fetch` (`test/sandbox.test.js:28-31`, `src/tools.js:10`). Inject `fetchImpl` so tests never touch the network.

```js
// src/host/browse/adapters.js
import { BrowseOptionError } from './schema.js';

export const API_KINDS = Object.freeze(['youtube.metadata', 'itunes.lookup', 'playstore.details', 'slack.history']);
export const SLACK_UNAVAILABLE =
  'slack.history requires a Slack token (conversations.history). There is no public unauthenticated history endpoint. Out of scope: no token parameter is accepted.';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BATCH = 32;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function validateBatch(requests, { maxBatch = DEFAULT_MAX_BATCH } = {}) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new BrowseOptionError('api.batch: requests must be a non-empty array', 'EBADVAL');
  }
  if (requests.length > maxBatch) {
    throw new BrowseOptionError('api.batch: at most ' + maxBatch + ' requests (got ' + requests.length + ')', 'EBADVAL');
  }
  for (let i = 0; i < requests.length; i++) {
    const r = requests[i];
    if (r === null || typeOf(r) !== 'object') {
      throw new BrowseOptionError('api.batch[' + i + '] must be an object', 'EBADVAL');
    }
    if (typeof r.kind !== 'string') {
      throw new BrowseOptionError('api.batch[' + i + '].kind must be a string', 'EBADVAL');
    }
  }
  return requests;
}

async function getJson(fetchImpl, url, { signal, timeoutMs }) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('api timeout')), timeoutMs);
  const onAbort = () => ac.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetchImpl(url, { signal: ac.signal, headers: { accept: 'application/json, text/html;q=0.8' } });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, url };
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function parseYoutubeOembed(text, id) {
  let j;
  try { j = JSON.parse(text); } catch {
    return { ok: false, code: 'EPARSE', error: 'youtube oembed is not JSON', id };
  }
  return {
    ok: true, id,
    title: j.title ?? null,
    author: j.author_name ?? null,
    authorUrl: j.author_url ?? null,
    thumbnail: j.thumbnail_url ?? null,
    width: j.width ?? null,
    height: j.height ?? null,
    provider: j.provider_name ?? null,
  };
}

export function parseItunesLookup(text, id) {
  let j;
  try { j = JSON.parse(text); } catch {
    return { ok: false, code: 'EPARSE', error: 'itunes lookup is not JSON', id };
  }
  const row = Array.isArray(j.results) ? j.results[0] : null;
  if (!row) return { ok: false, code: 'ENOTFOUND', error: 'itunes lookup returned no results', id };
  return {
    ok: true, id: row.trackId ?? id,
    name: row.trackName ?? row.collectionName ?? null,
    artist: row.artistName ?? null,
    bundleId: row.bundleId ?? null,
    version: row.version ?? null,
    price: row.price ?? null,
    formattedPrice: row.formattedPrice ?? null,
    rating: row.averageUserRating ?? null,
    url: row.trackViewUrl ?? row.collectionViewUrl ?? null,
  };
}

export function parsePlayDetails(html, id) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { blocks.push(JSON.parse(m[1])); } catch {}
  }
  const flat = blocks.flatMap((b) => (Array.isArray(b) ? b : [b]));
  const app = flat.find((b) => b && (b['@type'] === 'SoftwareApplication' || b['@type'] === 'MobileApplication')) || {};
  const meta = (prop) => {
    const r = new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + prop + '["\'][^>]+content=["\']([^"\']+)', 'i');
    const hit = html.match(r);
    return hit ? hit[1] : null;
  };
  const name = app.name || meta('og:title') || meta('name') || null;
  const description = app.description || meta('og:description') || meta('description') || null;
  const offers = app.offers && typeof app.offers === 'object' ? app.offers : {};
  const rating = app.aggregateRating && typeof app.aggregateRating === 'object' ? app.aggregateRating : {};
  if (!name && !description) {
    return { ok: false, code: 'EPARSE', error: 'play store details HTML had no JSON-LD name/description', id };
  }
  return {
    ok: true, id,
    name, description,
    price: offers.price ?? meta('price') ?? null,
    priceCurrency: offers.priceCurrency ?? null,
    ratingValue: rating.ratingValue ?? null,
    ratingCount: rating.ratingCount ?? null,
    url: 'https://play.google.com/store/apps/details?id=' + encodeURIComponent(id),
  };
}

function youtubeUrl(id) {
  return 'https://www.youtube.com/oembed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&format=json';
}
function itunesUrl(id, country) {
  return 'https://itunes.apple.com/lookup?id=' + encodeURIComponent(id) + '&country=' + encodeURIComponent(country || 'us');
}
function playUrl(id, hl) {
  return 'https://play.google.com/store/apps/details?id=' + encodeURIComponent(id) + '&hl=' + encodeURIComponent(hl || 'en');
}

async function runOne(req, ctx) {
  const { fetchImpl, signal, timeoutMs } = ctx;
  if (signal?.aborted) return { ok: false, kind: req.kind, code: 'ECANCELLED', error: 'api cancelled' };
  if (req.kind === 'slack.history') {
    return { ok: false, kind: req.kind, code: 'EAUTH', error: SLACK_UNAVAILABLE, team: req.team ?? null, channels: req.channels ?? null };
  }
  if (req.kind === 'youtube.metadata') {
    const ids = Array.isArray(req.ids) ? req.ids : (req.id ? [req.id] : []);
    if (!ids.length || ids.some((id) => typeof id !== 'string' || !id)) {
      return { ok: false, kind: req.kind, code: 'EBADVAL', error: 'youtube.metadata requires ids: string[]' };
    }
    const rows = await Promise.all(ids.map(async (id) => {
      const got = await getJson(fetchImpl, youtubeUrl(id), { signal, timeoutMs });
      if (!got.ok) return { ok: false, id, code: 'EHTTP', error: 'youtube oembed HTTP ' + got.status };
      return parseYoutubeOembed(got.text, id);
    }));
    const ok = rows.every((r) => r.ok);
    return { ok, kind: req.kind, data: rows, partial: !ok && rows.some((r) => r.ok) };
  }
  if (req.kind === 'itunes.lookup') {
    if (req.id === undefined || req.id === null || (typeof req.id !== 'number' && typeof req.id !== 'string')) {
      return { ok: false, kind: req.kind, code: 'EBADVAL', error: 'itunes.lookup requires id' };
    }
    const got = await getJson(fetchImpl, itunesUrl(req.id, req.country), { signal, timeoutMs });
    if (!got.ok) return { ok: false, kind: req.kind, code: 'EHTTP', error: 'itunes lookup HTTP ' + got.status, id: req.id };
    return { kind: req.kind, ...parseItunesLookup(got.text, req.id) };
  }
  if (req.kind === 'playstore.details') {
    if (typeof req.id !== 'string' || !req.id) {
      return { ok: false, kind: req.kind, code: 'EBADVAL', error: 'playstore.details requires id (package name)' };
    }
    const got = await getJson(fetchImpl, playUrl(req.id, req.hl), { signal, timeoutMs });
    if (!got.ok) return { ok: false, kind: req.kind, code: 'EHTTP', error: 'play store HTTP ' + got.status, id: req.id };
    return { kind: req.kind, ...parsePlayDetails(got.text, req.id) };
  }
  return { ok: false, kind: req.kind, code: 'EBADKIND', error: 'unknown kind ' + JSON.stringify(req.kind) + '. valid: ' + API_KINDS.join(', ') };
}

export function createApi({ fetchImpl, signal, timeoutMs = DEFAULT_TIMEOUT_MS, maxBatch = DEFAULT_MAX_BATCH } = {}) {
  const fetchFn = fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  if (typeof fetchFn !== 'function') throw new Error('api.batch: fetch is not available');
  return Object.freeze({
    async batch(requests) {
      const list = validateBatch(requests, { maxBatch });
      const items = await Promise.all(list.map((req) => runOne(req, { fetchImpl: fetchFn, signal, timeoutMs }).catch((e) => {
        if (signal?.aborted) return { ok: false, kind: req.kind, code: 'ECANCELLED', error: 'api cancelled' };
        return { ok: false, kind: req.kind, code: e.code ?? 'EHTTP', error: String(e && e.message ? e.message : e) };
      })));
      const failed = items.filter((it) => it.ok !== true).length;
      return {
        items,
        complete: failed === 0,
        truncated: false,
        partial: failed > 0,
        scope: { kinds: list.map((r) => r.kind), timeoutMs, maxBatch },
      };
    },
  });
}
```

Public vs auth (binding):

| kind | Endpoint | Auth | wp5 |
| --- | --- | --- | --- |
| `youtube.metadata` | `GET https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=ID&format=json` | none | IN |
| `itunes.lookup` | `GET https://itunes.apple.com/lookup?id=ID&country=us` | none | IN |
| `playstore.details` | `GET https://play.google.com/store/apps/details?id=PKG&hl=` | none (HTML) | IN, parse JSON-LD / og: tags |
| `slack.history` | Slack `conversations.history` | bot/user token | OUT — item `EAUTH`, zero fetches |
| YouTube Data API v3 | `googleapis.com/youtube/v3` | API key | OUT — do not call |
| Play Developer API | Android Publisher | OAuth | OUT — do not call |

Batch envelope stays a plain object so `fitEnvelope` can trim logs without dropping `items[]` (`002`, `src/execution-output.js:58-68`).
