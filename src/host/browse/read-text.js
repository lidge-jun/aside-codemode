// Read a page without rendering it, and only reach for a browser when the fetched HTML
// measurably is not the content.
//
// The fallback trigger is a property of the RESULT, never of the framework. __NEXT_DATA__
// and ng-app live inside <script>, which the strip pass removes: testing for them would
// fire on ordinary server-rendered pages that need no browser, and after the strip it would
// never fire at all. A text-to-markup ratio is rejected for the same reason — a
// chrome-heavy article page is markup-dense and still perfectly readable.

export const MIN_USEFUL_CHARS = 200;
// A login wall renders perfectly and answers nothing we asked for. policy.detect is the one
// place that names those pages, so readText asks it rather than growing its own guess.
import { detect } from './policy.js';
// An app shell is markup-heavy and text-poor. A genuinely short page is BOTH text-poor and
// markup-poor, and must not be sent to a browser: example.com extracts 167 useful characters
// from a handful of elements and is complete content. Testing only the character count
// called that a failure and would have paid ~700ms of browser time to learn nothing.
export const SHELL_ELEMENT_FLOOR = 30;

export function countElements(html) {
  return (String(html).match(/<[a-z][a-z0-9-]*\b/gi) || []).length;
}

const BLOCK_TAGS = 'address|article|aside|blockquote|div|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|ul';

export function stripNonContent(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[^>]*\/?>/gi, ' ');
}

export function bodyOf(html) {
  const m = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(String(html));
  return m ? m[1] : String(html);
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

// An extension that promises a shape is a checkable promise. This does not guess WHY the body
// is wrong — an interstitial, a redirect to a marketing page and a proxy error page all look
// the same here — only that it is not what the URL said it would be. Issue #36: a
// patch-diff.githubusercontent.com .diff URL answered 200 with 7,308 chars of GitHub's
// signed-out interstitial, converted to markdown, and nothing in the envelope said so.
const DIFF_URL = /\.(diff|patch)(?:[?#]|$)/i;
// Three shapes, because "a diff" is not one format, and each branch was paid for by an audit
// finding. The unified pair because diff -u, svn and hg emit no git header and the first
// version called all of them fabricated. \r?\n because a patch produced on Windows is still a
// patch and the second version failed it at the \r. 40 OR 64 rather than {40,64} because a
// range accepted an invented 48-hex preamble as a real one. Both --- and +++ are required so
// a markdown horizontal rule or YAML front matter cannot masquerade as a patch.
const DIFF_MARKER = /^diff --git |^From (?:[0-9a-f]{40}|[0-9a-f]{64}) |^--- .*\r?\n\+\+\+ /m;

// Known residual, deliberately not chased: a binary-only diff body ("Binary files a and b
// differ") carries no marker and is reported incomplete. The alternative is matching prose,
// which brings back the false-positive class that would get this warning switched off.
function contentShape(url, text) {
  if (!DIFF_URL.test(String(url || ''))) return null;
  if (DIFF_MARKER.test(String(text || ''))) return null;
  return {
    expected: 'diff',
    matched: false,
    why: 'the URL extension promises a diff and the body carries no diff --git header, From <sha> preamble, or --- / +++ unified pair',
  };
}

export function toMarkdown(html) {
  let s = stripNonContent(bodyOf(html));
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, inner) => `\n\n${'#'.repeat(Number(n))} ${inner.replace(/<[^>]+>/g, ' ').trim()}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${inner.replace(/<[^>]+>/g, ' ').trim()}`);
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const label = inner.replace(/<[^>]+>/g, ' ').trim();
    return label ? `[${label}](${href})` : '';
  });
  s = s.replace(new RegExp(`</(${BLOCK_TAGS})>`, 'gi'), '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').split('\n').map((l) => l.trim()).join('\n').trim();
}

export function needsBrowser(html, extracted) {
  const body = stripNonContent(bodyOf(html));
  const hasMarkup = /<[a-z]/i.test(body);
  const elements = countElements(body);
  if (hasMarkup && extracted.length === 0) {
    return { needed: true, reason: 'the body has elements but rendered no text server-side' };
  }
  if (extracted.length < MIN_USEFUL_CHARS && elements >= SHELL_ELEMENT_FLOOR) {
    return {
      needed: true,
      reason: `only ${extracted.length} characters of text came out of ${elements} elements, which reads as an unrendered app shell`,
    };
  }
  return { needed: false, reason: null };
}

// Pulled out so discovery can refuse what the call refuses. actions.check typed url as a
// string and approved a file:// url that readText has always rejected.
export function validateReadTextUrl(url) {
  if (typeof url !== 'string' || !url) {
    const e = new Error("readText needs a url: readText('https://example.com') or readText({ url: 'https://example.com' })");
    e.code = 'EBADVAL';
    throw e;
  }
  if (/^file:/i.test(url)) {
    const e = new Error('file:// urls are refused; Aside cannot navigate them and readText will not special-case a local read');
    e.code = 'ENOTSUP';
    throw e;
  }
  return url;
}

export function createReadText({ fetchImpl, browse = null, timeoutMs = 15000, cache = null, accountRoot = '' } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  return async function readText(url, opts = {}) {
    // Every neighbouring call takes an options object, so { url } is what a caller writes
    // first. Refusing it taught nothing; accepting it costs one branch. The catalog has
    // always advertised an object input, which made the old refusal a contradiction.
    if (url && typeof url === 'object' && !Array.isArray(url)) {
      const { url: inner, ...rest } = url;
      url = inner;
      opts = { ...rest, ...opts };
    }
    validateReadTextUrl(url);
    if (!doFetch) {
      const e = new Error('no fetch implementation is available (Node >= 18 provides one)');
      e.code = 'ENOTSUP';
      throw e;
    }

    let html = '';
    let status = null;
    let fetchError = null;
    let fetched = null;
    let contentType = null;
    // A warm entry is only worth reusing if it was a real observation. Failures are not
    // cached at all, so a hit is always something we were willing to call an answer.
    // 0.7.0 entries predate HTTP-status refusal and truthful body formats. A readText-only
    // namespace generation retires those observations without invalidating other features.
    const cacheKeyParts = { namespace: 'readText-v3', subject: url, accountRoot, locale: opts.locale || null };
    if (cache && opts.fresh !== true) {
      const hit = await cache.get(cacheKeyParts);
      // Reuse only a complete, successful observation, and only one at least as long as this
      // caller asked for. minChars is not in the key, so a short answer stored for a caller
      // that accepted anything must not become the answer for one that did not.
      const warm = hit.hit ? hit.value : null;
      // complete === false rather than falsiness: an entry written before this field existed
      // has no key at all, and treating those as incomplete would throw away every warm
      // observation. The v3 namespace is what retires the genuinely suspect ones.
      if (warm && warm.ok === true && warm.complete !== false && (warm.chars || 0) >= (opts.minChars || 0)) {
        // An entry written before the body moved from 'markdown' to 'text' would come back
        // with the content under a key nobody reads any more. Rename on the way out rather
        // than invalidating a cache that is otherwise still an answer.
        const { markdown, ...rest } = warm;
        const carried = rest.text !== undefined ? rest : { ...rest, text: markdown ?? '', format: rest.format || 'markdown' };
        return { ...carried, url, cached: true };
      }
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs || timeoutMs);
    try {
      fetched = await doFetch(url, { signal: ac.signal, redirect: 'follow' });
      status = fetched.status;
      contentType = fetched.headers && typeof fetched.headers.get === 'function'
        ? fetched.headers.get('content-type')
        : null;
      html = await fetched.text();
    } catch (e) {
      fetchError = String(e && e.message ? e.message : e);
    } finally {
      clearTimeout(timer);
    }

    // Only HTML is markup to transform. JSON and other text formats are already their own
    // content; passing them through the HTML converter can change bytes and make valid JSON
    // impossible to parse. A missing type keeps the historical HTML behavior for injected
    // fetch implementations and servers that omit the header.
    const mediaType = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
    const isJson = mediaType === 'application/json' || mediaType.endsWith('+json');
    const isHtml = !mediaType || mediaType === 'text/html' || mediaType === 'application/xhtml+xml';
    const format = isHtml ? 'markdown' : (isJson ? 'json' : 'text');
    const text = fetchError ? '' : (isHtml ? toMarkdown(html) : html);
    // format describes what the body actually is. HTML becomes markdown, non-HTML fetches
    // stay in their declared textual form, and the browser path returns rendered innerText.
    const body0 = (text, format = 'markdown') => ({ text, format, chars: text.length });
    // An http status that says "not today" is not a page. Storing it as one is how a 503
    // became a page's new content and a 403 became an empty article.
    // HTTP defines client and server errors as 400-599. Redirects and successes can still
    // carry content after fetch follows redirects; nonstandard statuses above 599 are not
    // silently assigned semantics this protocol does not define.
    const httpBad = status !== null && status >= 400 && status <= 599;
    if (httpBad) {
      return {
        url, source: 'fetch', status, ...body0(text, format), ok: false, complete: false,
        blockKind: status === 429 ? 'rate-limited' : (status >= 500 ? 'upstream' : ([401, 403].includes(status) ? 'auth' : 'blocked')),
        fallbackReason: 'http-' + status,
      };
    }
    // A sign-in page loads perfectly and says nothing we asked for. policy.detect names it,
    // and the final url is the one the redirect landed on, not the one we asked for.
    const finalUrl = (fetched && fetched.url) || url;
    const wall = fetchError || !isHtml ? null : detect({ requestedUrl: url, finalUrl, tree: text });
    if (wall && wall.kind === 'login-wall') {
      return {
        url, finalUrl, source: 'fetch', status, ...body0(text, format), ok: false, complete: false,
        blockKind: 'login-wall', fallbackReason: 'login-wall',
      };
    }
    const verdict = fetchError
      ? { needed: true, reason: `fetch failed: ${fetchError}` }
      : (isHtml ? needsBrowser(html, text) : { needed: false, reason: null });

    if (!verdict.needed) {
      const shape = contentShape(url, text);
      const out = { url, source: 'fetch', status, ...body0(text, format), ok: true,
        fallbackReason: null,
        // Always present, never only on the bad branch: a key that appears solely on failure
        // is a key callers forget to read.
        complete: shape === null,
        ...(shape ? { contentShape: shape } : {}) };
      // Do not cache a body that is not what was asked for, or the interstitial becomes this
      // URL's answer for every later reader.
      if (cache && out.complete) await cache.put(cacheKeyParts, out);
      return out;
    }
    if (!browse) {
      return { url, source: 'fetch', status, ...body0(text, format), ok: false, complete: false, fallbackReason: verdict.reason, degraded: true };
    }
    // fullText asks the page for its rendered body. Without it the only text the batch
    // returns is a 160-character sample, and promoting a summary to "the article" is the
    // silent degradation this whole layer exists to stop.
    const res = await browse.exec({ urls: [url], snapshot: true, fullText: true, timeoutMs: opts.timeoutMs || timeoutMs });
    const item = (res.items || [])[0] || {};
    const body = item.ok ? String(item.text || '') : '';
    const enough = body.length >= Math.max(1, opts.minChars || 1);
    const out = enough
      ? { url, source: 'browser', status, ...body0(body, 'text'),
          fallbackReason: verdict.reason, browserOk: true, ok: true, complete: true, blockKind: item.blockKind || null }
      : { url, source: 'browser', status, ...body0(text, format),
          fallbackReason: verdict.reason, browserOk: Boolean(item.ok), ok: false, complete: false, degraded: true,
          degradedReason: item.ok ? 'the browser returned no text' : 'the browser could not read the page',
          blockKind: item.blockKind || null };
    if (cache && out.ok && out.complete) await cache.put(cacheKeyParts, out);
    return out;
  };
}
