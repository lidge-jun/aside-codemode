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
  const endpoint = req.id
    ? `https://itunes.apple.com/lookup?id=${q(req.id)}`
    : `https://itunes.apple.com/search?term=${q(req.term || '')}&limit=${q(req.limit || 5)}${req.entity ? `&entity=${q(req.entity)}` : ''}`;
  if (!req.id && !req.term) throw new AdapterError('itunes requires { id } or { term }', 'EBADVAL');
  const res = await doFetch(endpoint);
  if (!res.ok) throw new AdapterError(`itunes returned ${res.status}`, 'EUPSTREAM');
  const j = await res.json();
  const results = Array.isArray(j.results) ? j.results : [];
  return {
    count: results.length,
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
    return { items, ok: items.every((i) => i.ok), partial: items.some((i) => !i.ok) ? ['item-failure'] : [] };
  }

  return Object.freeze({ batch, adapters: () => ADAPTERS });
}
