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
- wp4 ([030](030_phase4_batch.md) §5.8) freezes `{ captureMany, screenshot, readText }`. wp5 **spreads those methods** and adds `extract` / `snapshot` / `open` (and keeps `probe` / `exec` if wp2 left them). Do not replace the factory with an extract-only object.
- wp4 `compileCaptureManyScript` already emits `waitForLoadState("domcontentloaded")` (030 ~L813). wp5 replaces that hardcoded wait with `resolveWait` per URL so `captureMany` inherits selector waits. Do not add a second compiler.
- wp3 `policy.js` already exports breaker helpers. wp5 **appends** `resolveWait` / `compileWaitSnippet` to that same file. Do not create `wait.js`.
- `session.run` signature may be 010's `run({ job, source, ... })` or 030's `run(source, { hostDeadlineMs })`. At wp5 P, call whichever landed. Tests inject the same shape.
- `src/host/report/report.js` is an empty frozen factory in wp2 so `report` can be injected; wp5 replaces it with `{ build }`.
- wp3 `policy.js` owns breaker + block-detect. wp5 only **adds** wait exports; if the file is missing at wp5 P, stop and amend — do not create a second wait module.
- Wait insertion is §5.5 (`compileCaptureManyScript` / `compileBrowseScript`), not a new compiler.

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

### 5.2 NEW `src/host/browse/extract.js`

Owns extract/snapshot/open compilers and the in-execution snapshot cache. Type parsing is host-side so tests cover it without a page.

```js
// src/host/browse/extract.js
import { createHash } from 'node:crypto';
import { BrowseOptionError, computeDeadlines } from './schema.js';
import { resolveWait } from './policy.js';

export const EXTRACT_TYPES = Object.freeze(['string', 'krw', 'usd', 'int', 'date']);
export const DEFAULT_SNAPSHOT_MAX_CHARS = 4096;
export const DEFAULT_COMPACT_ROLES = Object.freeze(['heading', 'button', 'link', 'textbox', 'img']);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function parseTyped(type, raw) {
  if (raw == null) return null;
  const text = Array.isArray(raw) ? null : String(raw).trim();
  if (type === 'string' || type === undefined) return text === '' ? null : (text ?? raw);
  if (type === 'krw' || type === 'int') {
    const digits = String(raw).replace(/[^0-9-]/g, '');
    if (digits === '' || digits === '-') return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'usd') {
    const cleaned = String(raw).replace(/[^0-9.-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'date') {
    const t = Date.parse(String(raw));
    if (!Number.isFinite(t)) return null;
    return new Date(t).toISOString().slice(0, 10);
  }
  throw new BrowseOptionError('extract type ' + JSON.stringify(type) + ' is not one of ' + EXTRACT_TYPES.join(', '), 'EBADVAL');
}

export function validateExtractSchema(schema) {
  if (schema === null || typeOf(schema) !== 'object') {
    throw new BrowseOptionError('browse.extract: schema must be an object of field specs', 'EBADVAL');
  }
  const keys = Object.keys(schema);
  if (keys.length === 0) throw new BrowseOptionError('browse.extract: schema must have at least one field', 'EBADVAL');
  for (const key of keys) {
    const spec = schema[key];
    if (spec === null || typeOf(spec) !== 'object') {
      throw new BrowseOptionError('browse.extract: schema.' + key + ' must be an object', 'EBADVAL');
    }
    if (typeof spec.css !== 'string' || spec.css.length === 0) {
      throw new BrowseOptionError('browse.extract: schema.' + key + '.css is required', 'EBADVAL');
    }
    if (spec.type !== undefined && !EXTRACT_TYPES.includes(spec.type)) {
      throw new BrowseOptionError('browse.extract: schema.' + key + '.type must be one of ' + EXTRACT_TYPES.join(', '), 'EBADVAL');
    }
    if (spec.all !== undefined && typeof spec.all !== 'boolean') {
      throw new BrowseOptionError('browse.extract: schema.' + key + '.all must be boolean', 'EBADVAL');
    }
    if (spec.attr !== undefined && (typeof spec.attr !== 'string' || spec.attr.length === 0)) {
      throw new BrowseOptionError('browse.extract: schema.' + key + '.attr must be a non-empty string', 'EBADVAL');
    }
    if (spec.regex !== undefined) {
      if (typeof spec.regex !== 'string' || spec.regex.length === 0) {
        throw new BrowseOptionError('browse.extract: schema.' + key + '.regex must be a non-empty string', 'EBADVAL');
      }
      try { new RegExp(spec.regex); } catch {
        throw new BrowseOptionError('browse.extract: schema.' + key + '.regex is not a valid RegExp', 'EBADVAL');
      }
    }
  }
  return schema;
}

export function applyExtractSchema(schema, rawByField) {
  const data = {};
  const missing = [];
  const hints = {};
  for (const [key, spec] of Object.entries(schema)) {
    const cell = rawByField && rawByField[key] ? rawByField[key] : { raw: null, hint: null };
    if (cell.hint) hints[key] = String(cell.hint).slice(0, 120);
    if (spec.all === true) {
      const arr = Array.isArray(cell.raw) ? cell.raw : (cell.raw == null ? [] : [cell.raw]);
      data[key] = arr.map((v) => {
        const text = spec.regex ? ((String(v).match(new RegExp(spec.regex)) || [])[1] ?? (String(v).match(new RegExp(spec.regex)) || [])[0] ?? null) : v;
        return parseTyped(spec.type ?? 'string', text);
      });
      if (data[key].length === 0 || data[key].every((v) => v == null)) missing.push(key);
    } else {
      let text = cell.raw;
      if (spec.regex && text != null) {
        const m = String(text).match(new RegExp(spec.regex));
        text = m ? (m[1] ?? m[0]) : null;
      }
      data[key] = parseTyped(spec.type ?? 'string', text);
      if (data[key] == null) missing.push(key);
    }
  }
  return { data, missing, hints };
}

export function compactTree(tree, roles) {
  const want = new Set((roles && roles.length ? roles : DEFAULT_COMPACT_ROLES).map((r) => String(r).toLowerCase()));
  const text = String(tree ?? '');
  const lines = text.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const roleHit = /^\s*-\s*([A-Za-z][\w-]*)/.exec(line) || /^\s*([A-Za-z][\w-]*)\b/.exec(line);
    const role = roleHit ? roleHit[1].toLowerCase() : '';
    const price = want.has('price') && /price|₩|원|¥|€|\$|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/i.test(line);
    if ((role && want.has(role)) || price) kept.push(line);
  }
  return kept.join('\n');
}

export function lineDiff(prev, next) {
  if (prev === next) return '';
  const a = String(prev ?? '').split('\n');
  const b = String(next ?? '').split('\n');
  const aSet = new Set(a);
  const bSet = new Set(b);
  const out = [];
  for (const l of a) if (!bSet.has(l)) out.push('-' + l);
  for (const l of b) if (!aSet.has(l)) out.push('+' + l);
  return out.join('\n');
}

export function hashTree(tree) {
  return createHash('sha256').update(String(tree ?? ''), 'utf8').digest('hex').slice(0, 16);
}

function httpUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new BrowseOptionError('url must be an http(s) string', 'EBADVAL');
  }
  return url;
}

export function compileExtractScript({ url, schema, wait, scriptDeadlineMs }) {
  const payload = { url, schema, wait, scriptDeadlineMs };
  return `(async () => {
  const JOB = ${JSON.stringify(payload)};
  const opened = [];
  const timings = [];
  const record = (step, ms, extra) => timings.push({ step, ms, ...(extra || {}) });
  async function applyWait(page, url) {
    const w = JOB.wait;
    if (!w) return;
    const t0 = Date.now();
    if (w.kind === 'selector') await page.waitForSelector(w.selector, { timeout: w.timeoutMs });
    else if (w.kind === 'loadstate') await page.waitForLoadState(w.state, { timeout: w.timeoutMs });
    record('waitFor', Date.now() - t0, { url });
  }
  const items = [];
  try {
    const work = (async () => {
      const tOpen = Date.now();
      const tab = await openTab(JOB.url);
      opened.push({ id: tab && (tab.id || tab.targetId || tab), url: JOB.url });
      record('openTab', Date.now() - tOpen, { url: JOB.url });
      const page = tab.page || tab;
      await applyWait(page, JOB.url);
      const tEv = Date.now();
      const extract = await page.evaluate((schema) => {
        const nearby = (el) => {
          const n = el && el.parentElement ? el.parentElement : document.body;
          const t = (n && (n.innerText || n.textContent) || '').replace(/\s+/g, ' ').trim();
          return t.slice(0, 120);
        };
        const out = {};
        for (const [key, spec] of Object.entries(schema)) {
          const attr = spec.attr || 'textContent';
          if (spec.all) {
            const nodes = [...document.querySelectorAll(spec.css)];
            out[key] = {
              raw: nodes.map((n) => attr === 'textContent' || attr === 'innerText' ? (n[attr] || n.textContent || '') : (n.getAttribute(attr) || n[attr] || '')),
              hint: nodes.length ? null : nearby(document.querySelector('body')),
            };
          } else {
            const n = document.querySelector(spec.css);
            out[key] = {
              raw: n ? (attr === 'textContent' || attr === 'innerText' ? (n[attr] || n.textContent || '') : (n.getAttribute(attr) || n[attr] || '')) : null,
              hint: n ? null : nearby(document.body),
            };
          }
        }
        return out;
      }, JOB.schema);
      record('evaluate', Date.now() - tEv, { url: JOB.url });
      items.push({ url: JOB.url, ok: true, extract, requested: { schemaKeys: Object.keys(JOB.schema) }, actual: {} });
      console.log(JSON.stringify({ items, timings, leakedUrls: opened.map((o) => o.url), truncated: false, error: null }));
    })();
    await Promise.race([work, sleep(JOB.scriptDeadlineMs).then(() => { const e = new Error('script deadline'); e.code = 'ETIMEOUT'; throw e; })]);
  } catch (e) {
    if (!items.length) items.push({ url: JOB.url, ok: false, error: String(e && e.message ? e.message : e), requested: {}, actual: {} });
    console.log(JSON.stringify({ items, timings, leakedUrls: opened.map((o) => o.url), truncated: false, error: String(e && e.message ? e.message : e), code: e && e.code || null }));
  } finally {
    for (const t of opened) { try { await closeTab(t.id); } catch (_) {} }
  }
})();
`;
}

export function compileSnapshotScript({ url, wait, scriptDeadlineMs }) {
  const payload = { url, wait, scriptDeadlineMs };
  return `(async () => {
  const JOB = ${JSON.stringify(payload)};
  const opened = [];
  const timings = [];
  const record = (step, ms, extra) => timings.push({ step, ms, ...(extra || {}) });
  async function applyWait(page, url) {
    const w = JOB.wait;
    if (!w) return;
    const t0 = Date.now();
    if (w.kind === 'selector') await page.waitForSelector(w.selector, { timeout: w.timeoutMs });
    else if (w.kind === 'loadstate') await page.waitForLoadState(w.state, { timeout: w.timeoutMs });
    record('waitFor', Date.now() - t0, { url });
  }
  const items = [];
  try {
    const work = (async () => {
      const tOpen = Date.now();
      const tab = await openTab(JOB.url);
      opened.push({ id: tab && (tab.id || tab.targetId || tab), url: JOB.url });
      record('openTab', Date.now() - tOpen, { url: JOB.url });
      const page = tab.page || tab;
      await applyWait(page, JOB.url);
      const tS = Date.now();
      const snap = await snapshot(tab, { interactive: true });
      record('snapshot', Date.now() - tS, { url: JOB.url });
      items.push({ url: JOB.url, ok: true, snapshot: snap, requested: {}, actual: {} });
      console.log(JSON.stringify({ items, timings, leakedUrls: opened.map((o) => o.url), truncated: false, error: null }));
    })();
    await Promise.race([work, sleep(JOB.scriptDeadlineMs).then(() => { const e = new Error('script deadline'); e.code = 'ETIMEOUT'; throw e; })]);
  } catch (e) {
    if (!items.length) items.push({ url: JOB.url, ok: false, error: String(e && e.message ? e.message : e), requested: {}, actual: {} });
    console.log(JSON.stringify({ items, timings, leakedUrls: opened.map((o) => o.url), truncated: false, error: String(e && e.message ? e.message : e) }));
  } finally {
    for (const t of opened) { try { await closeTab(t.id); } catch (_) {} }
  }
})();
`;
}

export function compileOpenScript({ url, wait, scriptDeadlineMs }) {
  const payload = { url, wait, scriptDeadlineMs };
  return `(async () => {
  const JOB = ${JSON.stringify(payload)};
  const opened = [];
  const timings = [];
  const record = (step, ms, extra) => timings.push({ step, ms, ...(extra || {}) });
  const items = [];
  try {
    const work = (async () => {
      const tOpen = Date.now();
      const tab = await openTab(JOB.url);
      opened.push({ id: tab && (tab.id || tab.targetId || tab), url: JOB.url });
      record('openTab', Date.now() - tOpen, { url: JOB.url });
      const page = tab.page || tab;
      const w = JOB.wait;
      if (w) {
        const t0 = Date.now();
        if (w.kind === 'selector') await page.waitForSelector(w.selector, { timeout: w.timeoutMs });
        else if (w.kind === 'loadstate') await page.waitForLoadState(w.state, { timeout: w.timeoutMs });
        record('waitFor', Date.now() - t0, { url: JOB.url });
      }
      const title = await page.title();
      items.push({ url: JOB.url, ok: true, title, wait: JOB.wait, requested: { wait: JOB.wait }, actual: {} });
      console.log(JSON.stringify({ items, timings, leakedUrls: opened.map((o) => o.url), truncated: false, error: null }));
    })();
    await Promise.race([work, sleep(JOB.scriptDeadlineMs).then(() => { const e = new Error('script deadline'); e.code = 'ETIMEOUT'; throw e; })]);
  } catch (e) {
    if (!items.length) items.push({ url: JOB.url, ok: false, error: String(e && e.message ? e.message : e), requested: {}, actual: {} });
    console.log(JSON.stringify({ items, timings, leakedUrls: opened.map((o) => o.url), truncated: false, error: String(e && e.message ? e.message : e) }));
  } finally {
    for (const t of opened) { try { await closeTab(t.id); } catch (_) {} }
  }
})();
`;
}

export function createExtractFns({ session, config, signal }) {
  const cache = new Map(); // url -> { tree, refs, hash, diff }
  const maxChars = config?.browseCaps?.snapshotMaxChars ?? DEFAULT_SNAPSHOT_MAX_CHARS;
  const waitForByHost = config?.browseCaps?.waitForByHost ?? {};
  async function runSource(url, source, timeoutMs) {
    const deadlines = computeDeadlines(timeoutMs, config?.browseCaps);
    if (Buffer.byteLength(source) > 24000) {
      throw new BrowseOptionError('repl script exceeds Windows argv budget', 'E2BIG');
    }
    return session.run({ source, deadlines, job: { urls: [url], timeoutMs } });
  }
  return {
    cache,
    compileExtractScript, compileSnapshotScript, compileOpenScript,
    async extract(url, schema, opts = {}) {
      httpUrl(url);
      validateExtractSchema(schema);
      const wait = resolveWait(url, opts, waitForByHost);
      const source = compileExtractScript({ url, schema, wait, scriptDeadlineMs: computeDeadlines(opts.timeoutMs, config?.browseCaps).scriptDeadlineMs });
      const env = await runSource(url, source, opts.timeoutMs);
      const item = env.items[0] || {};
      const applied = applyExtractSchema(schema, item.extract || {});
      const out = {
        ok: item.ok !== false && env.killed !== true,
        url,
        data: applied.data,
        missing: applied.missing,
        hints: applied.hints,
        timings: env.timings,
        complete: env.complete,
        partial: env.partial,
        wait,
      };
      if ('tree' in out || 'snapshot' in out) throw new Error('extract envelope must not include a snapshot');
      return out;
    },
    async snapshot(url, opts = {}) {
      const target = typeof url === 'string' ? url : url?.url;
      httpUrl(target);
      if (opts.compact !== undefined && !Array.isArray(opts.compact)) {
        throw new BrowseOptionError('browse.snapshot: compact must be an array of role names', 'EBADVAL');
      }
      const wait = resolveWait(target, opts, waitForByHost);
      const source = compileSnapshotScript({ url: target, wait, scriptDeadlineMs: computeDeadlines(opts.timeoutMs, config?.browseCaps).scriptDeadlineMs });
      const env = await runSource(target, source, opts.timeoutMs);
      const item = env.items[0] || {};
      const snap = item.snapshot && typeof item.snapshot === 'object' ? item.snapshot : { tree: '', refs: null, diff: '' };
      let tree = typeof snap.tree === 'string' ? snap.tree : JSON.stringify(snap.tree ?? '');
      let truncated = false;
      const roles = opts.compact;
      if (Array.isArray(roles) && roles.length) {
        tree = compactTree(tree, roles);
      } else if (tree.length > maxChars) {
        tree = compactTree(tree, DEFAULT_COMPACT_ROLES);
        truncated = true;
      }
      const hash = hashTree(tree);
      const prev = cache.get(target);
      cache.set(target, { tree, refs: snap.refs ?? null, hash, diff: snap.diff ?? '' });
      if (prev) {
        const diff = snap.diff && prev.hash === hash ? snap.diff : lineDiff(prev.tree, tree);
        return { refs: snap.refs ?? null, diff, hash, cached: true, truncated, wait, timings: env.timings };
      }
      return { tree, refs: snap.refs ?? null, diff: snap.diff ?? '', hash, cached: false, truncated, wait, timings: env.timings };
    },
    async open(url, opts = {}) {
      httpUrl(url);
      const wait = resolveWait(url, opts, waitForByHost);
      const source = compileOpenScript({ url, wait, scriptDeadlineMs: computeDeadlines(opts.timeoutMs, config?.browseCaps).scriptDeadlineMs });
      const env = await runSource(url, source, opts.timeoutMs);
      const item = env.items[0] || {};
      return { ok: item.ok !== false, url, title: item.title ?? null, wait, timings: env.timings, complete: env.complete, partial: env.partial };
    },
  };
}
```

Implementer notes:

- `page.evaluate(fn, JOB.schema)` matches the measured function form (`001` E3 / `cap-probe2.js:21`). Do not use `page.textContent` / `getAttribute` / `innerText` (E3 absent).
- Extract compiled source MUST contain `page.evaluate` and MUST NOT contain `snapshot(`. Tests inspect the string.
- Snapshot cache is the `Map` inside `createExtractFns` (one per `createHostGlobals` / `execute_code`). Not `cache.js` (wp6).
- Repeat snapshot omits `tree` (issue #14: "returns only a diff"). First call returns `{tree, refs, diff}` matching Aside (`cap-probe.js:13-14`; repeat native call measured 20-char `diff` vs 289-char `tree`).
- Wait is inlined in each compiler. Do not stringify host `compileWaitSnippet` into the repl source.
- If wp2 `createBrowseSession` is not injected into `createExtractFns`, stop and amend — do not spawn Aside from extract.js.

### 5.3 MODIFY `src/host/browse/policy.js` (wp3 file) — add wait exports

Do not recreate breaker / block-detect. Append:

```js
import { BrowseOptionError, UNSUPPORTED } from './schema.js';

export const RESOURCE_BLOCK_UNSUPPORTED = UNSUPPORTED.route;

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

export function resolveWait(url, opts = {}, waitForByHost = {}) {
  if (opts.block !== undefined || opts.blockResources !== undefined || opts.route !== undefined) {
    throw new BrowseOptionError('browse: ' + RESOURCE_BLOCK_UNSUPPORTED, 'ENOTSUP');
  }
  const timeoutMs = opts.timeoutMs === undefined ? 15000 : opts.timeoutMs;
  if (opts.timeoutMs !== undefined && (!Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs <= 0)) {
    throw new BrowseOptionError('wait timeoutMs must be a positive integer', 'EBADVAL');
  }
  const host = hostOf(url);
  const profile = (waitForByHost && host && waitForByHost[host]) || {};
  const waitFor = opts.waitFor !== undefined ? opts.waitFor : profile.waitFor;
  if (waitFor === undefined || waitFor === null || waitFor === 'domcontentloaded' || waitFor === 'load') {
    return { kind: 'loadstate', state: waitFor === 'load' ? 'load' : 'domcontentloaded', timeoutMs };
  }
  if (waitFor === 'text') {
    return { kind: 'selector', selector: 'body', timeoutMs, via: 'text' };
  }
  if (waitFor === 'networkidle') {
    return { kind: 'loadstate', state: 'networkidle', timeoutMs, explicit: true };
  }
  if (typeof waitFor === 'string' && waitFor.length > 0) {
    return { kind: 'selector', selector: waitFor, timeoutMs };
  }
  if (waitFor && typeof waitFor === 'object' && typeof waitFor.selector === 'string' && waitFor.selector.length > 0) {
    return { kind: 'selector', selector: waitFor.selector, timeoutMs: waitFor.timeoutMs ?? timeoutMs };
  }
  throw new BrowseOptionError('waitFor must be "domcontentloaded"|"load"|"text"|"networkidle"|CSS string|{selector}', 'EBADVAL');
}

export function compileWaitSnippet(wait) {
  if (!wait) return '';
  if (wait.kind === 'selector') {
    return 'await page.waitForSelector(' + JSON.stringify(wait.selector) + ', { timeout: ' + Number(wait.timeoutMs) + ' });';
  }
  return 'await page.waitForLoadState(' + JSON.stringify(wait.state) + ', { timeout: ' + Number(wait.timeoutMs) + ' });';
}
```

Default path never returns `state: 'networkidle'`. `UNSUPPORTED.route` is the single refusal string (010 already lists `blockResources` as ENOTSUP; wp5 also rejects the issue's `block` key).

### 5.4 MODIFY `src/host/browse/schema.js` (wp2)

After wp2 this file exists with `JOB_OPTS`, `UNSUPPORTED.route`, `BROWSE_ACTIONS`, `REPORT_ACTIONS = []`.

**Add to `UNSUPPORTED` / rejected-if-present keys:** `block` (same message/code as `blockResources`).

**Add option bags** (unknown keys rejected, same as search):

```js
export const EXTRACT_OPTS = new Set(['timeoutMs', 'waitFor', 'block', 'blockResources', 'route']);
export const SNAPSHOT_OPTS = new Set(['timeoutMs', 'waitFor', 'compact', 'block', 'blockResources', 'route']);
export const OPEN_OPTS = new Set(['timeoutMs', 'waitFor', 'block', 'blockResources', 'route']);
export const REPORT_OPTS = new Set(['template', 'title', 'date', 'sections', 'out', 'paperWidth', 'paperHeight', 'twoPass', 'chrome', 'timeoutMs']);

export function validateNamedOpts(fn, opts, allowed) {
  if (opts == null) return {};
  if (typeof opts !== 'object' || Array.isArray(opts)) throw new BrowseOptionError(fn + ': options must be an object', 'EBADVAL');
  const bad = Object.keys(opts).filter((k) => !allowed.has(k));
  if (bad.length) {
    throw new BrowseOptionError(fn + ': unknown option(s) ' + bad.map((b) => JSON.stringify(b)).join(', ') + '. valid: ' + [...allowed].join(', '), 'EBADOPT');
  }
  for (const key of ['block', 'blockResources', 'route']) {
    if (key in opts) throw new BrowseOptionError(fn + ': ' + UNSUPPORTED.route, 'ENOTSUP');
  }
  if ('chrome' in opts) {
    throw new BrowseOptionError(fn + ': chrome path is not supported; report.build uses the Aside REPL pdf() path, not system Chrome', 'ENOTSUP');
  }
  if ('format' in opts) throw new BrowseOptionError(fn + ': ' + UNSUPPORTED.format, 'ENOTSUP');
  return opts;
}
```

**Replace** `export const REPORT_ACTIONS = [];` with:

```js
export const API_ACTIONS = [
  {
    path: 'api.batch',
    description: 'Fetch public structured APIs in one parallel call: YouTube oEmbed, iTunes lookup, Play Store details HTML. slack.history returns EAUTH (token required, out of scope).',
    signature: 'api.batch([{kind, ...}]) => Promise<{items,complete,partial,scope}>',
    notes: 'No browser. Injected host fetch. Per-item failures live in items[]. Unknown kinds are EBADKIND items, not a thrown batch. Guest has no fetch.',
    inputs: { requests: { type: 'array', required: true, description: 'Array of {kind: youtube.metadata|itunes.lookup|playstore.details|slack.history, ...}' } },
  },
];

export const REPORT_ACTIONS = [
  {
    path: 'report.build',
    description: 'Build a paged HTML report and print it through Aside pdf() with paperWidth/paperHeight in inches. Fails the item if MediaBox is not the requested box.',
    signature: 'report.build({ template, title, date?, sections, out, paperWidth?, paperHeight?, twoPass? }) => Promise<{ok,pdf,pages,mediaBox,qa,items}>',
    notes: 'format:\'A4\' is ENOTSUP (E4 Letter). chrome: is ENOTSUP. file:// is not used. MediaBox is parsed from the PDF bytes; a file that exists with US Letter when A4 was requested is a failed item.',
    inputs: {
      template: { type: 'string', required: true, description: 'Only \"paged-report\" in wp5' },
      title: { type: 'string', required: true, description: 'Report title' },
      date: { type: 'string', required: false, description: 'ISO date string' },
      sections: { type: 'array', required: true, description: '[{ heading, lead?, figures?: [{ src, caption?, source? }] }]' },
      out: { type: 'string', required: true, description: 'Output PDF path inside configured roots' },
      paperWidth: { type: 'number', required: false, description: 'Inches (default A4_INCHES.paperWidth)' },
      paperHeight: { type: 'number', required: false, description: 'Inches (default A4_INCHES.paperHeight)' },
      twoPass: { type: 'boolean', required: false, description: 'Reprint after measuring page count (default true)' },
    },
  },
];
```

**Append to `BROWSE_ACTIONS`:**

```js
  {
    path: 'browse.extract',
    description: 'Open one URL, wait using the wait strategy, evaluate CSS selectors, return schema-typed JSON. Does not return a snapshot tree.',
    signature: 'browse.extract(url, schema, { waitFor?, timeoutMs? }) => Promise<{ok,url,data,missing,hints,wait}>',
    notes: 'type: krw|usd|int|date|string. Missing fields are null + hints. block is ENOTSUP. Compiled script calls page.evaluate, not snapshot().',
    inputs: {
      url: { type: 'string', required: true, description: 'http(s) URL' },
      schema: { type: 'object', required: true, description: '{ field: { css, type?, attr?, all?, regex? } }' },
      waitFor: { type: 'string', required: false, description: 'selector string or domcontentloaded|text|networkidle' },
      timeoutMs: { type: 'number', required: false, description: 'Caller budget' },
    },
  },
  {
    path: 'browse.snapshot',
    description: 'Accessibility snapshot with in-execution cache and optional compact role filter. A repeat of the same URL omits tree and returns diff only.',
    signature: 'browse.snapshot(url, { compact?, waitFor?, timeoutMs? }) => Promise<{tree?,refs,diff,hash,cached,truncated}>',
    notes: 'Aside snapshot returns {tree, refs, diff}. Compact is host-side. Auto-compact when tree exceeds browseCaps.snapshotMaxChars (truncated:true).',
    inputs: {
      url: { type: 'string', required: true, description: 'http(s) URL' },
      compact: { type: 'array', required: false, description: 'Role names to keep, e.g. [\"heading\",\"button\",\"link\",\"price\"]' },
      waitFor: { type: 'string', required: false, description: 'Wait strategy' },
      timeoutMs: { type: 'number', required: false, description: 'Caller budget' },
    },
  },
  {
    path: 'browse.open',
    description: 'Navigate, apply wait strategy, return title. Always closes the tab. Does not keep a page handle (one repl = one session).',
    signature: 'browse.open(url, { waitFor?, timeoutMs? }) => Promise<{ok,url,title,wait}>',
    notes: 'block is ENOTSUP. Default wait is domcontentloaded, never networkidle.',
    inputs: {
      url: { type: 'string', required: true, description: 'http(s) URL' },
      waitFor: { type: 'string', required: false, description: 'Wait strategy' },
      timeoutMs: { type: 'number', required: false, description: 'Caller budget' },
    },
  },
```

Catalog `waitFor` type is `string` for `actions.check`. Object `{selector}` is still accepted at runtime by `resolveWait`; `actions.check` will report a type error for an object — document that in notes, do not add a union type to the catalog.

### 5.5 MODIFY `src/host/browse/script.js` (wp2) — wait insertion

wp4 already compiled `compileCaptureManyScript` with a hardcoded:

```js
    if (typeof p.waitForLoadState === "function") {
      try { await p.waitForLoadState("domcontentloaded"); } catch {}
    }
```

Replace that block with a per-item wait from `JOB.waits[i]` (host-resolved, JSON-payload). Same replacement in `compileRenderedHtmlScript` and wp2 `compileBrowseScript` if it still exists. After-state of the wait block:

```js
    const w = (JOB.waits && JOB.waits[i]) || JOB.wait;
    if (w) {
      const t1 = Date.now();
      if (w.kind === 'selector') await p.waitForSelector(w.selector, { timeout: w.timeoutMs });
      else if (w.kind === 'loadstate') await p.waitForLoadState(w.state, { timeout: w.timeoutMs });
      record('waitFor', Date.now() - t1, { url: item.url });
    }
```

Host payload addition in `compileCaptureManyScript` / extract compilers:

```js
  waits: items.map((it) => resolveWait(it.url, { waitFor: it.waitFor ?? opts.waitFor, timeoutMs: opts.timeoutMs, block: opts.block, blockResources: opts.blockResources, route: opts.route }, waitForByHost)),
```

If any item/opts carries `block`, throw `ENOTSUP` in `validateCaptureOptions` / `validateNamedOpts` **before** compile (do not emit a wait payload). Invariant: compiled source must not contain `page.route`, `blockResources`, `maxWidth`, or `pdf({format`. Default compiled fixtures must not contain `networkidle`. Tests grep the compiled string.

### 5.6 MODIFY `src/host/browse/browse.js` (wp2)

030 factory is frozen `{ captureMany, screenshot, readText }`. After wp5, keep those and add extract/snapshot/open (and probe/exec if present):

```js
import { createExtractFns } from './extract.js';
import { validateNamedOpts, EXTRACT_OPTS, SNAPSHOT_OPTS, OPEN_OPTS } from './schema.js';

  // inside createBrowse, after captureMany/screenshot/readText exist:
  const x = createExtractFns({ session, config: { browseCaps }, signal });
  return Object.freeze({
    captureMany, screenshot, readText,
    async extract(url, schema, opts = {}) {
      validateNamedOpts('browse.extract', opts, EXTRACT_OPTS);
      return x.extract(url, schema, opts);
    },
    async snapshot(url, opts = {}) {
      const extra = typeof url === 'object' && url && url.url ? { ...url, ...opts } : opts;
      validateNamedOpts('browse.snapshot', extra, SNAPSHOT_OPTS);
      return x.snapshot(typeof url === 'string' ? url : url.url, extra);
    },
    async open(url, opts = {}) {
      validateNamedOpts('browse.open', opts, OPEN_OPTS);
      return x.open(url, opts);
    },
  });
```

Do not drop `captureMany`. Do not add `browse.batch` (that is `api.batch`). Pass the **same** `session` into `createExtractFns` and `createReport`.

### 5.7 NEW `src/host/report/pagebox.js`

In-repo parser. E4: `/MediaBox` is plaintext; object-stream inflate is fallback only (`.codexclaw/probes/pdf-box.mjs:1-20`).

```js
// src/host/report/pagebox.js
import { inflateSync } from 'node:zlib';

export const A4_POINTS = Object.freeze({ w: 595.92, h: 841.92 });
export const LETTER_POINTS = Object.freeze({ w: 612, h: 792 });
export const MEDIA_EPS = 1; // pt; E4 measured 595.91998 vs 210/25.4*72 ≈ 595.28 (delta 0.64). Letter vs A4 is 16pt.

export function parseMediaBoxes(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const s = bytes.toString('latin1');
  const take = (src) => {
    const out = [];
    const re = /\/MediaBox\s*\[([^\]]+)\]/g;
    let m;
    while ((m = re.exec(src))) {
      const nums = m[1].trim().split(/[\s]+/).map(Number);
      if (nums.length === 4 && nums.every(Number.isFinite)) {
        out.push({ x: nums[0], y: nums[1], w: nums[2], h: nums[3], raw: m[1].trim() });
      }
    }
    return out;
  };
  const direct = take(s);
  if (direct.length) return { where: 'plain', boxes: direct };
  const found = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      const txt = inflateSync(bytes.subarray(start, end)).toString('latin1');
      found.push(...take(txt));
    } catch {}
  }
  return { where: 'objstm', boxes: found };
}

export function countPages(buf) {
  const s = Buffer.from(buf).toString('latin1');
  const count = /\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/.exec(s);
  if (count) return Number(count[1]);
  const pages = s.match(/\/Type\s*\/Page(?![s])/g);
  return pages ? pages.length : 0;
}

export function inchesToPoints(paperWidth, paperHeight) {
  return { w: paperWidth * 72, h: paperHeight * 72 };
}

export function matchesRequested(box, requested, eps = MEDIA_EPS) {
  if (!box || !requested) return false;
  return Math.abs(box.w - requested.w) <= eps && Math.abs(box.h - requested.h) <= eps;
}

export function verifyMediaBox(buf, paperWidth, paperHeight) {
  const { where, boxes } = parseMediaBoxes(buf);
  const requested = inchesToPoints(paperWidth, paperHeight);
  if (!boxes.length) {
    return { ok: false, code: 'EMEDIABOX', error: 'PDF has no /MediaBox', where, boxes, requested };
  }
  const box = boxes[0];
  if (!matchesRequested(box, requested)) {
    return {
      ok: false, code: 'EMEDIABOX',
      error: 'MediaBox ' + box.raw + ' does not match requested ' + requested.w.toFixed(2) + 'x' + requested.h.toFixed(2) + ' pt',
      where, box, requested,
    };
  }
  return { ok: true, where, box, requested, pages: countPages(buf) };
}
```

### 5.8 NEW `src/host/report/html.js`

```js
// src/host/report/html.js
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

export function figureToDataUrl(src, readFile = readFileSync) {
  if (typeof src !== 'string' || src.length === 0) return { ok: false, error: 'figure src required' };
  if (/^data:/i.test(src) || /^https?:\/\//i.test(src)) return { ok: true, href: src };
  try {
    const buf = readFile(src);
    const mime = MIME[path.extname(src).toLowerCase()] || 'application/octet-stream';
    return { ok: true, href: 'data:' + mime + ';base64,' + Buffer.from(buf).toString('base64') };
  } catch (e) {
    return { ok: false, error: 'figure unreadable: ' + e.message, src };
  }
}

export function renderPagedReport({ title, date, sections, pageCount = null, figureHref = [] }) {
  const predicted = 2 + sections.length; // cover + toc + one page per section (page-break-before)
  const toc = sections.map((s, i) => {
    const page = 3 + i;
    return '<li><span>' + escapeHtml(s.heading || ('Section ' + (i + 1))) + '</span><span>' + page + '</span></li>';
  }).join('');
  const body = sections.map((s, i) => {
    const figs = (s.figures || []).map((f, j) => {
      const href = figureHref[i] && figureHref[i][j] ? figureHref[i][j] : '';
      const img = href ? '<img src="' + href + '" alt="' + escapeHtml(f.caption || '') + '">' : '<p class="missing-fig">missing figure</p>';
      return '<figure>' + img + (f.caption ? '<figcaption>' + escapeHtml(f.caption) + (f.source ? ' — ' + escapeHtml(f.source) : '') + '</figcaption>' : '') + '</figure>';
    }).join('');
    return '<section class="section"><h2>' + escapeHtml(s.heading || '') + '</h2>' + (s.lead ? '<p class="lead">' + escapeHtml(s.lead) + '</p>' : '') + figs + '</section>';
  }).join('');
  const footerN = pageCount != null ? String(pageCount) : String(predicted);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm; @bottom-center { content: counter(page) " / ${footerN}"; font-size: 9pt; } }
  html, body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; color: #111; }
  h1 { font-size: 22pt; margin: 0 0 8pt; }
  .date { color: #555; margin-bottom: 24pt; }
  .toc { page-break-after: always; }
  .toc li { display: flex; justify-content: space-between; border-bottom: 1px dotted #ccc; padding: 4pt 0; }
  .section { page-break-before: always; }
  .section:first-of-type { page-break-before: auto; }
  img { max-width: 100%; max-height: 180mm; }
  figcaption { font-size: 9pt; color: #444; }
</style></head><body>
<header class="cover"><h1>${escapeHtml(title)}</h1><p class="date">${escapeHtml(date || '')}</p></header>
<nav class="toc"><h2>Contents</h2><ol>${toc}</ol></nav>
${body}
</body></html>`;
}

export function predictedPageCount(sections) {
  return 2 + (Array.isArray(sections) ? sections.length : 0);
}
```

Cover + TOC share the first flow; CSS `page-break-after` on `.toc` makes TOC its own page. Each `.section` starts a new page. TOC page numbers are therefore `3 + index` without PDF text extraction. That is the honest 2-pass input: pass 1 prints this HTML; pass 2 only rewrites the footer total from the measured `/Count`.

Figures: host resolves `src` with `assertInside` then `figureToDataUrl`. Do not leave `file://` in the HTML.

### 5.9 NEW `src/host/report/pdf.js`

Argv budget is 24000 bytes (010). Embedded HTML + data URLs will not fit in the repl argv. `file://` does not open (issue #22). `setContent` is absent (E3). System Chrome is out of scope.

Design: loopback `node:http` server on `127.0.0.1` serving the HTML at `/`. Script is tiny: `openTab(http://127.0.0.1:port/)`, wait `body`, `pdf({ paperWidth, paperHeight, path })`, `closeTab` in `finally`. Host writes PDF path as an absolute workDir file, then reads those bytes for MediaBox.

```js
// src/host/report/pdf.js
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { A4_INCHES, BrowseOptionError, computeDeadlines } from '../browse/schema.js';

export function compilePdfScript({ url, pdfPath, paperWidth, paperHeight, scriptDeadlineMs }) {
  const payload = { url, pdfPath, paperWidth, paperHeight, scriptDeadlineMs };
  return `(async () => {
  const JOB = ${JSON.stringify(payload)};
  const opened = [];
  const timings = [];
  const record = (step, ms, extra) => timings.push({ step, ms, ...(extra || {}) });
  const items = [];
  try {
    const work = (async () => {
      const t0 = Date.now();
      const tab = await openTab(JOB.url);
      opened.push({ id: tab && (tab.id || tab.targetId || tab), url: JOB.url });
      record('openTab', Date.now() - t0, { url: JOB.url });
      const page = tab.page || tab;
      await page.waitForSelector('body', { timeout: 15000 });
      const t1 = Date.now();
      await page.pdf({ paperWidth: JOB.paperWidth, paperHeight: JOB.paperHeight, printBackground: true, path: JOB.pdfPath });
      record('pdf', Date.now() - t1, { url: JOB.url });
      items.push({ url: JOB.url, ok: true, artifactPath: JOB.pdfPath, requested: { paperWidth: JOB.paperWidth, paperHeight: JOB.paperHeight }, actual: {} });
      console.log(JSON.stringify({ items, timings, leakedUrls: opened.map((o) => o.url), truncated: false, error: null }));
    })();
    await Promise.race([work, sleep(JOB.scriptDeadlineMs).then(() => { const e = new Error('script deadline'); e.code = 'ETIMEOUT'; throw e; })]);
  } catch (e) {
    if (!items.length) items.push({ url: JOB.url, ok: false, error: String(e && e.message ? e.message : e), artifactPath: JOB.pdfPath, requested: { paperWidth: JOB.paperWidth, paperHeight: JOB.paperHeight }, actual: {} });
    console.log(JSON.stringify({ items, timings, leakedUrls: opened.map((o) => o.url), truncated: false, error: String(e && e.message ? e.message : e) }));
  } finally {
    for (const t of opened) { try { await closeTab(t.id); } catch (_) {} }
  }
})();`;
}

export function serveHtml(html) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: 'http://127.0.0.1:' + port + '/' });
    });
    server.on('error', reject);
  });
}

export async function printHtml({ html, session, config, signal, paperWidth, paperHeight, timeoutMs, listenImpl = serveHtml, readFile = readFileSync }) {
  const paperW = paperWidth ?? A4_INCHES.paperWidth;
  const paperH = paperHeight ?? A4_INCHES.paperHeight;
  if (!(paperW > 0) || !(paperH > 0)) throw new BrowseOptionError('report.build: paperWidth/paperHeight must be positive inches', 'EBADVAL');
  const { server, url } = await listenImpl(html);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'codemode-report-'));
  const pdfPath = path.join(dir, 'report.pdf');
  const deadlines = computeDeadlines(timeoutMs, config?.browseCaps);
  const source = compilePdfScript({ url, pdfPath: pdfPath.replace(/\\/g, '/'), paperWidth: paperW, paperHeight: paperH, scriptDeadlineMs: deadlines.scriptDeadlineMs });
  try {
    const env = await session.run({ source, deadlines, job: { urls: [url], timeoutMs }, workDir: dir });
    return { env, pdfPath, paperWidth: paperW, paperHeight: paperH, dir, bytes: () => readFile(pdfPath) };
  } finally {
    await new Promise((r) => server.close(() => r()));
  }
}
```

Compiled source MUST contain `paperWidth` / `paperHeight` and MUST NOT contain `format`. Tests inspect the string. `listenImpl` is injected so `npm test` never binds a port if the test only wants the compiler; tests that exercise `printHtml` may use the real loopback server (no browser) with a fake `session.run`.

### 5.10 MODIFY `src/host/report/report.js` (wp2 empty factory)

010 injects an empty frozen `report` object. Replace `createReport` with:

```js
// src/host/report/report.js
import { writeFileSync } from 'node:fs';
import { A4_INCHES, BrowseOptionError, validateNamedOpts, REPORT_OPTS } from '../browse/schema.js';
import { renderPagedReport, predictedPageCount, figureToDataUrl } from './html.js';
import { printHtml } from './pdf.js';
import { verifyMediaBox, countPages } from './pagebox.js';

export function createReport({ session, config, assertInside, signal } = {}) {
  return Object.freeze({
    async build(input = {}) {
      validateNamedOpts('report.build', input, REPORT_OPTS);
      if (input.template !== 'paged-report') {
        throw new BrowseOptionError('report.build: template must be "paged-report"', 'EBADVAL');
      }
      if (typeof input.title !== 'string' || !input.title) throw new BrowseOptionError('report.build: title is required', 'EBADVAL');
      if (typeof input.out !== 'string' || !input.out) throw new BrowseOptionError('report.build: out is required', 'EBADVAL');
      if (!Array.isArray(input.sections) || input.sections.length === 0) {
        throw new BrowseOptionError('report.build: sections must be a non-empty array', 'EBADVAL');
      }
      const outPath = assertInside(input.out);
      const paperWidth = input.paperWidth ?? A4_INCHES.paperWidth;
      const paperHeight = input.paperHeight ?? A4_INCHES.paperHeight;
      const figureHref = input.sections.map((s) => (s.figures || []).map((f) => {
        if (typeof f.src === 'string' && /^https?:\/\//i.test(f.src)) return { ok: true, href: f.src };
        if (typeof f.src === 'string' && /^data:/i.test(f.src)) return { ok: true, href: f.src };
        const abs = assertInside(f.src);
        return figureToDataUrl(abs);
      }));
      const hrefs = figureHref.map((row) => row.map((c) => (c.ok ? c.href : '')));
      const qa = [];
      for (let i = 0; i < figureHref.length; i++) {
        for (let j = 0; j < figureHref[i].length; j++) {
          if (!figureHref[i][j].ok) qa.push({ code: 'EFIGURE', error: figureHref[i][j].error, section: i, figure: j });
        }
      }
      const twoPass = input.twoPass !== false;
      const html1 = renderPagedReport({ title: input.title, date: input.date, sections: input.sections, figureHref: hrefs });
      const printed = await printHtml({ html: html1, session, config, signal, paperWidth, paperHeight, timeoutMs: input.timeoutMs });
      let bytes = printed.bytes();
      let pages = countPages(bytes);
      if (twoPass) {
        const html2 = renderPagedReport({ title: input.title, date: input.date, sections: input.sections, figureHref: hrefs, pageCount: pages });
        const printed2 = await printHtml({ html: html2, session, config, signal, paperWidth, paperHeight, timeoutMs: input.timeoutMs });
        bytes = printed2.bytes();
        pages = countPages(bytes);
        printed.env = printed2.env;
        printed.pdfPath = printed2.pdfPath;
      }
      const box = verifyMediaBox(bytes, paperWidth, paperHeight);
      const predicted = predictedPageCount(input.sections);
      if (pages && pages !== predicted) qa.push({ code: 'EPAGECOUNT', error: 'page count ' + pages + ' != predicted ' + predicted, pages, predicted });
      if (!box.ok) qa.push({ code: box.code, error: box.error, box: box.box ?? null, requested: box.requested });
      const itemOk = box.ok === true && printed.env.killed !== true && printed.env.items[0]?.ok !== false;
      writeFileSync(outPath, bytes);
      const result = {
        ok: itemOk,
        pdf: outPath,
        pages,
        mediaBox: box.box ?? null,
        requested: box.requested,
        qa,
        items: [{
          ok: itemOk,
          artifactPath: outPath,
          requested: { paperWidth, paperHeight, template: input.template },
          actual: { bytes: bytes.length, mediaBox: box.box ?? null, pages, where: box.where },
          error: itemOk ? undefined : (box.error || printed.env.items[0]?.error || 'report.build failed'),
          code: itemOk ? undefined : (box.code || 'EBUILD'),
        }],
        complete: itemOk && qa.every((q) => q.code !== 'EMEDIABOX'),
        timings: printed.env.timings,
      };
      return result;
    },
  });
}
```

**MediaBox mismatch still writes `out`** so a human can inspect the file, but `ok: false`, `items[0].ok: false`, `code: 'EMEDIABOX'`. Existence of the file is not success. Do not delete the file (E5-style: artifacts are evidence).

Hangul tofu cannot be proven from PDF bytes without rasterising (CID fonts). Do not fake a hangul QA checker. Record as human-review in §8.

### 5.11 MODIFY `src/host/globals.js` (HEAD `src/host/globals.js:8-19`)

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

After wp5 (if wp2 already added `browse`/`report`, keep that session instance and only add `api` + pass `session` into `createReport` / `createBrowse`):

```js
import { createBrowse } from './browse/browse.js';
import { createBrowseSession } from './browse/session.js';
import { createReport } from './report/report.js';
import { createApi } from './browse/adapters.js';

export function createHostGlobals(config, assertInside, signal) {
  const rgRunner = createRgRunner(createRgResolver(config, process.env, { signal }), { excludeGlobs: config.excludeGlobs, signal });
  const hostFs = createFs({ assertInside, signal });
  const session = createBrowseSession({ config, signal });
  const browse = createBrowse({ config, signal, session });
  const report = createReport({ config, signal, session, assertInside });
  const api = createApi({ signal, fetchImpl: globalThis.fetch.bind(globalThis), timeoutMs: config.apiCaps?.timeoutMs, maxBatch: config.apiCaps?.maxBatch });
  return {
    search: createSearch({ rgRunner, assertInside, caps: config.searchCaps }),
    fs: hostFs,
    read_file: hostFs.read_file,
    write_file: hostFs.write_file,
    edit_file: hostFs.edit_file,
    apply_patch: createApplyPatch({ write_file: hostFs.write_file, edit_file: hostFs.edit_file }),
    actions: createActions(),
    browse,
    report,
    api,
  };
}
```

One session object is shared so report and extract share spawn injection in tests.

### 5.12 MODIFY `src/sandbox.js:7` ROOTS

Current: `const ROOTS = ['search', 'fs', 'actions', 'read_file', 'write_file', 'edit_file', 'apply_patch'];`

After: `const ROOTS = ['search', 'fs', 'actions', 'read_file', 'write_file', 'edit_file', 'apply_patch', 'browse', 'report', 'api'];`

Do not walk a second object level. `hostMethods` (`:9-20`) already registers `browse.extract`, `api.batch`, `report.build`.

Do not add a `msg.browse` restore lane next to `src/sandbox.js:110-112`.

### 5.13 MODIFY `src/execution-worker.js:50-56`

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

After:

```js
const injected = { search: {}, fs: {}, actions: {}, browse: {}, report: {}, api: {} };
for (const name of manifest) {
  const [root, method] = name.split('.');
  if (method) injected[root][method] = (...args) => root === 'actions' ? syncRpc(name, args) : rpc(name, args);
  else injected[root] = (...args) => rpc(name, args);
}
for (const key of ['search', 'fs', 'actions', 'browse', 'report', 'api']) Object.freeze(injected[key]);
```

Pre-create is mandatory: `injected[root][method] =` throws if `browse`/`report`/`api` are missing (002).

### 5.14 MODIFY `src/host/actions.js:11-12`

Current: `const REGISTRY = [ ...SEARCH_ACTIONS, { path: 'read_file', ...`

After:

```js
import { BROWSE_ACTIONS, REPORT_ACTIONS, API_ACTIONS } from '../browse/schema.js';

const REGISTRY = [
  ...SEARCH_ACTIONS,
  ...BROWSE_ACTIONS,
  ...REPORT_ACTIONS,
  ...API_ACTIONS,
  {
    path: 'read_file',
```

`test/actions.test.js:11` asserts `list().length >= 11` (floor, not exact). No edit required unless a test pins exact paths. Add a test that `actions.list('api')` / `actions.list('browse.extract')` / `actions.list('report')` return the new rows, and `actions.check('browse.extract', { block: ['image'] })` is not needed (block is an option on the third arg, not catalog-required). `actions.check('browse.open', { url: 'https://example.com', block: true })` — `block` is in OPEN_OPTS catalog if we add it as an input; if not in `inputs`, check reports `unknown`. Put `block` in browse.open/extract/snapshot `inputs` as optional boolean so check reports it; execution still ENOTSUP via `validateNamedOpts`. Do **not** add value-level ENOTSUP to `actions.check` unless you extend `checkOptionValue` (search pattern). Execution throw is the gate; catalog description states ENOTSUP.

### 5.15 MODIFY `src/tools.js:7-23` GUEST_API_DOC

Append bullets before the closing `.join('\n')` (after the actions bullet at `:19`):

```
  '- browse.extract(url, schema, { waitFor?, timeoutMs? }) => {ok,url,data,missing,hints} — CSS extract to typed JSON. Does not return a snapshot. type: krw|usd|int|date|string. Missing fields are null + nearby-text hints. Default wait is domcontentloaded, never networkidle. block/route is ENOTSUP (Aside has no page.route; request events are zero).',
  '- browse.snapshot(url, { compact?, waitFor?, timeoutMs? }) => {tree?,refs,diff,hash,cached,truncated} — accessibility snapshot. Repeat in the same execute_code omits tree and returns diff only. compact keeps named roles. Over-size trees auto-compact with truncated:true.',
  '- browse.open(url, { waitFor?, timeoutMs? }) => {ok,url,title,wait} — navigate + wait + close. No page handle survives the call.',
  '- api.batch([{kind, ...}]) => {items,complete,partial} — public YouTube oEmbed, iTunes lookup, Play Store details HTML in parallel. slack.history returns EAUTH (token required, out of scope). Guest still has no fetch.',
  '- report.build({ template:\'paged-report\', title, date?, sections, out, paperWidth?, paperHeight? }) => {ok,pdf,pages,mediaBox,qa,items} — Aside pdf() with paperWidth/paperHeight in inches (A4 default). format:\'A4\' is ENOTSUP (silently Letter). The item fails if MediaBox is not the requested box even when the file exists. chrome: is ENOTSUP.',
```

Leave `inputSchema` as `{code, timeoutMs}` (`src/tools.js:28-36`).

### 5.16 MODIFY `src/config.js`

`DEFAULTS` at `:29-36` currently has `searchCaps`. After wp2 it also has `browseCaps`. wp5 field-wise copies (same pattern as `:109-112`):

```js
  apiCaps: { timeoutMs: 8000, maxBatch: 32 },
  reportCaps: { twoPass: true },
```

Inside existing `browseCaps` object (create the keys if wp2 used a smaller object):

```js
  waitForByHost: {},
  snapshotMaxChars: 4096,
```

`apply()` must copy them or they are silently dropped (`002`, `src/config.js:96-114`):

```js
    if (obj.browseCaps && typeof obj.browseCaps === 'object') {
      // keep wp2 fields (enabled, timeoutMs, maxTabs, ...)
      if ('waitForByHost' in obj.browseCaps && obj.browseCaps.waitForByHost && typeof obj.browseCaps.waitForByHost === 'object') {
        cfg.browseCaps.waitForByHost = { ...obj.browseCaps.waitForByHost };
      }
      if ('snapshotMaxChars' in obj.browseCaps) cfg.browseCaps.snapshotMaxChars = requireInteger('browseCaps.snapshotMaxChars', obj.browseCaps.snapshotMaxChars);
    }
    if (obj.apiCaps && typeof obj.apiCaps === 'object') {
      if ('timeoutMs' in obj.apiCaps) cfg.apiCaps.timeoutMs = requireInteger('apiCaps.timeoutMs', obj.apiCaps.timeoutMs);
      if ('maxBatch' in obj.apiCaps) cfg.apiCaps.maxBatch = requireInteger('apiCaps.maxBatch', obj.apiCaps.maxBatch);
    }
    if (obj.reportCaps && typeof obj.reportCaps === 'object') {
      if ('twoPass' in obj.reportCaps) cfg.reportCaps.twoPass = obj.reportCaps.twoPass === true;
    }
```

Env (flat, last-win, `:124-131`):

- `CODEMODE_SNAPSHOT_MAX_CHARS`
- `CODEMODE_API_TIMEOUT_MS`
- `CODEMODE_API_MAX_BATCH`

No nested env for `waitForByHost` (002: no nested env convention).

### 5.17 MODIFY `codemode.config.example.json`

Add sibling keys next to `searchCaps` (`codemode.config.example.json:6-9`):

```json
  "browseCaps": {
    "waitForByHost": {
      "play.google.com": { "waitFor": "[itemprop=description]" }
    },
    "snapshotMaxChars": 4096
  },
  "apiCaps": { "timeoutMs": 8000, "maxBatch": 32 },
  "reportCaps": { "twoPass": true }
```

Keep wp2 keys if already present; do not delete `asidePath` / `enabled`.

### 5.18 MODIFY README / README.ko / templates

`README.md:47-55` and `README.ko.md:47-55` Guest API tables — append rows:

| Name | Role |
| `browse.extract` / `browse.snapshot` / `browse.open` | CSS extract (no snapshot dump); cached compact snapshot; navigate+wait+close |
| `api.batch` | Public YouTube oEmbed, iTunes lookup, Play details HTML. Slack history needs auth and returns EAUTH |
| `report.build` | Paged HTML → Aside pdf() in inches. Item fails unless MediaBox matches |

One sentence under the table: default wait is `domcontentloaded`, never `networkidle`; `block` is not supported because Aside has no `page.route`.

`templates/AGENTS.codemode.md:9-16` — after the available-tools sentence, add: `browse.extract`, `browse.snapshot`, `api.batch`, `report.build` are host RPCs; do not call `aside` from the guest. Keep `{{NODE}}` `{{CLI}}` `{{CWD_HINT}}`.

### 5.19 NEW tests (never launch a browser)

Pattern: `node:test` + `node:assert/strict`; inject `fetchImpl` / `session.run` / `spawnImpl`. Timing is not an oracle (`test/write-hardening.test.js:4-7`).

Shared fake session:

```js
function fakeSession(handler) {
  return { run: async (args) => handler(args) };
}
function okEnv(items) {
  return { items, timings: [], complete: items.every((i) => i.ok !== false), truncated: false, partial: [], leakedUrls: [], killed: false, marker: { status: 'ok', elapsedMs: 1 } };
}
```

Letter PDF fixture (plaintext MediaBox):

```
%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
trailer << /Root 1 0 R >>
%%EOF
```

A4 fixture: same with `[0 0 595.91998 841.91998]`.

Files:

- `test/api-batch.test.js`
- `test/browse-extract.test.js` (extract + snapshot cache/compact + open)
- `test/browse-wait.test.js`
- `test/report-build.test.js` (pagebox + html escape + build MediaBox)

`scripts/run-tests.mjs` enumerates `test/*.test.js` — no extra runner edit.

## 6. Dependency order of edits

1. `src/host/report/pagebox.js` (pure; no browse imports).
2. `src/host/browse/schema.js` — `block`, `validateNamedOpts`, `API_ACTIONS`, `REPORT_ACTIONS`, extra `BROWSE_ACTIONS`.
3. `src/host/browse/policy.js` — `resolveWait` / `compileWaitSnippet` (throws `ENOTSUP` on `block`).
4. `src/host/browse/adapters.js` — parsers + `createApi`.
5. `src/host/browse/extract.js` — compilers + cache + type parsers.
6. `src/host/browse/script.js` — wait insertion in `openOne`.
7. `src/host/browse/browse.js` — `extract` / `snapshot` / `open`.
8. `src/host/report/html.js`.
9. `src/host/report/pdf.js`.
10. `src/host/report/report.js` — replace empty factory.
11. `src/host/globals.js` — shared `session`, `api`, `report`.
12. `src/sandbox.js` ROOTS, `src/execution-worker.js` pre-create/freeze.
13. `src/host/actions.js` splice, `src/tools.js` bullets.
14. `src/config.js` + `codemode.config.example.json`.
15. README / README.ko / `templates/AGENTS.codemode.md`.
16. Tests last. Do not spawn Aside. Inject `session.run` / `fetchImpl`.

Browse never imports report (002). Report imports browse `schema.js` + `session` only.

## 7. Testable acceptance criteria (every conditional path)

For each row: ACTIVATION SCENARIO = how a unit test triggers it; OBSERVABLE = what proves that branch ran. No elapsed-time oracles.

### 7.1 `api.batch` (#18) — `test/api-batch.test.js`

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| A1 | empty / non-array | `batch()` / `batch(null)` / `batch([])` | throws `BrowseOptionError` `EBADVAL` |
| A2 | over maxBatch | `maxBatch: 2` then 3 requests | throws `EBADVAL` matching `at most 2` |
| A3 | youtube success | `fetchImpl` returns oembed JSON for both ids | `items[0].ok===true`, `data[0].title` set, URL contains `oembed` and video id |
| A4 | youtube HTTP fail | fetch status 404 | item `ok:false`, `code:'EHTTP'`, siblings still present |
| A5 | youtube bad JSON | body `not-json` | `code:'EPARSE'` |
| A6 | youtube missing ids | `{kind:'youtube.metadata'}` | `code:'EBADVAL'`, **zero** fetch calls |
| A7 | itunes success | lookup JSON `resultCount:1` | `name`/`bundleId` mapped from `results[0]` |
| A8 | itunes empty results | `{resultCount:0,results:[]}` | `code:'ENOTFOUND'` |
| A9 | playstore JSON-LD | HTML with `SoftwareApplication` ld+json | `name` from JSON-LD |
| A10 | playstore og fallback | HTML with only `og:title` | `name` from og tag |
| A11 | playstore neither | HTML `<html></html>` | `code:'EPARSE'` |
| A12 | slack.history | `{kind:'slack.history', team:'T', channels:['C']}` | `code:'EAUTH'`, error is `SLACK_UNAVAILABLE`, fetch call count **0** |
| A13 | unknown kind | `{kind:'twitter.x'}` | `code:'EBADKIND'`, message lists `API_KINDS` |
| A14 | mixed batch | youtube ok + slack + itunes ok in one `batch` | `complete:false`, `partial:true`, three `items`, youtube/itunes ok |
| A15 | fetch throw | `fetchImpl` rejects | item `ok:false`, not a thrown batch |
| A16 | abort | aborted `AbortSignal` before/during | item `code:'ECANCELLED'` |
| A17 | no unexpected hosts | spy on fetch URL | only `youtube.com/oembed`, `itunes.apple.com/lookup`, `play.google.com/store/apps/details` |

### 7.2 `browse.extract` (#10) — `test/browse-extract.test.js`

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| E1 | happy typed JSON | fake session returns `extract:{ monthly:{raw:'₩11,900'}, yearly:{raw:'119000원'}, cta:{raw:['시작하기']} }` with schema types krw/krw/string+all | `data.monthly===11900`, `data.yearly===119000`, `data.cta[0]==='시작하기'`; keys `tree` and `snapshot` **absent** |
| E2 | missing field | `raw:null, hint:'Plans start at...'` | `data.x===null`, `missing` includes `x`, `hints.x` starts with `Plans` |
| E3 | krw / usd / int / date / string | table of raw strings | parsers as in `parseTyped`; `date` → `YYYY-MM-DD`; unparseable → `null` |
| E4 | regex no match | `raw:'foo', regex:'(\\d+)'` | `null` + missing |
| E5 | invalid schema | no `css`, unknown `type`, empty schema, schema array | `EBADVAL` **before** `session.run` (run not called) |
| E6 | non-http url | `ftp://x` | `EBADVAL` before spawn |
| E7 | compiled script contract | capture `session.run` `source` | contains `page.evaluate`; does **not** contain `snapshot(`; does **not** contain `page.route`; contains `waitForSelector` or `waitForLoadState('domcontentloaded'`; does **not** contain `networkidle` unless opts asked |
| E8 | wait timeout from script | envelope item `ok:false` error `script deadline` | extract `ok:false`, no throw of sibling fields |
| E9 | `block:['image']` | opts.block | `ENOTSUP`, message includes `page.route`, `session.run` not called |
| E10 | unknown opt | `{foo:1}` | `EBADOPT` lists valid keys |

### 7.3 snapshot cache + compact (#14)

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| S1 | first call | fake snapshot `{tree:'T'.repeat(289), refs:{e1:1}, diff:''}` | return has `tree.length===289`, `refs`, `diff`, `cached:false` |
| S2 | repeat same url | second `snapshot(url)` on same factory, tree unchanged, native `diff:'D'.repeat(20)` | return has **no** `tree` key, `diff.length===20`, `cached:true` |
| S3 | repeat changed tree | second tree differs by one line | `cached:true`, no `tree`, `diff` contains `-` or `+` from `lineDiff` |
| S4 | different url | two urls | second does not hit first cache (`cached:false`, has `tree`) |
| S5 | compact roles | tree fixture with heading/paragraph/link/button lines; `compact:['heading','link']` | returned tree has heading+link, no paragraph/button |
| S6 | compact `price` | line containing `₩12,000` | kept when compact includes `price` even without that ARIA role |
| S7 | auto-compact | tree 5000 chars, `snapshotMaxChars:100`, no compact opt | `truncated:true`, returned tree shorter than 5000 |
| S8 | compact not array | `compact:'heading'` | `EBADVAL` |
| S9 | new factory | two `createExtractFns` | caches do not leak across executions |

Aside native repeat (same page, one repl) measured 20-char diff vs 289-char tree (`cap-probe.js:13-14`). Host cache is required because each guest RPC is a new repl (E1). Tests prove the host contract, not live Aside.

### 7.4 wait strategy + block refusal (#11)

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| W1 | default | `resolveWait('https://example.com', {})` | `kind:'loadstate', state:'domcontentloaded'` — **not** networkidle |
| W2 | CSS string | `waitFor:'h1'` | `kind:'selector', selector:'h1'` |
| W3 | object selector | `waitFor:{selector:'[itemprop=description]'}` | selector copied |
| W4 | `text` | `waitFor:'text'` | selector `body`, `via:'text'` |
| W5 | explicit networkidle | `waitFor:'networkidle'` | `state:'networkidle', explicit:true` |
| W6 | host profile | url `https://play.google.com/store/...`, `waitForByHost:{'play.google.com':{waitFor:'[itemprop=description]'}}`, no opts.waitFor | selector from profile |
| W7 | opts override profile | same host, `waitFor:'h1'` | selector `h1` |
| W8 | `block` | `{block:['image']}` | throws `ENOTSUP`, message === `UNSUPPORTED.route` / includes `page.route` |
| W9 | `blockResources` / `route` | each key | same `ENOTSUP`, no spawn |
| W10 | bad waitFor | `waitFor:0` / `{}` | `EBADVAL` |
| W11 | compileBrowseScript | job without waitFor | compiled source has `domcontentloaded` or no `networkidle`; never `page.route` |
| W12 | compile with selector wait | waits payload selector `h1` | source contains `waitForSelector("h1"` (or JSON-escaped equivalent) |
| W13 | `compileWaitSnippet` | selector vs loadstate | string starts with `await page.waitForSelector` / `waitForLoadState` |

### 7.5 `report.build` / pagebox (#22)

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| R1 | A4 match | fixture MediaBox `0 0 595.91998 841.91998`, paper `A4_INCHES` | `verifyMediaBox.ok===true`, `matchesRequested` true at `MEDIA_EPS=1` |
| R2 | Letter vs A4 | fixture `0 0 612 792`, requested A4 | `ok:false`, `code:'EMEDIABOX'`; `report.build` returns `ok:false`, `items[0].ok===false`, **and** `out` file exists (write still happens) |
| R3 | missing MediaBox | PDF without `/MediaBox` | `EMEDIABOX`, error `no /MediaBox` |
| R4 | objstm fallback | no plaintext box; zlib stream contains `/MediaBox [0 0 595.92 841.92]` | `where:'objstm'`, ok true |
| R5 | compiled pdf script | capture `compilePdfScript` | contains `paperWidth` and `paperHeight`; does **not** contain `format`; contains `finally` + `closeTab`; does **not** contain `setContent` or `file://` |
| R6 | unknown template | `template:'slides'` | `EBADVAL` before listen/spawn |
| R7 | `chrome:` option | `{chrome:'/Applications/Google Chrome.app/...'}` | `ENOTSUP` mentioning Aside REPL |
| R8 | `format` | if passed | `ENOTSUP` E4 string |
| R9 | out outside roots | `assertInside` throws | no write, no listen |
| R10 | empty sections | `[]` | `EBADVAL` |
| R11 | missing figure | unreadable src | `qa` has `EFIGURE`; build still attempts pdf |
| R12 | HTML escape | title `<script>` | rendered HTML contains `&lt;script&gt;`, not a raw tag |
| R13 | twoPass default | fake session counts calls | `session.run` invoked twice; second HTML contains measured page count in footer CSS |
| R14 | twoPass false | `twoPass:false` | one `session.run` |
| R15 | page count mismatch | `/Count 9` vs 2+sections | `qa` has `EPAGECOUNT`; does not by itself flip MediaBox success (only `EMEDIABOX` makes `complete` false per report.js). If MediaBox ok and count mismatches, `ok` stays true unless you also fail — **fail the item when count mismatches**: implementer must set `itemOk = box.ok && pages===predicted` OR keep count as qa-only. **Decision: count mismatch is qa-only, MediaBox mismatch is the fail.** Tests assert this split. |
| R16 | loopback URL | capture pdf source | `openTab` argument is `http://127.0.0.1:` not `file://` |
| R17 | server closed | after `printHtml` | injected `listenImpl` server `close` was called even when `session.run` throws |
| R18 | killed session | `env.killed:true` | `ok:false` even if MediaBox would match |

### 7.6 wiring

| # | Branch | Activation | Observable |
| --- | --- | --- | --- |
| G1 | guest names | `runCode('return [typeof browse.extract, typeof api.batch, typeof report.build]', { globals: createHostGlobals(...) })` with fake session/fetch | `['function','function','function']` |
| G2 | one-level | `typeof browse.api` | `undefined` |
| G3 | no fetch in guest | existing sandbox test still `typeof fetch === 'undefined'` | unchanged |
| G4 | actions catalog | `actions.find('extract')[0].path` | `browse.extract` |
| G5 | doctor | wp2 doctor still prints capability matrix; wp5 does not require live extract | no live Aside |

## 8. Verifiers

| Command | Exit | Observes this phase's change? |
| --- | --- | --- |
| `node --test test/api-batch.test.js test/browse-extract.test.js test/browse-wait.test.js test/report-build.test.js` | 0 | **yes** — direct |
| `npm test` | 0 (hosted CI is authoritative if `search-boundary` still races locally; 000) | **yes** — `scripts/run-tests.mjs` enumerates `test/*.test.js` |
| `rg -n "page.route" src/host/browse src/host/report` | no production emit of `page.route(` | **yes** — wait tests also grep compiled source |
| `rg -n "format:'A4'|format: \"A4\"" src/host` | no pdf format A4 | **yes** |
| `node --test test/actions.test.js` | 0 | **yes** — catalog floor still holds; add assertions for new paths in extract/report tests via `createActions()` |
| Live `aside.exe repl` extract/pdf | n/a | **no** — not in CI. Human-review under `CODEMODE_BROWSE_LIVE=1` if wp2 already gated that. Hangul glyph QA is human-review. |
| `gh run list --repo lidge-jun/aside-codemode` | 0 after push | **yes** for "CI still green", **not** for MediaBox (unit fixtures observe that) |

If a verifier does not read the new files, the row is marked human-review. Do not claim `npm test` observed MediaBox unless `test/report-build.test.js` ran in that invocation (it will, via enumeration).

## 9. Risks — what would prove this design wrong

| Claim | Falsifier | Response |
| --- | --- | --- |
| oEmbed is enough for #18 | caller needs viewCounts / duration | stay out of Data API v3 (key); do not scrape watch HTML in wp5 |
| Play JSON-LD exists | Google serves consent-only HTML without ld+json/og | item `EPARSE`; do not add unofficial scrapers |
| Slack can be public | a token-free history URL appears | still no token param in wp5; amend to a new kind later |
| `page.evaluate(fn, arg)` works | Aside evaluate takes only a string | switch compilers to `page.evaluate('((' + fn + ')(' + JSON.stringify(schema) + '))')` string form; tests should accept either if they grep `evaluate` |
| loopback HTTP is reachable from Aside | openTab to 127.0.0.1 fails | fallback: if `Buffer.byteLength(html)` + script ≤ 24000, inline `document.write` via evaluate; else `E2BIG` with a clear message. Do not use system Chrome |
| MediaBox epsilon 1pt | Aside A4 inches yield a box >1pt from `inches*72` **and** is still A4 not Letter | bump `MEDIA_EPS` only with a new measured fixture; never treat 612x792 as A4 |
| snapshot tree is a string | live Aside returns a non-string tree | `JSON.stringify` already in extract.js; compact on the stringified form |
| in-execution Map is enough for #14 | user expected disk cache | that is #15 / wp6 `cache.js` |
| CSS `@page size: A4` changes MediaBox | printed box follows CSS not `paperWidth` | still verify bytes; fail on mismatch; do not also send `format:'A4'` |
| 2-pass doubles leak risk | second print killed | each `printHtml` has its own `finally` closeTab + `server.close`; killed envelope fails the item |

This design is wrong if `report.build` returns `ok:true` for a PDF whose first `/MediaBox` is Letter while the caller asked for A4 inches, or if `block:['image']` compiles `page.route` / silently ignores the option, or if `browse.extract` returns a snapshot tree.
