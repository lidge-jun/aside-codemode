// Host-side wiring for the report and api namespaces, so globals.js stays a manifest.
import { createBrowseSession } from './browse/session.js';
import { createAsideResolver } from './browse/resolve.js';
import { createAsideSpawner } from './browse/spawn.js';
import { createReport as createReportCore } from './report/report.js';
import { createApi } from './browse/adapters.js';
import { ENABLE_BROWSE_COMMAND } from '../enable-browse.js';
import { requireLocalArtifacts } from '../browser-context.js';

export function createReport({ config = {}, signal, assertInside, env = process.env, browserContext = null, spawnAside, resolveAside } = {}) {
  const caps = config.browseCaps || {};
  const session = createBrowseSession({
    spawnAside: spawnAside || createAsideSpawner(),
    resolveAside: resolveAside || createAsideResolver(config, env),
    signal,
    browserContext,
  });
  const core = createReportCore({ session, assertInside });
  return Object.freeze({
    async build(opts = {}) {
      if (caps.enabled !== true) {
        const e = new Error(`report.build needs browsing, which is currently off. Turn it on with: ${ENABLE_BROWSE_COMMAND}`);
        e.code = 'EDISABLED';
        throw e;
      }
      requireLocalArtifacts(browserContext, 'report.build');
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
