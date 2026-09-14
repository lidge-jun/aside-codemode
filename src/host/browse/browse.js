// Guest-facing browse namespace. wp2 ships the two methods that make the surface
// inspectable and provable; the batch/report features land in later work-phases.
import { CAPABILITY_MATRIX, doctorPayload } from './probe.js';
import { createBrowseSession } from './session.js';
import { createAsideResolver } from './resolve.js';
import { createAsideSpawner } from './spawn.js';
import { createBreaker } from './policy.js';
import { createCaptureMany } from './capture.js';
import { createReadText } from './read-text.js';

export function createBrowse({ config = {}, spawnAside, resolveAside, signal, env = process.env, assertInside } = {}) {
  const caps = config.browseCaps || {};
  // Injectable for tests; a real install gets the portable resolver and spawner so the
  // namespace works on a machine nobody developed on.
  const resolver = resolveAside || createAsideResolver(config, env);
  const spawner = spawnAside || createAsideSpawner();
  // One breaker per host-globals instance: state has to outlive a single call to be worth
  // anything, and it must never cross into the guest.
  const breaker = createBreaker({
    failures: Number.isSafeInteger(caps.breakerFailures) ? caps.breakerFailures : 3,
    cooldownMs: Number.isSafeInteger(caps.breakerCooldownMs) ? caps.breakerCooldownMs : 30000,
  });
  const session = createBrowseSession({ spawnAside: spawner, resolveAside: resolver, signal, breaker });
  const captureManyImpl = createCaptureMany({ session, assertInside });

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

  async function captureMany(urls, opts = {}) {
    if (caps.enabled !== true) {
      const e = new Error('browse is opt-in: set browseCaps.enabled = true in codemode config');
      e.code = 'EDISABLED';
      throw e;
    }
    return captureManyImpl(urls, { ...opts, browseCaps: caps });
  }

  // fetch-first: no browser unless the fetched HTML measurably is not the content.
  const readTextImpl = createReadText({ browse: caps.enabled === true ? { exec } : null });

  return Object.freeze({ probe, exec, captureMany, readText: (url, o) => readTextImpl(url, o) });
}

export { CAPABILITY_MATRIX };
