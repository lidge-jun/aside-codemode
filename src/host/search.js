// Guest global `search` (A-D4). Throws on failure; execute_code maps to ok:false.
export function createSearch({ rgRunner, assertInside, caps }) {
  return Object.freeze({
    async files({ pattern, path, glob, max } = {}) {
      if (typeof path !== 'string' || !path) throw new Error('search.files: path (string) is required');
      const dir = assertInside(path);
      return rgRunner.files({ pattern, path: dir, glob, max: max ?? caps.files });
    },
    async content({ query, path, glob, context, max, ignoreCase } = {}) {
      if (typeof query !== 'string' || !query) throw new Error('search.content: query (string) is required');
      if (typeof path !== 'string' || !path) throw new Error('search.content: path (string) is required');
      const dir = assertInside(path);
      return rgRunner.content({ query, path: dir, glob, context, max: max ?? caps.content, ignoreCase });
    },
  });
}
