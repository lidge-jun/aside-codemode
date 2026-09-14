// Read a page without rendering it, and only reach for a browser when the fetched HTML
// measurably is not the content.
//
// The fallback trigger is a property of the RESULT, never of the framework. __NEXT_DATA__
// and ng-app live inside <script>, which the strip pass removes: testing for them would
// fire on ordinary server-rendered pages that need no browser, and after the strip it would
// never fire at all. A text-to-markup ratio is rejected for the same reason — a
// chrome-heavy article page is markup-dense and still perfectly readable.

export const MIN_USEFUL_CHARS = 200;
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

export function createReadText({ fetchImpl, browse = null, timeoutMs = 15000 } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  return async function readText(url, opts = {}) {
    if (typeof url !== 'string' || !url) {
      const e = new Error('readText requires a url string');
      e.code = 'EBADVAL';
      throw e;
    }
    if (/^file:/i.test(url)) {
      const e = new Error('file:// urls are refused; Aside cannot navigate them and readText will not special-case a local read');
      e.code = 'ENOTSUP';
      throw e;
    }
    if (!doFetch) {
      const e = new Error('no fetch implementation is available (Node >= 18 provides one)');
      e.code = 'ENOTSUP';
      throw e;
    }

    let html = '';
    let status = null;
    let fetchError = null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs || timeoutMs);
    try {
      const res = await doFetch(url, { signal: ac.signal, redirect: 'follow' });
      status = res.status;
      html = await res.text();
    } catch (e) {
      fetchError = String(e && e.message ? e.message : e);
    } finally {
      clearTimeout(timer);
    }

    const markdown = fetchError ? '' : toMarkdown(html);
    const verdict = fetchError
      ? { needed: true, reason: `fetch failed: ${fetchError}` }
      : needsBrowser(html, markdown);

    if (!verdict.needed) {
      return { url, source: 'fetch', status, markdown, chars: markdown.length, fallbackReason: null };
    }
    if (!browse) {
      return { url, source: 'fetch', status, markdown, chars: markdown.length, fallbackReason: verdict.reason, degraded: true };
    }
    const res = await browse.exec({ urls: [url], snapshot: true, timeoutMs: opts.timeoutMs || timeoutMs });
    const item = (res.items || [])[0] || {};
    return {
      url,
      source: 'browser',
      status,
      markdown: item.ok ? (item.text || markdown) : markdown,
      chars: markdown.length,
      fallbackReason: verdict.reason,
      browserOk: Boolean(item.ok),
      blockKind: item.blockKind || null,
    };
  };
}
