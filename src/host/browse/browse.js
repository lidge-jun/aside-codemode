// Guest-facing browse namespace. wp2 ships the two methods that make the surface
// inspectable and provable; the batch/report features land in later work-phases.
import { CAPABILITY_MATRIX, doctorPayload } from './probe.js';
import { createBrowseSession } from './session.js';

export function createBrowse({ config = {}, spawnAside, resolveAside, signal } = {}) {
  const caps = config.browseCaps || {};
  const session = spawnAside && resolveAside
    ? createBrowseSession({ spawnAside, resolveAside, signal })
    : null;

  async function probe() {
    return doctorPayload(config, null, null);
  }

  async function exec(job) {
    if (caps.enabled !== true) {
      const e = new Error('browse is opt-in: set browseCaps.enabled = true in codemode config');
      e.code = 'EDISABLED';
      throw e;
    }
    if (!session) {
      const e = new Error('no Aside session transport is configured');
      e.code = 'ENOTSUP';
      throw e;
    }
    return session.run(job, { browseCaps: caps, signal });
  }

  return Object.freeze({ probe, exec });
}

export { CAPABILITY_MATRIX };
