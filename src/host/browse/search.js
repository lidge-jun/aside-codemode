// Parallel multi-query search with honest engine reporting.
//
// Measured (003 E8): googleSearch.search EXISTS but answers with a bot-challenge demanding
// a human solve it in a browser, while youtube.search genuinely works. So a Google query is
// never retried and never flattened into 'no results' — it comes back EBLOCKED with the
// route that would actually work. DuckDuckGo is the default web engine and gets the SAME
// challenge detection, because it being the default is exactly what would make a silent
// empty result set dangerous.
import { textHash } from './cache.js';

export const ENGINES = Object.freeze({
  duckduckgo: { via: 'fetch', note: 'no-key HTML endpoint; a different and weaker index than Google' },
  youtube: { via: 'aside', note: 'Aside youtube.search; measured working' },
  google: { via: 'aside', note: 'Aside googleSearch.search; measured to answer with a bot challenge that needs a human' },
});

const CHALLENGE = /bot challenge|unusual traffic|are you a robot|captcha|verify you are human|solve it, then retry/i;

export class SearchError extends Error {
  constructor(message, code, extra = {}) { super(message); this.name = 'SearchError'; this.code = code; Object.assign(this, extra); }
}

export function normaliseUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(k) || k === 'ref' || k === 'ref_src') url.searchParams.delete(k);
    }
    let s = url.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch (_) { return String(u || ''); }
}

export function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = normaliseUrl(r && r.url);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...r, url: k });
  }
  return out;
}

export function parseDuckDuckGo(html) {
  if (CHALLENGE.test(String(html))) {
    throw new SearchError('DuckDuckGo answered with a challenge page instead of results', 'EBLOCKED', { alternate: 'solve-in-browser' });
  }
  const rows = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    let href = m[1];
    // DDG wraps results in a redirect with the real target in uddg=
    const wrapped = /[?&]uddg=([^&]+)/.exec(href);
    if (wrapped) { try { href = decodeURIComponent(wrapped[1]); } catch (_) {} }
    if (href && title) rows.push({ url: href, title });
  }
  return rows;
}

export function applyDateFilter(rows, since) {
  if (!since) {
    return {
      rows,
      filtered: 0,
      dateFilter: { requested: false, applied: false, evaluated: 0, unknown: 0 },
    };
  }
  const cutoff = since instanceof Date ? since.getTime() : Date.parse(since);
  if (!Number.isFinite(cutoff)) {
    return {
      rows,
      filtered: 0,
      dateFilter: { requested: true, applied: false, evaluated: 0, unknown: rows.length },
    };
  }
  let evaluated = 0;
  let unknown = 0;
  const kept = rows.filter((r) => {
    if (!r.published) { unknown += 1; return true; }
    const t = Date.parse(r.published);
    if (!Number.isFinite(t)) { unknown += 1; return true; }
    evaluated += 1;
    return t >= cutoff;
  });
  return {
    rows: kept,
    filtered: rows.length - kept.length,
    dateFilter: { requested: true, applied: evaluated > 0 || rows.length === 0, evaluated, unknown },
  };
}

export function createSearchMany({ fetchImpl, session, cache = null, accountRoot = '' } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);

  async function ddg(query) {
    if (!doFetch) throw new SearchError('no fetch implementation is available', 'ENOTSUP');
    const res = await doFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; codemode/1.0)' },
    });
    const html = await res.text();
    return parseDuckDuckGo(html);
  }

  async function viaAside(engine, query) {
    if (!session) throw new SearchError(`${engine} needs a browse session`, 'ENOTSUP');
    const call = engine === 'youtube'
      ? `const r = await youtube.search(${JSON.stringify(query)}); console.log(JSON.stringify({ type: 'final', rows: r }));`
      : `const r = await googleSearch.search(${JSON.stringify(query)}); console.log(JSON.stringify({ type: 'final', rows: r }));`;
    const res = await session.raw(call);
    if (res.error && CHALLENGE.test(res.error)) {
      // Quote the line that actually names the challenge, so the caller sees the url to open.
      const line = String(res.error).split(/\r?\n/).find((l) => CHALLENGE.test(l)) || String(res.error).slice(0, 240);
      throw new SearchError(`${engine} answered with a bot challenge that needs a human: ${line.trim()}`, 'EBLOCKED', { alternate: 'solve-in-browser' });
    }
    if (res.error) throw new SearchError(`${engine} failed: ${String(res.error).slice(0, 240)}`, 'EUPSTREAM');
    return (res.rows || []).map((r) => ({ url: r.url, title: r.title, channel: r.channelName || null, published: r.published || null }));
  }

  async function one(query, engine, since) {
    // since belongs in the key. Without it a search filtered to the last week answered a
    // later unfiltered search from the same entry, and the rows it had dropped stayed dropped.
    const keyParts = { namespace: 'search', subject: query, engine, accountRoot, since: since || null };
    if (cache) {
      const hit = await cache.get(keyParts);
      if (hit.hit && hit.value.dateFilter) return { query, engine, ok: true, cached: true, ...hit.value };
      if (hit.hit && !since) {
        return {
          query, engine, ok: true, cached: true, ...hit.value,
          dateFilter: { requested: false, applied: false, evaluated: 0, unknown: 0 },
        };
      }
    }
    const rows = engine === 'duckduckgo' ? await ddg(query) : await viaAside(engine, query);
    const unique = dedupe(rows);
    const { rows: kept, filtered, dateFilter } = applyDateFilter(unique, since);
    const value = { rows: kept, count: kept.length, deduped: rows.length - unique.length, filtered, dateFilter };
    if (cache) await cache.put(keyParts, value);
    return { query, engine, ok: true, cached: false, ...value };
  }

  return async function searchMany(queries, opts = {}) {
    if (!Array.isArray(queries) || queries.length === 0) throw new SearchError('searchMany requires a non-empty array of queries', 'EBADVAL');
    const engine = opts.engine || 'duckduckgo';
    if (!ENGINES[engine]) throw new SearchError(`unknown engine "${engine}"; valid: ${Object.keys(ENGINES).join(', ')}`, 'EBADOPT');
    const settled = await Promise.allSettled(queries.map((q) => one(q, engine, opts.since)));
    const rawItems = settled.map((s, i) => (s.status === 'fulfilled' ? s.value : {
      query: queries[i], engine, ok: false,
      code: s.reason && s.reason.code,
      alternate: s.reason && s.reason.alternate,
      error: String(s.reason && s.reason.message ? s.reason.message : s.reason),
    }));
    const seen = new Set();
    const items = rawItems.map((item) => {
      if (!item.ok) return item;
      let crossDeduped = 0;
      const rows = item.rows.filter((row) => {
        const key = normaliseUrl(row && row.url);
        if (!key || seen.has(key)) { crossDeduped += 1; return false; }
        seen.add(key);
        return true;
      });
      return {
        ...item,
        rows,
        count: rows.length,
        deduped: item.deduped + crossDeduped,
      };
    });
    const partial = items.some((i) => !i.ok) ? ['item-failure'] : [];
    // Every query answering zero is, in practice, a challenge page or a parse that stopped
    // matching — not a world with no results. One empty query is ordinary and says nothing,
    // so this needs all of them and at least one to have actually run.
    // Two, the same minimum extraction uses. One query finding nothing is the most ordinary
    // outcome a search has, and a warning on the common case teaches a reader to skip the
    // field. The per-query count is on each item either way.
    const answered = items.filter((i) => i.ok);
    const allEmpty = answered.length >= 2 && answered.every((i) => i.count === 0);
    if (allEmpty) partial.push('suspect-empty');
    const deduped = answered.reduce((total, item) => total + item.deduped, 0);
    const filtered = answered.reduce((total, item) => total + item.filtered, 0);
    const requested = Boolean(opts.since);
    const dateFilter = {
      requested,
      applied: requested && answered.length > 0 && answered.every((item) => item.dateFilter.applied),
      evaluated: answered.reduce((total, item) => total + item.dateFilter.evaluated, 0),
      unknown: answered.reduce((total, item) => total + item.dateFilter.unknown, 0),
    };
    return {
      engine, items, ok: items.every((i) => i.ok), partial, deduped, filtered, dateFilter,
      suspectEmpty: allEmpty ? {
        queries: answered.length,
        why: 'every query came back with nothing, which is more often a challenge page or a parser that stopped matching than a subject with no results anywhere',
      } : undefined,
    };
  };
}

export { textHash };
