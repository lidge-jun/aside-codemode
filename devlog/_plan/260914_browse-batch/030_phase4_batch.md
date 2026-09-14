# 030 — wp4 core batch (`captureMany`, image dimensions, fetch-first)

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
export function createBrowseSession({ spawnImpl, bin, signal, hostDeadlineMs, tmpDir });
// session.run(source: string) => Promise<{
//   stdout: string, stderr: string, exitCode: number|null, killed: boolean,
//   marker: 'ok'|'error'|null, markerMs: number|null, leakedUrls: string[],
// }>
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
