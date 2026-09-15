// Host-side wiring for the report and api namespaces, so globals.js stays a manifest.
import { createBrowseSession } from './browse/session.js';
import { createAsideResolver } from './browse/resolve.js';
import { createAsideSpawner } from './browse/spawn.js';
import { createReport as createReportCore } from './report/report.js';
import { createApi } from './browse/adapters.js';

export function createReport({ config = {}, signal, assertInside, env = process.env } = {}) {
  const caps = config.browseCaps || {};
  const session = createBrowseSession({
    spawnAside: createAsideSpawner(),
    resolveAside: createAsideResolver(config, env),
    signal,
  });
  const core = createReportCore({ session, assertInside });
  return Object.freeze({
    async build(opts = {}) {
      if (caps.enabled !== true) {
        const e = new Error('report.build needs browsing, which is currently off. Turn it on with: codemode --enable-browse');
        e.code = 'EDISABLED';
        throw e;
      }
      return core.build({ ...opts, browseCaps: caps });
    },
  });
}

// api.* is plain HTTP, so it does not need the browser opt-in. Adapters without an honest
// public endpoint refuse themselves with ENOTSUP.
export function createApiNamespace() {
  const api = createApi({});
  return Object.freeze({
    batch: (requests) => api.batch(requests),
    adapters: async () => api.adapters(),
  });
}
