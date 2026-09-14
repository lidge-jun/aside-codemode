// Watch a list of urls and return only what moved.
//
// A per-url text hash lives in the shared cache. An unchanged url comes back with no body
// at all, which is the whole point: the model reads the diff, not the page. First sight is
// changed:true with first:true so 'I have never seen this' is never mistaken for 'this
// changed'.
import { textHash, lineDiff } from './cache.js';

export function createWatch({ readText, cache, accountRoot = '' } = {}) {
  return async function watch(urls, opts = {}) {
    if (!Array.isArray(urls) || urls.length === 0) throw Object.assign(new Error('watch requires a non-empty array of urls'), { code: 'EBADVAL' });
    const items = await Promise.all(urls.map(async (url) => {
      const keyParts = { namespace: 'watch', subject: url, accountRoot, locale: opts.locale || null };
      try {
        const read = await readText(url, { timeoutMs: opts.timeoutMs });
        const text = read.markdown || '';
        const hash = textHash(text);
        const prev = cache ? await cache.get(keyParts) : { hit: false };
        if (cache) await cache.put(keyParts, { hash, text });
        if (!prev.hit) return { url, ok: true, changed: true, first: true, hash, chars: text.length };
        if (prev.value.hash === hash) return { url, ok: true, changed: false, hash };
        return { url, ok: true, changed: true, first: false, hash, diff: lineDiff(prev.value.text, text) };
      } catch (e) {
        return { url, ok: false, code: e.code, error: String(e.message || e) };
      }
    }));
    return { items, changed: items.filter((i) => i.changed).length, ok: items.every((i) => i.ok) };
  };
}

// Recipes are DATA, never code. A guest-supplied .js recipe would be host-loaded and so
// would bypass the node:vm boundary that contains guest JavaScript; a declarative
// { url, waitSelector, extract } runs through the ordinary browse path with no model turn.
export function createRecipes({ registry = {}, exec } = {}) {
  function assertDataRecipe(name, recipe) {
    if (typeof recipe === 'function' || typeof recipe === 'string') {
      throw Object.assign(new Error(`recipe "${name}" must be data ({ url, waitSelector, extract }), not code: a host-loaded script would bypass the guest sandbox`), { code: 'ENOTSUP' });
    }
    if (!recipe || typeof recipe !== 'object' || typeof recipe.url !== 'string') {
      throw Object.assign(new Error(`recipe "${name}" needs at least { url }`), { code: 'EBADVAL' });
    }
  }

  function resolve(recipe, args = {}) {
    const url = recipe.url.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k] === undefined ? '' : args[k])));
    return { url, waitSelector: recipe.waitSelector || null, extract: recipe.extract || null };
  }

  return Object.freeze({
    list: async () => Object.keys(registry),
    describe: async (name) => registry[name] || null,
    run: async (name, args = {}) => {
      const recipe = registry[name];
      if (!recipe) throw Object.assign(new Error(`unknown recipe "${name}"; known: ${Object.keys(registry).join(', ') || 'none'}`), { code: 'EBADOPT' });
      assertDataRecipe(name, recipe);
      const r = resolve(recipe, args);
      const job = { urls: [r.url] };
      if (r.waitSelector) job.waitSelector = r.waitSelector;
      if (r.extract) job.extract = r.extract;
      const res = await exec(job);
      return { recipe: name, url: r.url, ok: res.ok, items: res.items, partial: res.partial };
    },
  });
}

// Best-effort by design: a warm-up that throws would break the caller's actual run, which
// is strictly worse than a cold cache.
export function createPrefetch({ readText, cache, accountRoot = '' } = {}) {
  return async function prefetch(urls, opts = {}) {
    if (!Array.isArray(urls) || urls.length === 0) throw Object.assign(new Error('prefetch requires a non-empty array of urls'), { code: 'EBADVAL' });
    const settled = await Promise.allSettled(urls.map(async (url) => {
      const read = await readText(url, { timeoutMs: opts.timeoutMs });
      if (cache) await cache.put({ namespace: 'readText', subject: url, accountRoot, locale: opts.locale || null }, { markdown: read.markdown, source: read.source });
      return { url, ok: true, chars: (read.markdown || '').length, source: read.source };
    }));
    const items = settled.map((s, i) => (s.status === 'fulfilled' ? s.value : { url: urls[i], ok: false, error: String(s.reason && s.reason.message ? s.reason.message : s.reason) }));
    return { items, warmed: items.filter((i) => i.ok).length, ok: true, note: 'prefetch is best-effort: failures are reported, never thrown' };
  };
}
