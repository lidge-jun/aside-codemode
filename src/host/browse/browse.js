// Guest-facing browse namespace. wp2 ships the two methods that make the surface
// inspectable and provable; the batch/report features land in later work-phases.
import { CAPABILITY_MATRIX, doctorPayload } from './probe.js';
import { createBrowseSession } from './session.js';
import { createAsideResolver } from './resolve.js';
import { createAsideSpawner } from './spawn.js';

export function createBrowse({ config = {}, spawnAside, resolveAside, signal, env = process.env } = {}) {
  const caps = config.browseCaps || {};
  // Injectable for tests; a real install gets the portable resolver and spawner so the
  // namespace works on a machine nobody developed on.
  const resolver = resolveAside || createAsideResolver(config, env);
  const spawner = spawnAside || createAsideSpawner();
  const session = createBrowseSession({ spawnAside: spawner, resolveAside: resolver, signal });

  async function probe() {
    let resolved = null;
    let error = null;
    try { resolved = await resolver(); } catch (e) { error = { code: e.code, message: e.message, candidates: e.candidates || [] }; }
    return doctorPayload(config, resolved, error);
  }

  async function exec(job) {
    if (caps.enabled !== true) {
      const e = new Error('browse is opt-in: set browseCaps.enabled = true in codemode config');
      e.code = 'EDISABLED';
      throw e;
    }
    return session.run(job, { browseCaps: caps, signal });
  }

  return Object.freeze({ probe, exec });
}

export { CAPABILITY_MATRIX };
