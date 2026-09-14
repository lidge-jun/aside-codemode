# 030 — wp4 core batch (`captureMany`, image dimensions, fetch-first)

> **Read [003_locked_contracts.md](003_locked_contracts.md) first; it overrides this file.**
> The wp1 audit found that these phase docs, written in parallel, disagreed with each other on
> the `session.run` signature, the `browseCaps` defaults, the spawn/batch model, the deadline
> ordering, and several Aside call forms that had never been measured. 003 settles all of them
> with new measurements (E7). Where this document shows a different shape, 003 is correct.
> Known corrections that apply here: `openTab` returns the page itself (`tab.page` and `tab.id`
> are undefined; identity is `page.targetId`), `snapshot` requires that page object and rejects
> a string id, `file://` navigation is refused, and `waitUntil`/`waitForLoadState` accept any
> string silently so they must be validated host-side.

Closes **#6**, **#12**, **#8**. Depends on wp2 session/script/schema/result/probe
and wp3 policy (block detect, breaker). This file is the implementer PRD.

Class: C3. No new npm dependency. Tests never launch a browser. Timing is
never a correctness oracle.

## 1. Purpose and issues closed

| Issue | Guest name that ships | Close condition |
| --- | --- | --- |
| #6 | `browse.captureMany(items, opts)` | One repl invocation captures N URLs with an in-script tab pool and concurrency cap; per-item failures stay in `items[]`; owned tabs close in `finally` |
| #12 | `browse.screenshot(input, opts)` (thin wrapper) plus host `image.js` | Crop/jpeg happen in the same call as capture; actual geometry is read from PNG IHDR / JPEG SOF; `maxWidth` is **ENOTSUP** (not forwarded, not silently ignored) |
| #8 | `browse.readText(url|urls, opts)` | Host `fetch` → in-repo readability → markdown; browser fallback only when `detectJsRequired` is true **and** `fallback` is on |

#8 proposed `web.readText` does **not** ship as a `web` guest root.
`hostMethods` walks one level only (`src/sandbox.js:9-20`), and
`execution-worker.js:50-56` pre-creates/freezes only those roots. A nested
`browse.web.readText` can never register. Canonical name: `browse.readText`.

## 2. Stale check (run at the start of wp4 C, not now)

wp2/wp3 files do not exist on this tree today (HEAD still file/search only;
`src/host/browse/` is absent). 010 is a sibling placeholder. **Assumed wp2
exports — if names differ, amend this file then implement; do not invent a
second spawn path.**

`src/host/browse/session.js` (wp2) MUST be the only spawn+deadline+parse
path (`002_design_inputs.md` A1). Required export:

```js
// SUPERSEDED BY 003 C1. session.run takes a validated JOB, not a source string:
//   createBrowseSession({ spawnAside, resolveAside, readFile, stat, now, signal })
//   session.run(job, { signal }) => Promise<SessionResult>
// SessionResult = { ok, items, timings, partial: string[], leakedUrls, raw: { stdout, marker } }
// session.run compiles the job internally via compile(job) in script.js; no caller compiles,
// and no caller parses stdout to decide success. raw.stdout remains available for diagnostics.
```

Argv shape, measured: `['repl', <scriptPath>]` (`001` E1). Success is the
trailing `[ok | Nms]` marker **and** the files the script claimed, never
exit code 0 (`001` E1: exit is 0 even on in-script failure).

`src/host/browse/script.js` (wp2) already compiles probe scripts. wp4 adds
`compileCaptureManyScript` and `compileRenderedHtmlScript` here.

`src/host/browse/schema.js` (wp2) owns option validation, same role as
`src/search-schema.js`. wp4 adds the capture/readText option tables.

`src/host/browse/browse.js` (wp2) is the guest factory already wired into
`createHostGlobals` / `ROOTS` / frozen `injected.browse`. wp4 adds methods
only.

`src/host/browse/policy.js` (wp3) exports `detectBlock(htmlOrText)` if
present. wp4 calls it when defined; a missing export is not a fallback to
guessing JS-required.

Numeric deadline rule (do not invert): **in-script deadline < host wait**.
The script's `finally` must run and `closeTab` its own tabs. Killing the
CLI leaks those tabs forever (`001` E5); a later session cannot close them
(`closeTab` throws `Tab undefined is not tracked in this session.`;
`attachBrowserTab` then `page.close()` only detaches). The phrase "host
deadline below in-script deadline" in `000_plan.md` is the opposite of E5's
numbered consequences — follow E5: script self-timeout fires first; kill is
last resort and must surface `partial` plus leaked URLs.

## 3. Locked decisions

### 3.1 Resize story (closes the open item in `001` / `000` item 5)

**Choice: documented ENOTSUP for raster resize. Capture geometry is clip-only.
JPEG format is Aside-native at capture time. Host `image.js` reads dimensions;
it does not scale or transcode pixels.**

Measured facts this is answering (`001` E4):

- `screenshot({fullPage:true,maxWidth:640})` still writes PNG IHDR `1440x900`
  — `maxWidth` is silently ignored.
- `viewportSize({width:800,height:600})` still returns `{1440,900}` — viewport
  is not settable. `p.setViewportSize` is absent (`001` E3).
- `screenshot({clip:{x:0,y:0,width:320,height:200}})` writes PNG IHDR `320x200`.
  Clip is the only honoured geometry control.
- `screenshot({type:'jpeg',quality:90})` returned 18387 bytes in 1076 ms.
  `quality:20` hit the ~30s Aside screenshot timeout once.

Why not a probed system binary (`sips` / `magick` / `convert`):

- CI matrix (`002`) is Ubuntu 18/20/22, macOS 22, Windows 22 with **rg only**.
  Resize would be green on an author's Mac and ENOTSUP in CI — the same class
  of silent-ignore this repo banned for search options
  (`src/search-schema.js:4-7`, `src/host/search.js:4-7`).
- Bare `convert` on win32 is `C:\\Windows\\system32\\convert.exe` (filesystem
  conversion), not ImageMagick. Probing it is a landmine.
- A successful envelope whose `width` is still 1440 after `maxWidth:640` is
  a lie. Refusing is the close.

Why not an in-repo scaler: PNG unfilter + JPEG decode is an image library.
Zero npm dependencies (`package.json:7-9`, `000` out of scope). Out.

**Consequence:** `maxWidth`, `scale`, `resize`, `sips` are not forwarded to
Aside. An explicit `maxWidth` key is `BrowseOptionError` code `ENOTSUP`
**before spawn**, with a message that names clip. Crop is `clip` or
`selector`+optional `margin`. JPEG is `type:'jpeg'` plus `quality` default
**90** (never 20). Host IHDR/SOF is the source of truth for
requested-vs-actual, the same move wp5 will make for PDF MediaBox.

#12 still closes: one call does crop + jpeg + writes a file + returns
`{path,width,height,bytes}`. The original "sips 60 PNGs" step is unnecessary
for geometry (clip) and jpeg (Aside). Raster downscale is refused, not faked.

### 3.2 `page` handles do not exist on the guest side

#12's sketch `browse.screenshot(page, opts)` is not implementable: the Aside
`page` object lives inside one repl VM and cannot cross
`worker_threads` structured clone (`002` RPC facts). `browse.screenshot`
takes `{url, ...}` or an array of those and is `captureMany` with
`{screenshot:true, text:false}`. Passing a thenable throws `EBADVAL`.

### 3.3 JS-required is detected, not guessed

`detectJsRequired(html, extracted)` is a pure function with named predicates.
It does **not** consult the URL, TLD, or a site list.

`required === true` iff extracted markdown (trimmed) has length
`< MIN_ARTICLE_CHARS` (200) **and** at least one of:

| Predicate | Activation |
| --- | --- |
| `emptyAppShell(html)` | `#root` / `#app` / `#__next` / `#__nuxt` / `#__gatsby` element whose inner HTML is empty or whitespace-only |
| `jsRequiredLiteral(html)` | `/enable javascript/i` or `/you need javascript/i` or `/this (page|app) (requires|needs) javascript/i` |
| `scriptDominated(html, extracted)` | `<script` count >= 3 **and** visible text after stripping `script`/`style`/`noscript` is also `< MIN_ARTICLE_CHARS` |

Counter-rule (must have a test): if extracted markdown length >= 200, result
is `required: false` even when `#root` exists (SSR/hydration). A 500 HTML
body, a JSON content-type, and a wp3 challenge page are **not** js-required.

Default `fallback` is `'never'`: return `needsBrowser: true` and do not
spawn. `'whenRequired'` / `true` batches those URLs into **one** repl
running `compileRenderedHtmlScript`, then re-extracts. `'always'` always
uses the browser path (still one spawn per call, not per URL).

## 4. Scope

**IN**

- `browse.captureMany`, `browse.screenshot`, `browse.readText`
- In-script tab pool, concurrency cap, per-item isolation, `finally` close
- Lease/unlease transcript so a kill reports leaked URLs
- `src/host/browse/image.js` PNG IHDR + JPEG SOF readers; requested-vs-actual
- `src/host/browse/fetch-first.js` host fetch + readability-to-markdown +
  `detectJsRequired` + opt-in browser fallback
- Schema/actions/GUEST_API_DOC/README/AGENTS rows for the three names
- `browseCaps.concurrency` config copy (silently dropped otherwise;
  `src/config.js:96-114`)
- Unit tests with injected `spawnImpl` / `fetchImpl`

**OUT**

- `page.route` / request interception / resource blocking (#11 leftover; E3)
- Viewport setting, `maxWidth` honouring, in-repo raster scaler, ImageMagick
- `web.*` / `media.*` / `api.*` guest roots (#18, #19)
- `report.*` (#22, wp5), cache/TTL (#14/#15, wp6), adapters (#18), recipes (#9)
- Live Aside in `npm test` / CI. Live checks only under
  `CODEMODE_LIVE_ASIDE=1`, never as a gate
- Killing the CLI as the happy-path cancel
- New npm dependencies, Node < 18 APIs

## 5. File change map

Legend: NEW = create in wp4. MODIFY = patch as shown. wp2 files are MODIFY
with an insert contract because they will exist when this cycle runs.

### 5.1 NEW `src/host/browse/image.js`

```js
// Host-side screenshot inspection. No pixel decode, no resize, no transcode.
// Clip is the only geometry control Aside honours (001 E4). maxWidth is
// rejected in schema.js, never forwarded, never "fixed" here.

export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class ImageFormatError extends Error {
  constructor(message, code = 'EBADIMAGE') {
    super(message);
    this.name = 'ImageFormatError';
    this.code = code;
  }
}

/** @returns {{format:'png', width:number, height:number, bitDepth:number, colorType:number, interlace:number}} */
export function readPngIhdr(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33) {
    throw new ImageFormatError('PNG: truncated before IHDR');
  }
  if (!buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new ImageFormatError('PNG: bad signature');
  }
  const length = buf.readUInt32BE(8);
  const type = buf.subarray(12, 16).toString('latin1');
  if (type !== 'IHDR' || length !== 13) {
    throw new ImageFormatError(`PNG: first chunk is ${type}/${length}, not IHDR/13`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) throw new ImageFormatError('PNG: zero dimension');
  return {
    format: 'png',
    width,
    height,
    bitDepth: buf[24],
    colorType: buf[25],
    interlace: buf[28],
  };
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** @returns {{format:'jpeg', width:number, height:number, precision:number, sof:number}} */
export function readJpegSof(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new ImageFormatError('JPEG: missing SOI');
  }
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) throw new ImageFormatError('JPEG: expected marker');
    while (i < buf.length && buf[i] === 0xff) i += 1;
    if (i >= buf.length) break;
    const marker = buf[i];
    i += 1;
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue; // SOI / RSTn
    if (i + 2 > buf.length) throw new ImageFormatError('JPEG: truncated marker length');
    const len = buf.readUInt16BE(i);
    if (len < 2) throw new ImageFormatError('JPEG: invalid marker length');
    if (JPEG_SOF.has(marker)) {
      if (i + 7 > buf.length) throw new ImageFormatError('JPEG: truncated SOF');
      const precision = buf[i + 2];
      const height = buf.readUInt16BE(i + 3);
      const width = buf.readUInt16BE(i + 5);
      if (width === 0 || height === 0) throw new ImageFormatError('JPEG: zero dimension');
      return { format: 'jpeg', width, height, precision, sof: marker };
    }
    i += len;
  }
  throw new ImageFormatError('JPEG: no SOF before SOS/EOI');
}

export function readImageSize(buf) {
  if (Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return readPngIhdr(buf);
  if (Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return readJpegSof(buf);
  throw new ImageFormatError('image: neither PNG nor JPEG');
}

/**
 * Attach host-measured dimensions to one capture item. Never resizes.
 * Missing/unreadable files become per-item error; they do not empty siblings.
 */
export function inspectCaptureFile(item, { readFileSyncImpl, assertInside } = {}) {
  if (!item || item.error || typeof item.path !== 'string') return item;
  try {
    const abs = assertInside ? assertInside(item.path) : item.path;
    const buf = readFileSyncImpl(abs);
    const info = readImageSize(buf);
    const requested = item.requestedGeometry || null;
    const actual = { format: info.format, width: info.width, height: info.height };
    const match = !requested
      || (requested.width === actual.width && requested.height === actual.height
        && (!requested.format || requested.format === actual.format));
    return {
      ...item,
      width: info.width,
      height: info.height,
      bytes: buf.length,
      format: info.format,
      scope: { ...(item.scope || {}), geometry: { requested, actual, match } },
    };
  } catch (e) {
    return { ...item, error: { error: e.message, code: e.code || 'EBADIMAGE' } };
  }
}
```

### 5.2 NEW `src/host/browse/fetch-first.js`

```js
export const MIN_ARTICLE_CHARS = 200;
export const MAX_HTML_BYTES = 1.5 * 1024 * 1024;
export const READTEXT_UA = 'aside-codemode-readtext/0.1';

export class ReadTextError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ReadTextError';
    this.code = code;
  }
}

const SHELL_IDS = ['root', 'app', '__next', '__nuxt', '__gatsby'];

export function emptyAppShell(html) {
  const s = String(html);
  for (const id of SHELL_IDS) {
    const re = new RegExp('id=["\\']' + id + '["\\'][^>]*>([\\s]*)<\\/', 'i');
    const m = re.exec(s);
    if (m && m[1].trim() === '') return true;
  }
  return false;
}

export function jsRequiredLiteral(html) {
  return /enable javascript/i.test(html)
    || /you need javascript/i.test(html)
    || /this (?:page|app) (?:requires|needs) javascript/i.test(html);
}

export function stripChrome(html) {
  return String(html)
    .replace(/<script\\b[\\s\\S]*?<\\/script>/gi, '')
    .replace(/<style\\b[\\s\\S]*?<\\/style>/gi, '')
    .replace(/<noscript\\b[\\s\\S]*?<\\/noscript>/gi, '');
}

export function scriptDominated(html, extracted) {
  const scripts = String(html).match(/<script\\b/gi);
  const visible = stripChrome(html).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
  return (scripts ? scripts.length : 0) >= 3
    && visible.length < MIN_ARTICLE_CHARS
    && (extracted?.markdown?.trim().length ?? 0) < MIN_ARTICLE_CHARS;
}

export function detectJsRequired(html, extracted) {
  const reasons = [];
  const mdLen = extracted?.markdown?.trim().length ?? 0;
  if (mdLen >= MIN_ARTICLE_CHARS) return { required: false, reasons };
  if (emptyAppShell(html)) reasons.push('emptyAppShell');
  if (jsRequiredLiteral(html)) reasons.push('jsRequiredLiteral');
  if (scriptDominated(html, extracted)) reasons.push('scriptDominated');
  return { required: reasons.length > 0, reasons };
}

export function decodeHtmlBytes(buf, contentType) {
  const header = /charset=([^;\\s]+)/i.exec(contentType || '');
  const latin = buf.toString('latin1');
  const meta = latin.match(/<meta[^>]+charset=["\\']?([^"\\'\\s>]+)/i);
  const label = (header && header[1]) || (meta && meta[1]) || 'utf-8';
  try { return new TextDecoder(label, { fatal: false }).decode(buf); }
  catch { return new TextDecoder('utf-8', { fatal: false }).decode(buf); }
}

export function htmlToMarkdown(html) {
  const fragment = pickArticle(html);
  const title = textOf(html, /<title[^>]*>([\\s\\S]*?)<\\/title>/i)
    || textOf(fragment, /<h1[^>]*>([\\s\\S]*?)<\\/h1>/i);
  const byline = attrOf(html, /<meta[^>]+name=["\\']author["\\'][^>]+content=["\\']([^"\\']+)/i)
    || attrOf(html, /<meta[^>]+property=["\\']article:author["\\'][^>]+content=["\\']([^"\\']+)/i);
  const publishedAt = attrOf(html, /<meta[^>]+property=["\\']article:published_time["\\'][^>]+content=["\\']([^"\\']+)/i)
    || attrOf(html, /<meta[^>]+property=["\\']og:published_time["\\'][^>]+content=["\\']([^"\\']+)/i);
  const links = [];
  const markdown = toMarkdown(fragment, links);
  return { title: title || '', byline: byline || null, publishedAt: publishedAt || null, markdown, links };
}

function pickArticle(html) {
  const stripped = stripChrome(html);
  const patterns = [/<article\\b[\\s\\S]*?<\\/article>/i, /<main\\b[\\s\\S]*?<\\/main>/i, /<div[^>]+role=["\\']main["\\'][\\s\\S]*?<\\/div>/i];
  for (const re of patterns) {
    const m = stripped.match(re);
    if (m && m[0].replace(/<[^>]+>/g, ' ').trim().length >= MIN_ARTICLE_CHARS) return m[0];
  }
  const body = stripped.match(/<body\\b[\\s\\S]*?<\\/body>/i);
  return body ? body[0] : stripped;
}

function textOf(html, re) { const m = html.match(re); return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()) : ''; }
function attrOf(html, re) { const m = html.match(re); return m ? decodeEntities(m[1].trim()) : ''; }
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function toMarkdown(html, links) {
  let s = String(html);
  s = s.replace(/<pre\\b[\\s\\S]*?<code\\b[^>]*>([\\s\\S]*?)<\\/code>[\\s\\S]*?<\\/pre>/gi, (_, c) => '\\n```\\n' + decodeEntities(c) + '\\n```\\n');
  s = s.replace(/<h([1-6])\\b[^>]*>([\\s\\S]*?)<\\/h\\1>/gi, (_, n, t) => '\\n' + '#'.repeat(Number(n)) + ' ' + decodeEntities(t.replace(/<[^>]+>/g, '')).trim() + '\\n');
  s = s.replace(/<a\\b[^>]*href=["\\']([^"\\']+)["\\'][^>]*>([\\s\\S]*?)<\\/a>/gi, (_, href, t) => {
    const label = decodeEntities(t.replace(/<[^>]+>/g, '')).trim() || href;
    links.push({ href, label });
    return '[' + label + '](' + href + ')';
  });
  s = s.replace(/<(strong|b)\\b[^>]*>([\\s\\S]*?)<\\/\\1>/gi, (_, __, t) => '**' + decodeEntities(t.replace(/<[^>]+>/g, '')).trim() + '**');
  s = s.replace(/<(em|i)\\b[^>]*>([\\s\\S]*?)<\\/\\1>/gi, (_, __, t) => '*' + decodeEntities(t.replace(/<[^>]+>/g, '')).trim() + '*');
  s = s.replace(/<li\\b[^>]*>([\\s\\S]*?)<\\/li>/gi, (_, t) => '\\n- ' + decodeEntities(t.replace(/<[^>]+>/g, '')).trim());
  s = s.replace(/<p\\b[^>]*>([\\s\\S]*?)<\\/p>/gi, (_, t) => '\\n\\n' + decodeEntities(t.replace(/<[^>]+>/g, '')).trim() + '\\n');
  s = s.replace(/<br\\s*\\/?>/gi, '\\n');
  s = s.replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
}
```

The regexes above are the copy-paste source: a single escaped backslash in
the shipped `.js` file (`/\\s/` in this markdown fence is `/\s/` in source).
Keep `emptyAppShell` matching `id="root">\s*</` (empty inner HTML only).

Continue the same file with `createFetchFirst`:

```js
export function createFetchFirst({
  fetchImpl = globalThis.fetch,
  session,
  compileRenderedHtmlScript,
  detectBlock,
  parseReplTranscript,
  signal,
} = {}) {
  async function readOne(url) {
    signal?.throwIfAborted();
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'user-agent': READTEXT_UA, accept: 'text/html,application/xhtml+xml' },
        signal: ac.signal,
      });
      const ctype = res.headers.get('content-type') || '';
      if (!res.ok) {
        return { url, finalUrl: res.url, error: { error: `HTTP ${res.status}`, code: 'EHTTP' }, needsBrowser: false };
      }
      if (ctype && !/html|xml|text\/plain/i.test(ctype)) {
        return { url, finalUrl: res.url, error: { error: `unsupported content-type ${ctype}`, code: 'EBADTYPE' }, needsBrowser: false };
      }
      const raw = Buffer.from(await res.arrayBuffer());
      const html = decodeHtmlBytes(raw.subarray(0, Math.min(raw.length, MAX_HTML_BYTES)), ctype);
      if (typeof detectBlock === 'function') {
        const blocked = detectBlock(html);
        if (blocked) {
          return { url, finalUrl: res.url, error: { error: blocked.reason || 'blocked', code: 'EBLOCK' }, needsBrowser: false };
        }
      }
      const extracted = htmlToMarkdown(html);
      const js = detectJsRequired(html, extracted);
      return {
        url, finalUrl: res.url, title: extracted.title, markdown: extracted.markdown,
        byline: extracted.byline, publishedAt: extracted.publishedAt, links: extracted.links,
        needsBrowser: js.required, jsReasons: js.reasons, engine: 'fetch',
      };
    } catch (e) {
      if (signal?.aborted || e?.name === 'AbortError') {
        throw new ReadTextError('readText cancelled', 'ECANCELLED');
      }
      return { url, error: { error: e.message, code: e.code || 'EFETCH' }, needsBrowser: false };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function renderMany(urls) {
    if (!session || !compileRenderedHtmlScript) {
      return urls.map((url) => ({ url, error: { error: 'browser fallback unavailable', code: 'ENOTSUP' }, needsBrowser: true }));
    }
    const source = compileRenderedHtmlScript({ urls, scriptDeadlineMs: 25000 });
    const raw = await session.run(source);
    const parsed = parseReplTranscript(raw.stdout);
    return urls.map((url, i) => {
      const row = parsed.items.find((x) => x.index === i) || parsed.items[i];
      if (!row || row.error) {
        return { url, error: row?.error || { error: 'render failed', code: 'ERENDER' }, needsBrowser: true };
      }
      const extracted = htmlToMarkdown(row.html || '');
      return {
        url, finalUrl: row.finalUrl || url, title: extracted.title || row.title || '',
        markdown: extracted.markdown, byline: extracted.byline, publishedAt: extracted.publishedAt,
        links: extracted.links, needsBrowser: false, engine: 'browser',
      };
    });
  }

  async function readText(urlOrUrls, opts = {}) {
    const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
    if (!urls.length || urls.some((u) => typeof u !== 'string' || !u)) {
      throw new ReadTextError('browse.readText: url (string) or urls (string[]) is required', 'EBADVAL');
    }
    const fallback = opts.fallback === true ? 'whenRequired' : (opts.fallback || 'never');
    const concurrency = opts.concurrency ?? 8;
    const out = new Array(urls.length);
    let next = 0;
    async function worker() {
      for (;;) {
        const i = next; next += 1;
        if (i >= urls.length) return;
        out[i] = await readOne(urls[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), urls.length) }, worker));
    if (fallback === 'always') {
      const rendered = await renderMany(urls);
      return Array.isArray(urlOrUrls) ? rendered : rendered[0];
    }
    if (fallback === 'whenRequired') {
      const need = [];
      for (let i = 0; i < out.length; i += 1) {
        if (out[i].needsBrowser && !out[i].error) need.push({ i, url: urls[i] });
      }
      if (need.length) {
        const rendered = await renderMany(need.map((x) => x.url));
        for (let k = 0; k < need.length; k += 1) out[need[k].i] = rendered[k];
      }
    }
    return Array.isArray(urlOrUrls) ? out : out[0];
  }

  return Object.freeze({ readText, readOne, detectJsRequired, htmlToMarkdown });
}
```

### 5.3 NEW tests

`test/browse-image.test.js`, `test/browse-batch.test.js`,
`test/browse-readtext.test.js`. `node:test` + `node:assert/strict`.
Fixtures built in-process (no binary files). `spawnImpl` / `fetchImpl`
injected. `mkdtempSync(path.join(tmpdir(), ...))`. Compare paths with
`realpathSync.native`. No `shell:true`. No elapsed-time assertions
(`test/write-hardening.test.js:4-7`).

Fake child helper in `test/browse-batch.test.js`:

```js
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export function fakeChild({ stdoutText = '', hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit('close', null, 'SIGKILL'); };
  queueMicrotask(() => {
    child.stdout.end(stdoutText);
    child.stderr.end('');
    if (!hang) child.emit('close', 0, null);
  });
  return child;
}
```

Hang-until-kill uses `hang: true` and does not emit `close` until `kill`.
Do not add `setTimeout` as the oracle. `spawnImpl` must record `bin`/`args`
and return this child; session (wp2) is constructed with that `spawnImpl`.

PNG/JPEG fixtures: `Buffer.alloc` + `writeUInt32BE` / `writeUInt16BE` in the
test. A 320x200 PNG is: 8-byte sig, `writeUInt32BE(8, 13)`, bytes 12-15
`IHDR`, `writeUInt32BE(16, 320)`, `writeUInt32BE(20, 200)`, then 5 IHDR
tail bytes (bitDepth 8, colorType 2, zeros) plus 4 dummy CRC bytes — enough
for `readPngIhdr` which stops at byte 28. JPEG 8x8: `FF D8 FF C0 00 0B 08
00 08 00 08`.

### 5.4 MODIFY `src/host/browse/schema.js` (wp2 file; insert)

Add alongside wp2 probe options. Mirror `src/search-schema.js:18-19,204-253`.

```js
export class BrowseOptionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BrowseOptionError';
    this.code = code;
  }
}

export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 8;
export const DEFAULT_JPEG_QUALITY = 90;
export const HOST_SLACK_MS = 3000; // hostWait = scriptDeadline + HOST_SLACK_MS
export const ASIDE_SCREENSHOT_TIMEOUT_MS = 30000; // 001 E4 upper bound

const MAX_WIDTH_UNSUPPORTED =
  'maxWidth is not supported: Aside ignores screenshot.maxWidth (measured IHDR stays 1440x900) '
  + 'and viewport is not settable. Pass clip:{x,y,width,height} or selector+margin. '
  + 'Host image.js reads actual dimensions; it does not resize.';

export const CAPTURE_ITEM_KEYS = new Set(['url', 'selector', 'name', 'clip', 'margin', 'type', 'quality', 'text', 'screenshot']);
export const CAPTURE_OPTS = new Set(['concurrency', 'outDir', 'text', 'screenshot', 'type', 'quality', 'timeoutMs']);
export const READTEXT_OPTS = new Set(['fallback', 'concurrency', 'timeoutMs']);
```

`BROWSE_ACTIONS` catalog (spliced into `src/host/actions.js` like
`SEARCH_ACTIONS` at `src/search-schema.js:159` / `src/host/actions.js:11-12`):

```js
export const BROWSE_ACTIONS = [
  {
    path: 'browse.captureMany',
    description: 'Open many URLs in one Aside repl, screenshot+text, per-item errors, auto-close tabs.',
    signature: 'browse.captureMany([{url, selector?, name?, clip?, margin?}], {concurrency?, outDir?, text?, type?, quality?}) => Promise<{items, complete, partial, leakedUrls, scope}>',
    notes: 'One process, in-script tab pool. Failed items are {error} in items[]; siblings stay. maxWidth is ENOTSUP. Clip is the only geometry control. Killing the CLI leaks tabs; cancellation is deadline-driven.',
    inputs: {
      items: { type: 'array', required: true, description: 'Capture requests with url' },
      concurrency: { type: 'number', required: false, description: 'In-script tab pool size (default 4, max 8)' },
      outDir: { type: 'string', required: false, description: 'Directory inside roots for screenshot files; required when screenshot is true' },
      text: { type: 'boolean', required: false, description: 'Include innerText (default true)' },
      screenshot: { type: 'boolean', required: false, description: 'Write a screenshot file (default true)' },
      type: { type: 'string', required: false, description: "'png' (default) or 'jpeg'" },
      quality: { type: 'number', required: false, description: 'JPEG quality, default 90. Do not pass 20; Aside timed out at quality 20' },
      timeoutMs: { type: 'number', required: false, description: 'In-script deadline; host waits this plus 3000ms' },
      maxWidth: { type: 'number', required: false, description: 'Unsupported. ENOTSUP.' },
    },
  },
  {
    path: 'browse.screenshot',
    description: 'captureMany wrapper, screenshot only. Takes {url,...} not a page handle.',
    signature: 'browse.screenshot({url, selector?, clip?, margin?, type?, quality?, outDir?}) => Promise<{path,width,height,bytes,scope}>',
    inputs: {
      url: { type: 'string', required: true, description: 'Page URL' },
      selector: { type: 'string', required: false, description: 'querySelector; converted to clip via evaluate(getBoundingClientRect)' },
      clip: { type: 'object', required: false, description: '{x,y,width,height} in CSS pixels, or the string auto with selector' },
      margin: { type: 'number', required: false, description: 'Extra CSS pixels around selector clip, clamped to viewport' },
      type: { type: 'string', required: false, description: "'png' or 'jpeg'" },
      quality: { type: 'number', required: false, description: 'JPEG quality default 90' },
      outDir: { type: 'string', required: true, description: 'Directory inside roots' },
      maxWidth: { type: 'number', required: false, description: 'Unsupported. ENOTSUP.' },
    },
  },
  {
    path: 'browse.readText',
    description: 'Fetch-first readability to markdown. Browser fallback only when JS is required and fallback is on.',
    signature: 'browse.readText(url|url[], {fallback?, concurrency?}) => Promise<{title,markdown,byline,publishedAt,links,needsBrowser,engine}>',
    notes: 'Issue #8 name web.readText ships here because hostMethods is one-level. JS-required is detectJsRequired(), not a URL heuristic.',
    inputs: {
      url: { type: 'string', required: false, description: 'Single URL (or pass an array as the first argument)' },
      fallback: { type: 'string', required: false, description: "'never' (default) | 'whenRequired' | 'always'" },
      concurrency: { type: 'number', required: false, description: 'Host fetch concurrency (default 8)' },
      timeoutMs: { type: 'number', required: false, description: 'Deadline for the whole call' },
    },
  },
];
```

`validateCaptureOptions` / `validateReadTextOptions` — copy these exactly:

```js
export function validateCaptureOptions(opts, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new BrowseOptionError('browse.captureMany: items (non-empty array) is required', 'EBADVAL');
  }
  const o = opts ?? {};
  if (o === null || typeof o !== 'object' || Array.isArray(o)) {
    throw new BrowseOptionError('browse.captureMany: options must be an object', 'EBADVAL');
  }
  if ('maxWidth' in o && o.maxWidth !== undefined) {
    throw new BrowseOptionError(`browse.captureMany: ${MAX_WIDTH_UNSUPPORTED}`, 'ENOTSUP');
  }
  const bad = Object.keys(o).filter((k) => !CAPTURE_OPTS.has(k) && k !== 'maxWidth');
  if (bad.length) {
    throw new BrowseOptionError(
      `browse.captureMany: unknown option(s) ${bad.map((b) => JSON.stringify(b)).join(', ')}. `
      + `valid: ${[...CAPTURE_OPTS].join(', ')}`,
      'EBADOPT',
    );
  }
  if ('concurrency' in o && o.concurrency !== undefined) {
    if (!Number.isSafeInteger(o.concurrency) || o.concurrency < 1 || o.concurrency > MAX_CONCURRENCY) {
      throw new BrowseOptionError(`browse.captureMany: concurrency must be an integer in [1, ${MAX_CONCURRENCY}]`, 'EBADVAL');
    }
  }
  if ('quality' in o && o.quality !== undefined) {
    if (!Number.isSafeInteger(o.quality) || o.quality < 1 || o.quality > 100) {
      throw new BrowseOptionError('browse.captureMany: quality must be an integer in [1, 100]', 'EBADVAL');
    }
  }
  if ('type' in o && o.type !== undefined && o.type !== 'png' && o.type !== 'jpeg') {
    throw new BrowseOptionError('browse.captureMany: type must be png or jpeg', 'EBADVAL');
  }
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (!it || typeof it !== 'object' || typeof it.url !== 'string' || !it.url) {
      throw new BrowseOptionError(`browse.captureMany: items[${i}].url (non-empty string) is required`, 'EBADVAL');
    }
    if ('maxWidth' in it) {
      throw new BrowseOptionError(`browse.captureMany: items[${i}]: ${MAX_WIDTH_UNSUPPORTED}`, 'ENOTSUP');
    }
    const extra = Object.keys(it).filter((k) => !CAPTURE_ITEM_KEYS.has(k) && k !== 'maxWidth');
    if (extra.length) {
      throw new BrowseOptionError(`browse.captureMany: items[${i}] unknown key(s) ${extra.join(', ')}`, 'EBADOPT');
    }
    if (it.clip === 'auto' && !it.selector) {
      throw new BrowseOptionError(`browse.captureMany: items[${i}] clip:"auto" requires selector`, 'EBADVAL');
    }
    if (it.clip && it.clip !== 'auto') {
      for (const k of ['x', 'y', 'width', 'height']) {
        if (!Number.isFinite(it.clip[k])) {
          throw new BrowseOptionError(`browse.captureMany: items[${i}].clip.${k} must be a number`, 'EBADVAL');
        }
      }
    }
  }
  const screenshot = o.screenshot !== false;
  if (screenshot && (typeof o.outDir !== 'string' || !o.outDir)) {
    throw new BrowseOptionError('browse.captureMany: outDir (inside roots) is required when screenshot is true', 'EBADVAL');
  }
  return o;
}

export function validateReadTextOptions(opts) {
  const o = opts ?? {};
  if (o === null || typeof o !== 'object' || Array.isArray(o)) {
    throw new BrowseOptionError('browse.readText: options must be an object', 'EBADVAL');
  }
  const bad = Object.keys(o).filter((k) => !READTEXT_OPTS.has(k));
  if (bad.length) {
    throw new BrowseOptionError(
      `browse.readText: unknown option(s) ${bad.map((b) => JSON.stringify(b)).join(', ')}. `
      + `valid: ${[...READTEXT_OPTS].join(', ')}`,
      'EBADOPT',
    );
  }
  if ('fallback' in o && o.fallback !== undefined) {
    const ok = o.fallback === true || o.fallback === false
      || o.fallback === 'never' || o.fallback === 'whenRequired' || o.fallback === 'always';
    if (!ok) throw new BrowseOptionError('browse.readText: fallback must be never|whenRequired|always', 'EBADVAL');
  }
  return o;
}
```

### 5.5 MODIFY `src/host/browse/script.js` (wp2 file; insert)

Two compilers. They must **not** emit `page.route`, `setViewportSize`,
`maxWidth`, or `format:'A4'`. Tab pool lives **inside** the script (`001` E6:
5 pages 908 ms parallel vs 3397 ms sequential; 1.4–2.4 s process overhead
forbids one process per URL).

`compileCaptureManyScript({ items, opts, scriptDeadlineMs, outDir })` returns
one string. Required in-script constants and control flow (copy the skeleton):

```js
export function compileCaptureManyScript({ items, opts, scriptDeadlineMs, outDir }) {
  const concurrency = Math.min(opts.concurrency ?? 4, items.length);
  const wantText = opts.text !== false;
  const wantShot = opts.screenshot !== false;
  const type = opts.type === 'jpeg' ? 'jpeg' : 'png';
  const quality = type === 'jpeg' ? (opts.quality ?? 90) : undefined;
  const payload = JSON.stringify(items.map((it, index) => ({
    index, url: it.url, selector: it.selector || null, name: it.name || ('item-' + index),
    clip: it.clip && it.clip !== 'auto' ? it.clip : null, autoClip: it.clip === 'auto',
    margin: Number.isFinite(it.margin) ? it.margin : 0,
  })));
  return [
    'const ITEMS = ' + payload + ';',
    'const CONCURRENCY = ' + concurrency + ';',
    'const DEADLINE = Date.now() + ' + scriptDeadlineMs + ';',
    'const OUTDIR = ' + JSON.stringify(outDir || '') + ';',
    'const WANT_TEXT = ' + wantText + ';',
    'const WANT_SHOT = ' + wantShot + ';',
    'const TYPE = ' + JSON.stringify(type) + ';',
    'const QUALITY = ' + (quality === undefined ? 'undefined' : String(quality)) + ';',
    'const owned = [];',
    'const items = new Array(ITEMS.length);',
    'function emit(obj) { console.log(JSON.stringify(obj)); }',
    'async function closeOwned() {',
    '  const tabs = owned.splice(0);',
    '  for (const t of tabs) {',
    '    try { await closeTab(t.id); } catch {}',
    '    emit({ event: "unlease", tabId: t.id, url: t.url });',
    '  }',
    '}',
    QUERY_CLIP_FN,
    RUN_ITEM_FN,
    WORKER_AND_MAIN,
  ].join('\n');
}
```

`QUERY_CLIP_FN` (string constant in script.js):

```js
async function queryClip(p, selector, margin) {
  const js = "(function(){var el=document.querySelector(" + JSON.stringify(selector) + ");"
    + "if(!el)return {missing:true};var b=el.getBoundingClientRect();"
    + "return {x:b.x,y:b.y,width:b.width,height:b.height};})()";
  const box = await p.evaluate(js);
  if (!box || box.missing) return { error: "selector not found: " + selector };
  const vp = (typeof p.viewportSize === "function" ? p.viewportSize() : { width: 1440, height: 900 }) || { width: 1440, height: 900 };
  const x = Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - margin);
  const width = Math.min(vp.width - x, Math.max(1, box.width + 2 * margin));
  const height = Math.min(vp.height - y, Math.max(1, box.height + 2 * margin));
  if (width < 1 || height < 1) return { error: "clip empty after clamp" };
  return { clip: { x, y, width, height }, requestedGeometry: { width, height } };
}
```

`RUN_ITEM_FN` — per-item `try/catch` is mandatory. A throw becomes
`items[i].error`. No rethrow that empties the array. Screenshot opts may
include `path`, `type`, `quality` (jpeg only), `clip`. Never `maxWidth`.
Never `fullPage:true` as a geometry strategy (E4: fullPage still 1440x900).
On success emit `{event:'item', index, ok:true}` after assigning `items[i]`.
In `finally` of `runItem`: if `tab` is still in `owned`, `closeTab`,
`unlease`, splice it out.
`RUN_ITEM_FN` (string constant; this is the in-script source, not host JS):

```js
async function runItem(it) {
  let tab;
  const started = Date.now();
  try {
    if (Date.now() > DEADLINE) {
      return { index: it.index, name: it.name, url: it.url, error: { error: "in-script deadline", code: "ETIMEOUT" } };
    }
    tab = await openTab(it.url);
    owned.push({ id: tab.id, url: it.url });
    emit({ event: "lease", tabId: tab.id, url: it.url, index: it.index });
    const p = tab.page;
    if (typeof p.waitForLoadState === "function") {
      try { await p.waitForLoadState("domcontentloaded"); } catch {}
    }
    const title = typeof p.title === "function" ? await p.title() : "";
    let clip = it.clip;
    let requestedGeometry = clip ? { width: clip.width, height: clip.height } : null;
    if (it.selector && (it.autoClip || !clip)) {
      const q = await queryClip(p, it.selector, it.margin);
      if (q.error) {
        return { index: it.index, name: it.name, url: it.url, title, error: { error: q.error, code: "ESELECTOR" }, ms: Date.now() - started };
      }
      clip = q.clip;
      requestedGeometry = q.requestedGeometry;
    }
    let path = null;
    if (WANT_SHOT) {
      const ext = TYPE === "jpeg" ? ".jpg" : ".png";
      path = OUTDIR.replace(/[\\/]+$/, "") + "/" + String(it.name).replace(/[^a-zA-Z0-9._-]+/g, "_") + ext;
      const shotOpts = { path, type: TYPE };
      if (TYPE === "jpeg") shotOpts.quality = QUALITY;
      if (clip) shotOpts.clip = clip;
      await p.screenshot(shotOpts);
    }
    let text;
    if (WANT_TEXT) {
      const raw = await p.evaluate('(document.body && document.body.innerText) || ""');
      text = typeof raw === "string" && raw.length > 32768 ? raw.slice(0, 32768) : raw;
    }
    return { index: it.index, name: it.name, url: it.url, title, path, text, requestedGeometry, format: TYPE, ms: Date.now() - started };
  } catch (e) {
    return { index: it.index, name: it.name, url: it.url, error: { error: String(e && e.message || e), code: e && e.code }, ms: Date.now() - started };
  } finally {
    if (tab) {
      const idx = owned.findIndex((t) => t.id === tab.id);
      if (idx !== -1) owned.splice(idx, 1);
      try { await closeTab(tab.id); } catch {}
      emit({ event: "unlease", tabId: tab.id, url: it.url });
    }
  }
}
```


`WORKER_AND_MAIN`:

```js
async function worker(queue) {
  for (;;) {
    if (Date.now() > DEADLINE) return;
    const it = queue.shift();
    if (!it) return;
    items[it.index] = await runItem(it);
    emit({ event: "item", index: it.index, ok: !items[it.index].error });
  }
}
try {
  if (typeof fs !== "undefined" && OUTDIR && typeof fs.mkdir === "function") {
    try { await fs.mkdir(OUTDIR); } catch {}
  }
  const queue = ITEMS.slice();
  const n = Math.min(CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: n }, () => worker(queue)));
  for (let i = 0; i < ITEMS.length; i++) {
    if (!items[i]) items[i] = { index: i, name: ITEMS[i].name, url: ITEMS[i].url, error: { error: "in-script deadline", code: "ETIMEOUT" } };
  }
  emit({ event: "result", items });
} finally {
  await closeOwned();
}
```

`compileRenderedHtmlScript({ urls, scriptDeadlineMs })` is its **own**
template, not a string-replace of the capture compiler. Same pool, lease,
`finally closeOwned`, concurrency `Math.min(4, urls.length)`. Per item:
`openTab` → optional `waitForLoadState('domcontentloaded')` → `p.content()`
+ `p.title()` + `p.url()` → emit `{event:'item', index, html, title,
finalUrl}` → close. **No screenshot.** `WANT_SHOT` is not present.
Copy-paste skeleton for `compileRenderedHtmlScript` (own template, same pool):

```js
export function compileRenderedHtmlScript({ urls, scriptDeadlineMs }) {
  const payload = JSON.stringify(urls.map((url, index) => ({ index, url, name: 'read-' + index })));
  const concurrency = Math.min(4, urls.length);
  return [
    'const ITEMS = ' + payload + ';',
    'const CONCURRENCY = ' + concurrency + ';',
    'const DEADLINE = Date.now() + ' + scriptDeadlineMs + ';',
    'const owned = [];',
    'const items = new Array(ITEMS.length);',
    'function emit(obj) { console.log(JSON.stringify(obj)); }',
    CLOSE_OWNED_FN, // identical to captureMany
    'async function runItem(it) {',
    '  let tab;',
    '  try {',
    '    if (Date.now() > DEADLINE) return { index: it.index, url: it.url, error: { error: "in-script deadline", code: "ETIMEOUT" } };',
    '    tab = await openTab(it.url);',
    '    owned.push({ id: tab.id, url: it.url });',
    '    emit({ event: "lease", tabId: tab.id, url: it.url, index: it.index });',
    '    const p = tab.page;',
    '    if (typeof p.waitForLoadState === "function") { try { await p.waitForLoadState("domcontentloaded"); } catch {} }',
    '    const title = typeof p.title === "function" ? await p.title() : "";',
    '    const finalUrl = typeof p.url === "function" ? p.url() : it.url;',
    '    const html = await p.content();',
    '    const row = { index: it.index, url: it.url, title, finalUrl, html };',
    '    emit({ event: "item", ...row });',
    '    return row;',
    '  } catch (e) {',
    '    return { index: it.index, url: it.url, error: { error: String(e && e.message || e), code: e && e.code } };',
    '  } finally {',
    '    if (tab) {',
    '      const idx = owned.findIndex((t) => t.id === tab.id);',
    '      if (idx !== -1) owned.splice(idx, 1);',
    '      try { await closeTab(tab.id); } catch {}',
    '      emit({ event: "unlease", tabId: tab.id, url: it.url });',
    '    }',
    '  }',
    '}',
    WORKER_AND_MAIN, // identical to captureMany, including finally closeOwned
  ].join('\n');
}
```


Hard rules inside both templates:

- `try/catch` per item.
- `owned` + `finally { await closeOwned() }` even on script-level throw.
- `console.log(JSON.stringify(...))` for every lease/unlease/item/result.
  The host parser never uses exit code.
- Source must not match `page.route`, `p.on('request')`, `setViewportSize`,
  or `maxWidth`.

### 5.6 MODIFY `src/host/browse/result.js` (wp2 file; insert)

Browse envelopes are **plain enumerable objects**. Do not join the search
`toJSON` lane (`src/sandbox.js:109-112`, `002`). Per-item failures live in
`items[]` so `fitEnvelope` log-then-body trim cannot turn a partial batch
into a clean list (`src/execution-output.js:59-91`, `002`).

```js
export function parseReplTranscript(stdout) {
  const text = String(stdout || '').replace(/\r\n/g, '\n');
  const marker = /\[(ok|error) \| (\d+)ms\]\s*$/.exec(text);
  const leases = new Map();
  const leakedUrls = [];
  const items = [];
  let resultItems = null;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{}'.slice(0, 1))) continue;
    let ev;
    try { ev = JSON.parse(s); } catch { continue; }
    if (ev.event === 'lease') leases.set(ev.tabId, ev.url);
    else if (ev.event === 'unlease') leases.delete(ev.tabId);
    else if (ev.event === 'item' && ev.html) items.push(ev);
    else if (ev.event === 'result' && Array.isArray(ev.items)) resultItems = ev.items;
  }
  for (const url of leases.values()) leakedUrls.push(url);
  return {
    marker: marker ? marker[1] : null,
    markerMs: marker ? Number(marker[2]) : null,
    items: resultItems || items,
    leakedUrls,
  };
}

export function buildCaptureEnvelope({ parsed, killed, inspectItem }) {
  const items = (parsed.items || []).map((it) => (inspectItem ? inspectItem(it) : it));
  const failed = items.filter((it) => it && it.error).length;
  const leaked = parsed.leakedUrls || [];
  const complete = parsed.marker === 'ok' && !killed && leaked.length === 0 && failed === 0;
  return {
    items,
    complete,
    truncated: false,
    partial: killed || leaked.length > 0 || failed > 0 || parsed.marker !== 'ok',
    leakedUrls: leaked,
    killed: !!killed,
    marker: parsed.marker,
    scope: { kind: 'captureMany', itemCount: items.length, failed, leaked: leaked.length },
  };
}
```

In the `startsWith` check, test `s.startsWith('{')` — the `.slice` above is
only to keep this markdown fence from confusing a later patch. `parseItemsFromStdout`
is an alias of `parseReplTranscript`.

### 5.7 MODIFY `src/host/browse/session.js` / `pool.js` (wp2)

Do not add a second spawn. After `session.run` returns, `captureMany`
**must** call `parseReplTranscript`. If wp2's session already parses a final
JSON only, keep that for probe and add transcript parsing here.

`pool.js` host-side: record leases from the transcript. `leakedUrls()`
returns still-leased URLs after run. If wp2 already does this, call it;
do not duplicate state.

Deadline wiring in `browse.captureMany`:

```js
const scriptDeadlineMs = Math.max(1000, (opts.timeoutMs ?? 25000));
const hostDeadlineMs = scriptDeadlineMs + HOST_SLACK_MS; // 3000
// pass scriptDeadlineMs into the compiler; hostDeadlineMs into session.run
// session must NOT SIGKILL before hostDeadlineMs
// if abortSignal fires, session MAY kill; then killed:true and leakedUrls from transcript
```

If the guest `timeoutMs` / sandbox deadline is tighter than
`hostDeadlineMs`, clamp `scriptDeadlineMs` so both still satisfy
script < host < sandbox, with at least 1000 ms of script time. If that clamp
cannot be satisfied (sandbox timeout < 4000 ms), throw `EBADVAL` naming the
minimum rather than killing first.

### 5.8 MODIFY `src/host/browse/browse.js` (wp2 factory; add methods)

```js
import { readFileSync } from 'node:fs';
import { validateCaptureOptions, validateReadTextOptions, DEFAULT_CONCURRENCY, HOST_SLACK_MS, BROWSE_ACTIONS } from './schema.js';
import { compileCaptureManyScript, compileRenderedHtmlScript } from './script.js';
import { parseReplTranscript, buildCaptureEnvelope } from './result.js';
import { inspectCaptureFile } from './image.js';
import { createFetchFirst } from './fetch-first.js';

export function createBrowse({ session, assertInside, signal, fetchImpl, detectBlock, browseCaps } = {}) {
  const fetchFirst = createFetchFirst({
    fetchImpl, session, compileRenderedHtmlScript, detectBlock,
    parseReplTranscript, signal,
  });

  async function captureMany(items, opts = {}) {
    const o = validateCaptureOptions(opts, items);
    const outDir = o.screenshot !== false ? assertInside(o.outDir) : '';
    const scriptDeadlineMs = Math.max(1000, o.timeoutMs ?? 25000);
    const source = compileCaptureManyScript({
      items,
      opts: { ...o, concurrency: o.concurrency ?? browseCaps?.concurrency ?? DEFAULT_CONCURRENCY },
      scriptDeadlineMs,
      outDir,
    });
    const raw = await session.run(source, { hostDeadlineMs: scriptDeadlineMs + HOST_SLACK_MS, signal });
    const parsed = parseReplTranscript(raw.stdout);
    if (raw.killed) {
      parsed.leakedUrls = [...new Set([...(parsed.leakedUrls || []), ...((raw.leakedUrls) || [])])];
    }
    const envelope = buildCaptureEnvelope({
      parsed,
      killed: raw.killed,
      inspectItem: (it) => inspectCaptureFile(it, { readFileSyncImpl: readFileSync, assertInside }),
    });
    envelope.scope.concurrency = o.concurrency ?? browseCaps?.concurrency ?? DEFAULT_CONCURRENCY;
    return envelope;
  }

  async function screenshot(input, opts = {}) {
    if (input && typeof input === 'object' && typeof input.then === 'function') {
      throw Object.assign(new Error('browse.screenshot: page handles are not transferable; pass {url, ...}'), { code: 'EBADVAL' });
    }
    const items = Array.isArray(input) ? input : [input];
    const envelope = await captureMany(items, { ...opts, screenshot: true, text: false, outDir: opts.outDir || input?.outDir });
    return Array.isArray(input) ? envelope : envelope.items[0];
  }

  async function readText(urlOrUrls, opts = {}) {
    validateReadTextOptions(opts);
    return fetchFirst.readText(urlOrUrls, opts);
  }

  return Object.freeze({ captureMany, screenshot, readText });
}

export { BROWSE_ACTIONS };
```

### 5.9 MODIFY `src/host/browse/probe.js` (wp2 doctor payload)

Add these keys to the existing doctor/capability object (wp2 owns
`--doctor --browse` printing). If the object is built as `matrix`:

```js
matrix.captureMany = { pool: 'in-script', maxConcurrency: 8, defaultConcurrency: 4 };
matrix.screenshot = {
  clip: true,
  maxWidth: 'ENOTSUP',
  viewportSettable: false,
  jpegQualityDefault: 90,
  resize: 'ENOTSUP',
  dimensions: 'png-ihdr+jpeg-sof',
};
matrix.readText = {
  engine: 'fetch-first',
  jsDetection: 'content-and-shell',
  fallback: 'opt-in',
  guestName: 'browse.readText',
};
```

Verifier note: `node bin/codemode.mjs --doctor --browse` observes this only
after wp2 wired the flag. If that flag is absent when wp4 runs, this row is
**human-review** on the doctor JSON; unit-test `probe.js` export directly.

### 5.10 MODIFY `src/host/actions.js`

Current splice (`src/host/actions.js:9-12`):

```js
import { SEARCH_ACTIONS, checkOptionValue } from '../search-schema.js';

const REGISTRY = [
  ...SEARCH_ACTIONS,
```

After:

```js
import { SEARCH_ACTIONS, checkOptionValue } from '../search-schema.js';
import { BROWSE_ACTIONS } from './browse/schema.js';

const REGISTRY = [
  ...SEARCH_ACTIONS,
  ...BROWSE_ACTIONS,
```

Current value-check gate (`src/host/actions.js:185-192`):

```js
      const isSearch = rec.path.startsWith('search.');
      for (const [name, spec] of Object.entries(rec.inputs)) {
        if (spec.required && !(name in args)) missing.push(name);
        else if (name in args && typeOf(args[name]) !== spec.type) {
          typeErrors.push({ name, want: spec.type, got: typeOf(args[name]) });
        } else if (name in args && (isSearch || rec.path === 'fs.grepFile')) {
          const problem = checkOptionValue(name, args[name]);
          if (problem) invalid.push(problem);
        }
      }
```

After (so `actions.check('browse.captureMany', {maxWidth:640})` reports
ENOTSUP the same way `followSymlinks:true` does):

```js
      const isSearch = rec.path.startsWith('search.');
      const isBrowse = rec.path.startsWith('browse.');
      for (const [name, spec] of Object.entries(rec.inputs)) {
        if (spec.required && !(name in args)) missing.push(name);
        else if (name in args && name === 'maxWidth' && isBrowse) {
          invalid.push({ name, code: 'ENOTSUP', message: 'maxWidth is not supported: use clip or selector+margin' });
        } else if (name in args && typeOf(args[name]) !== spec.type) {
          typeErrors.push({ name, want: spec.type, got: typeOf(args[name]) });
        } else if (name in args && (isSearch || rec.path === 'fs.grepFile')) {
          const problem = checkOptionValue(name, args[name]);
          if (problem) invalid.push(problem);
        }
      }
```

Clip as object vs string `'auto'` will trip `type: 'object'` in
`actions.check` if someone passes `'auto'`. That is acceptable: execution
validates `'auto'` in `validateCaptureOptions`; discovery catalog type stays
object. Do not invent a union type in the catalog.

### 5.11 MODIFY `src/tools.js`

Current last two bullets (`src/tools.js:19-21`):

```
  '- actions.list(filter?), actions.find(query), actions.describe(path), actions.check(path, args) — discover the above without schema dumps. Recommended flow: find -> describe -> check -> call.',
  'IMPORTANT — searches respect .gitignore by default. ...
```

After, insert before the IMPORTANT line:

```
  '- browse.captureMany(items[], {concurrency?, outDir?, text?, type?, quality?}) => {items,complete,partial,leakedUrls,scope} — one Aside repl, in-script tab pool. Per-item {error}; siblings kept. maxWidth is ENOTSUP (Aside ignores it; clip is the geometry control). JPEG quality default 90.',
  '- browse.screenshot({url, selector?, clip?, margin?, type?, quality?, outDir}) — captureMany wrapper. There is no page handle.',
  '- browse.readText(url|url[], {fallback?, concurrency?}) => {title,markdown,byline,publishedAt,links,needsBrowser,engine} — host fetch then readability. Browser fallback only when detectJsRequired is true and fallback is whenRequired|always. Issue #8 name web.readText ships as browse.readText (hostMethods is one-level).',
```

`inputSchema` stays `{code, timeoutMs}` (`src/tools.js:28-36`, `002`).

### 5.12 MODIFY `src/config.js` and `codemode.config.example.json`

Current `DEFAULTS` (`src/config.js:29-36`):

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

After: add `browseCaps: { concurrency: 4 }`.

Current nested copy (`src/config.js:109-112`):

```js
    if (obj.searchCaps && typeof obj.searchCaps === 'object') {
      if ('files' in obj.searchCaps) cfg.searchCaps.files = requireInteger('searchCaps.files', obj.searchCaps.files);
      if ('content' in obj.searchCaps) cfg.searchCaps.content = requireInteger('searchCaps.content', obj.searchCaps.content);
    }
```

After, immediately below:

```js
    if (obj.browseCaps && typeof obj.browseCaps === 'object') {
      if (!cfg.browseCaps) cfg.browseCaps = { concurrency: 4 };
      if ('concurrency' in obj.browseCaps) {
        cfg.browseCaps.concurrency = requireInteger('browseCaps.concurrency', obj.browseCaps.concurrency, 1, 8);
      }
    }
```

After env overrides (`src/config.js:124-130`), add:

```js
  if (env.CODEMODE_BROWSE_CONCURRENCY !== undefined) {
    cfg.browseCaps.concurrency = requireInteger(
      'CODEMODE_BROWSE_CONCURRENCY',
      Number(env.CODEMODE_BROWSE_CONCURRENCY),
      1,
      8,
    );
  }
```

If wp2 already introduced `browseCaps`, only add the `concurrency` field-wise
copy and the env key — do not reset `enabled` / `asidePath`.

`codemode.config.example.json` current has no `browseCaps`. After, sibling
to `searchCaps`:

```json
  "browseCaps": {
    "concurrency": 4
  }
```

A key not copied in `apply()` is silently dropped (`002`). This copy is
mandatory.

### 5.13 MODIFY `README.md:47-55` and `README.ko.md:47-55`

English table, after the `actions.*` row (`README.md:55`):

```
| `browse.captureMany` | One Aside repl, in-script tab pool, screenshot+text. Per-item `{error}`. `maxWidth` is ENOTSUP; pass `clip` or `selector` |
| `browse.screenshot` | `captureMany` wrapper. No page handle |
| `browse.readText` | Host fetch → markdown. Browser fallback only when JS is required and `fallback` is on |
```

Korean table, after `README.ko.md:55`:

```
| `browse.captureMany` | Aside repl 한 번, 스크립트 안 탭 풀, 스크린샷+텍스트. 항목 실패는 `{error}`. `maxWidth`는 ENOTSUP, `clip`/`selector` 사용 |
| `browse.screenshot` | `captureMany` 래퍼. page 핸들 없음 |
| `browse.readText` | 호스트 fetch → 마크다운. JS가 필요할 때만 브라우저 폴백 |
```

Do not claim the guest gained `fetch`. `README.md:45` stays true: the guest
has no `fetch`; `browse.readText` is a host RPC.

### 5.14 MODIFY `templates/AGENTS.codemode.md`

Current tools sentence (lines 12-15):

```
Available tools: `search.files|content|count`,
`read_file({path, offset?, limit?})` (1-indexed lines),
`write_file({file_path, content})` (create-only),
`edit_file({path, edits, appendText?})`, and compound `fs.*` helpers.
```

After, append:

```
When browse is enabled: `browse.captureMany` (one repl, in-script pool; per-item errors; never pass maxWidth — use clip/selector), `browse.screenshot({url,...})` (no page handle), `browse.readText` (fetch-first; set fallback:"whenRequired" only if needsBrowser). Do not spawn Aside yourself and do not kill the CLI to cancel — leaked tabs cannot be closed later.
```

### 5.15 NOT modified in wp4

| File | Why |
| --- | --- |
| `src/sandbox.js` | wp2 adds `'browse'` to `ROOTS` (`src/sandbox.js:7`). wp4 methods are one-level `browse.captureMany` |
| `src/execution-worker.js` | wp2 pre-creates/freezes `injected.browse` (`src/execution-worker.js:50-56`) |
| `src/host/globals.js` | wp2 calls `createBrowse(...)`. wp4 changes the factory internals |
| `src/child-opts.js` | Aside spawn injection lives on the wp2 session, copying `createRgProcessFns` (`src/child-opts.js:13-27`) without overloading the rg comment |
| `package.json` | zero deps remain |

If stale-check finds `browse` missing from `ROOTS` / `injected`, **stop and
amend 010**. Do not paper over it in wp4.

## 6. Dependency order of edits

1. `schema.js` capture/readText options + `BROWSE_ACTIONS` + ENOTSUP
2. `image.js` (no deps on session)
3. `result.js` transcript parser + enumerable envelope
4. `script.js` compilers (pure string builders; test without spawn)
5. `fetch-first.js` (imports `detectJsRequired`, takes `session` optionally)
6. `browse.js` factory methods
7. `session.js` / `pool.js` only if transcript/kill leakedUrls are not yet
   plumbed
8. `probe.js` doctor fields
9. `actions.js` splice + `maxWidth` check
10. `config.js` + example JSON
11. `tools.js` bullets
12. `README.md` / `README.ko.md` / `templates/AGENTS.codemode.md`
13. tests last, against the public functions

No file in this list is allowed to `import` `report/*`.

## 7. Testable acceptance criteria

Every conditional has an ACTIVATION SCENARIO. Observable effect proves that
branch ran. Injected fakes; no live browser; no timing oracle.

### 7.1 Schema / ENOTSUP (no spawn)

| ID | Branch | Activation | Observable |
| --- | --- | --- | --- |
| S1 | empty items | `captureMany([], {})` | throws `BrowseOptionError` `EBADVAL`; spawnImpl call count 0 |
| S2 | unknown opt | `{foo:1}` | `EBADOPT`, message lists valid keys; spawn 0 |
| S3 | `maxWidth` on opts | `{maxWidth:640, outDir}` | `ENOTSUP`, message mentions clip; spawn 0 |
| S4 | `maxWidth` on item | item `{url, maxWidth:640}` | `ENOTSUP`; spawn 0 |
| S5 | concurrency 0 / 9 / 1.5 | those values | `EBADVAL`; spawn 0 |
| S6 | screenshot true, no outDir | `{screenshot:true}` | `EBADVAL` outDir; spawn 0 |
| S7 | `clip:'auto'` no selector | that item | `EBADVAL`; spawn 0 |
| S8 | outDir outside roots | `outDir: tmp-outside` via `makeRootGuard` | `EROOT` from `assertInside`; spawn 0 |
| S9 | `type:'gif'` | that opt | `EBADVAL`; spawn 0 |
| S10 | page-like screenshot arg | `screenshot(Promise.resolve({}))` | `EBADVAL` "not transferable"; spawn 0 |
| S11 | readText unknown opt | `{guess:true}` | `EBADOPT`; fetchImpl call count 0 |
| S12 | readText bad fallback | `{fallback:'maybe'}` | `EBADVAL` |
| S13 | sandbox timeout too tight | `timeoutMs: 2000` (script+slack cannot fit) | throws `EBADVAL` naming 4000 ms minimum; spawn 0 |

### 7.2 `compileCaptureManyScript` (pure)

| ID | Branch | Activation | Observable |
| --- | --- | --- | --- |
| C1 | pool cap | 5 items, concurrency 2 | source contains `const CONCURRENCY = 2` and `Promise.all` workers, not 5 `openTab` at top level without a queue |
| C2 | default cap | 5 items, no concurrency | `const CONCURRENCY = 4` |
| C3 | per-item isolation | any | source contains `catch` inside `runItem` and assigns `items[it.index]`; no `throw` after the catch |
| C4 | owned-tab cleanup | any | source contains `finally` and `closeOwned` and `closeTab` |
| C5 | no interception | any | source does **not** match `page.route` / `setViewportSize` / `maxWidth` |
| C6 | jpeg quality | `type:'jpeg'` | source contains `quality` 90, not 20 |
| C7 | clip pass-through | item.clip `{x:0,y:0,width:320,height:200}` | source JSON contains that clip and `shotOpts.clip` |
| C8 | selector → evaluate | item.selector `'main'` | source contains `document.querySelector` and `"main"` |
| C9 | lease events | any | source emits `event:'lease'` and `event:'unlease'` |
| C10 | one process | N/A here; see B3 | compiler returns one string, not an array of scripts |

### 7.3 `captureMany` with fake spawn

| ID | Branch | Activation | Observable |
| --- | --- | --- | --- |
| B1 | mixed isolation | stdout: result items[0] ok, items[1] `{error}`, marker `[ok | 12ms]`, exit 0 | envelope `items.length===2`, `items[0].error` absent, `items[1].error` present, `complete===false`, `partial===true` |
| B2 | one failure does not empty others | same | `items[0]` still has `url`/`name`; not `[]` |
| B3 | one repl | 5 urls | `spawnImpl` called once; `args[0]==='repl'` |
| B4 | exit 0 is not success | stdout `[error | 9ms]` without result, exit 0 | `complete===false`, `marker==='error'` |
| B5 | missing marker | stdout items but no `[ok |`. exit 0 | `complete===false`, `marker===null` |
| B6 | kill leak | hang:true child; stdout one `lease` for `https://example.com`; abort signal; child.kill | `killed===true`, `leakedUrls` includes that URL, `partial===true`, `complete===false` |
| B7 | clean unlease | lease then unlease then result+ok marker | `leakedUrls` deepEqual `[]` |
| B8 | abort before spawn | signal already aborted | throws/returns `ECANCELLED`; spawn 0 (if session checks like `rg-stream.js:64-66`) |
| B9 | inspect after write | fake stdout path points at a 320x200 PNG the test wrote under outDir | item `width===320`, `height===200`, `scope.geometry.match===true` |
| B10 | requested vs actual mismatch | clip requested 320x200 but file is 1440x900 PNG | `scope.geometry.match===false`, `actual.width===1440`, item is not thrown away |
| B11 | inspect failure isolation | items[0] path missing, items[1] valid PNG | items[0].error.code `EBADIMAGE` or ENOENT, items[1] has width/height |
| B12 | jpeg type actual | file starts `FF D8` with SOF 8x8 | `format==='jpeg'`, width/height 8 |
| B13 | text truncated | in-script returns 32768 chars (compiler cap) | item.text.length<=32768; items[] still present (not trimmed away by logs) |

### 7.4 `image.js`

| ID | Branch | Activation | Observable |
| --- | --- | --- | --- |
| I1 | PNG IHDR | buffer with sig + IHDR 13 + width 320 height 200 | `{format:'png', width:320, height:200}` |
| I2 | PNG truncated | 10 bytes | throws `PNG: truncated before IHDR` |
| I3 | PNG bad sig | JPEG bytes into `readPngIhdr` | throws `bad signature` |
| I4 | PNG zero dim | width 0 | throws `zero dimension` |
| I5 | JPEG SOF0 | SOI + SOF0 8x8 | `{format:'jpeg', width:8, height:8}` |
| I6 | JPEG APP0 then SOF | APP0 skipped | same 8x8, proves length-skip loop ran |
| I7 | JPEG no SOF | SOI + SOS | throws `no SOF` |
| I8 | JPEG missing SOI | PNG into `readJpegSof` | throws `missing SOI` |
| I9 | `readImageSize` dispatch | PNG vs JPEG vs `Buffer.from('x')` | png / jpeg / `neither` |
| I10 | `inspectCaptureFile` skip | item with `error` already | returned unchanged, readFileSyncImpl not called |
| I11 | no resize | any successful inspect | output width equals IHDR width; there is no scaled buffer written |

Build PNG/JPEG fixtures in the test with `Buffer.alloc` + `writeUInt32BE` /
`writeUInt16BE`. Do not commit binary files.

### 7.5 `readText` / `detectJsRequired`

| ID | Branch | Activation | Observable |
| --- | --- | --- | --- |
| R1 | article fetch | fetchImpl returns 200 HTML with `<article><p>` 300 chars | `needsBrowser===false`, `engine==='fetch'`, markdown contains paragraph, spawn 0 |
| R2 | SSR + #root | `<div id="root">` plus `<article>` 300 chars | `needsBrowser===false` (content wins) |
| R3 | empty shell | `<div id="root"></div>` + three scripts, no article text | `needsBrowser===true`, `jsReasons` includes `emptyAppShell`, spawn 0 when fallback default |
| R4 | JS literal | body "Please enable JavaScript" only | `needsBrowser===true`, reasons include `jsRequiredLiteral` |
| R5 | scriptDominated | 4 script tags, 20 chars visible | `needsBrowser===true`, reasons include `scriptDominated` |
| R6 | fallback never | R3 HTML, `fallback:'never'` | spawn 0, needsBrowser true, markdown short |
| R7 | fallback whenRequired | R3 HTML, `fallback:'whenRequired'`; spawn stdout item html with a real article | spawn 1 (one repl), `engine==='browser'`, `needsBrowser===false`, markdown from rendered HTML |
| R8 | fallback always | R1 HTML (already enough) with `fallback:'always'` | spawn 1 even though fetch succeeded |
| R9 | mixed array | 2 article URLs + 1 empty-shell URL, `whenRequired` | fetchImpl 3 calls; spawn 1; spawn script contains only the shell URL |
| R10 | HTTP 500 | status 500 HTML | item.error.code `EHTTP`, `needsBrowser===false`, spawn 0 |
| R11 | JSON type | content-type `application/json` | `EBADTYPE`, not js-required |
| R12 | fetch throw | fetchImpl rejects | per-item `EFETCH`; sibling URLs still return (array input) |
| R13 | wp3 block | inject `detectBlock: () => ({reason:'captcha'})` | `EBLOCK`, spawn 0, not js-required |
| R14 | charset meta | bytes UTF-8 with `<meta charset="utf-8">` | title/markdown decoded, no U+FFFD in article |
| R15 | cancel | aborted signal during fetchImpl (AbortSignal passed through) | `ECANCELLED`; does not return a fake article |
| R16 | single vs array | string in → object out; array in → array out | `Array.isArray` matches input |
| R17 | no session ENOTSUP | `whenRequired` but session undefined | per-item `ENOTSUP` `browser fallback unavailable` |

### 7.6 Catalog / config

| ID | Branch | Activation | Observable |
| --- | --- | --- | --- |
| A1 | splice | `actions.find('capture')` | includes `browse.captureMany` |
| A2 | check maxWidth | `actions.check('browse.captureMany', {items:[], maxWidth:640})` | `ok===false`, `invalid[0].code==='ENOTSUP'` |
| A3 | config copy | loadConfig with JSON `browseCaps.concurrency: 2` | `cfg.browseCaps.concurrency===2` |
| A4 | env wins | JSON 2 + env `CODEMODE_BROWSE_CONCURRENCY=3` | concurrency 3 |
| A5 | unknown JSON key | `browseCaps.nope: 1` | ignored (same as other unknown keys); concurrency stays default |
| A6 | GUEST_API_DOC | import TOOL_DEF.description | contains `browse.captureMany` and `browse.readText` and `ENOTSUP` |

## 8. Verifiers

| Command | Observes this phase's change? |
| --- | --- |
| `node --test test/browse-image.test.js test/browse-batch.test.js test/browse-readtext.test.js` | **Yes** — IHDR/SOF, ENOTSUP, compiled pool, fake-spawn isolation, leak transcript, fetch-first predicates, fallback spawn count |
| `npm test` (`scripts/run-tests.mjs` enumerates `test/*.test.js`) | **Yes** — the three new files are picked up automatically. Still subject to the known `search-boundary.test.js` race in the full suite (`000_plan.md`); confirm that file isolated if it is the only red |
| `node --test test/actions.test.js` (or a new assertion in browse-batch) | **Yes** if A1/A2 are added there |
| `node --test test/config.test.js` | **Yes** if A3/A4 are added; otherwise human-review the apply() copier |
| `node bin/codemode.mjs --doctor --browse` | Observes probe fields only if wp2 wired the flag. If it prints `screenshot.maxWidth: ENOTSUP` that is confirmation; if the flag 404s, **human-review** `probe.js` unit export |
| Live `aside.exe repl` | **Does not observe** in CI. Optional `CODEMODE_LIVE_ASIDE=1` human-review. Success still requires trailing `[ok | Nms]` **and** reading claimed screenshot files (E1/E4) |

Hosted CI on `origin/dev` remains the release gate (`000`). wp4 does not
push; the parent loop does.

## 9. Risks — what would prove this design wrong

| Claim | Falsifier |
| --- | --- |
| Clip is sufficient geometry | A live Aside screenshot with only clip cannot produce the selector crop the caller asked for (evaluate-string rejected; locator box available). Then amend compiler to the working evaluate arity and keep ENOTSUP for maxWidth |
| `p.evaluate(string)` works | Live probe throws. Switch to `p.evaluate(() => ...)` with selector baked into the function source via `new Function`, still no extra arg |
| `openTab` returns `{id, page}` | Probe E2 only showed `openTab` is a function. If the shape is a tab id and `page` is global, rewrite the template to that shape in a one-line amend — do not guess in tests |
| In-script `fs.mkdir` exists | E2: `fs.mkdir` is present. If screenshot path write fails because Aside `screenshot({path})` wants a directory that `fs.mkdir` cannot create outside the session pwd, write to the session pwd and `assertInside`-copy on the host — that would be an amend |
| Fetch-first readability is "good enough" | A real article whose `<article>` is empty and whose body text is in nested `<div>`s below 200 chars after strip would false-positive js-required. Raise by adding a `<div class="post-content">` picker, not by URL lists |
| ENOTSUP for resize closes #12 | User rejects the close because 2880px retina shots still need sips. Then a follow-up unit (not this phase) may add a probed backend; this phase must not silently return unscaled pixels as width=maxWidth |
| Host slack 3000 ms always lets finally run | A hung `openTab` ignores the in-script deadline. Then leakedUrls + partial is the honest envelope; do not extend slack until it becomes a kill-first design |
| `fitEnvelope` keeps items[] | A 30-item capture with 32KiB text each exceeds `maxResultBytes` 65536 and the result body is trimmed to `''` (`src/execution-output.js:70-73`). Cap per-item text (already 32768) **and** drop `text` before `items` if a future budget trim appears; never drop `error` fields. If this fires in tests, lower default text or default `text:false` when `items.length>4` |

If E5 is ever falsified (a later Aside build where killing the CLI closes
tabs), the lease transcript is still correct; do not remove it.
