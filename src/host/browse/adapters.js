// API-first adapters. Only where a real public endpoint exists.
//
// Play and Slack are refused rather than stubbed: Slack's Web API needs a bearer token for
// every useful call, and Play has no public catalog API. Shipping a stub that fails on the
// first real request would be worse than saying so here.

export class AdapterError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}

export const ADAPTERS = Object.freeze({
  youtube: { public: true, note: 'oEmbed metadata, no key required' },
  itunes: { public: true, note: 'iTunes Search/Lookup, no key required, rate limited by IP' },
  play: { public: false, note: 'Google Play has no public catalog API; the alternative is scraping or a Play Developer account, neither of which belongs behind an api.* name' },
  slack: { public: false, note: 'every useful Slack Web API call needs a bot or user token; use an authenticated exec run instead' },
});

const NAMES = Object.keys(ADAPTERS);

function q(v) { return encodeURIComponent(String(v)); }

async function youtube(req, doFetch) {
  if (!req.url) throw new AdapterError('youtube requires { url }', 'EBADVAL');
  const endpoint = `https://www.youtube.com/oembed?url=${q(req.url)}&format=json`;
  const res = await doFetch(endpoint);
  if (res.status === 404) throw new AdapterError('youtube returned 404: the video is private, removed, or the url is not a watch url', 'ENOTFOUND');
  if (!res.ok) throw new AdapterError(`youtube oembed returned ${res.status}`, 'EUPSTREAM');
  const j = await res.json();
  return { title: j.title, author: j.author_name, authorUrl: j.author_url, thumbnail: j.thumbnail_url, width: j.width, height: j.height, provider: 'youtube' };
}

async function itunes(req, doFetch) {
  // The cap is OURS, not the provider's: limit defaults to 5 here. A search that came back
  // with exactly five results and said count:5 was indistinguishable from a search that had
  // exactly five to give, so asking for one more is how this learns which it was. The extra
  // row is never returned - it is evidence, not data.
  const limit = req.limit || 5;
  const endpoint = req.id
    ? `https://itunes.apple.com/lookup?id=${q(req.id)}`
    : `https://itunes.apple.com/search?term=${q(req.term || '')}&limit=${q(limit + 1)}${req.entity ? `&entity=${q(req.entity)}` : ''}`;
  if (!req.id && !req.term) throw new AdapterError('itunes requires { id } or { term }', 'EBADVAL');
  const res = await doFetch(endpoint);
  if (!res.ok) throw new AdapterError(`itunes returned ${res.status}`, 'EUPSTREAM');
  const j = await res.json();
  const all = Array.isArray(j.results) ? j.results : [];
  const saturated = !req.id && all.length > limit;
  const results = req.id ? all : all.slice(0, limit);
  return {
    count: results.length,
    // true when the provider had more than the limit let through. A caller raising limit is
    // the whole point of knowing.
    saturated,
    limit: req.id ? null : limit,
    results: results.map((r) => ({ id: r.trackId || r.collectionId || r.artistId, name: r.trackName || r.collectionName || r.artistName, kind: r.kind || r.wrapperType, url: r.trackViewUrl || r.collectionViewUrl, price: r.trackPrice ?? r.collectionPrice ?? null, currency: r.currency || null })),
    provider: 'itunes',
  };
}

const IMPL = { youtube, itunes };

// A catalog check calls this on every discovery request, so it must stop at the argument
// boundary. Adapter lookup and HTTP remain execution work.
export function validateApiBatch(requests) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new AdapterError('api.batch requires a non-empty array', 'EBADVAL');
  }
}

export function createApi({ fetchImpl } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);

  async function one(req) {
    const name = req && req.adapter;
    if (!NAMES.includes(name)) {
      throw new AdapterError(`unknown adapter "${name}"; valid: ${NAMES.join(', ')}`, 'EBADOPT');
    }
    if (!ADAPTERS[name].public) {
      throw new AdapterError(`${name} is not available without credentials: ${ADAPTERS[name].note}`, 'ENOTSUP');
    }
    if (!doFetch) throw new AdapterError('no fetch implementation is available', 'ENOTSUP');
    return IMPL[name](req, doFetch);
  }

  // Per-item isolation, same shape as browse: one adapter failing never empties the rest.
  async function batch(requests) {
    validateApiBatch(requests);
    const settled = await Promise.allSettled(requests.map((r) => one(r)));
    const items = settled.map((s, i) => {
      const req = requests[i];
      if (s.status === 'fulfilled') return { adapter: req && req.adapter, ok: true, data: s.value };
      return { adapter: req && req.adapter, ok: false, code: s.reason && s.reason.code, error: String(s.reason && s.reason.message ? s.reason.message : s.reason) };
    });
    // saturated is the adapter saying "there were more". complete:true here would otherwise
    // mean only "every adapter answered", which is not what the field claims.
    return {
      items,
      ok: items.every((i) => i.ok),
      complete: items.every((i) => i.ok && !(i.data && i.data.saturated)),
      partial: items.some((i) => !i.ok) ? ['item-failure'] : [],
    };
  }

  return Object.freeze({ batch, adapters: () => ADAPTERS });
}
